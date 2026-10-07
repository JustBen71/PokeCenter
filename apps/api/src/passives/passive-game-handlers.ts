import {randomInt} from 'node:crypto';
import {calculateStats,compatibleMoves,decodePokemonCopy,encodePokemon,gen3Items,gen3PartyRaw,legendarySpecies,levelMoves,nationalSpecies,withHp,withIv,withMove,withNature,
 type NativeGameState,type PokemonInjection} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import {GameCommandService} from '../game/game-command-service.js';
import type {PassiveContext,PassiveHandler} from './passive-events.js';

/**
 * Passives that change the game: Pokémon (HP, nature, IV, moves, a new Pokémon) through the exact party copy
 * (game.pokemon.replace / insert, out of battle only) and the bag (game.item.add). Game events (trainer victory,
 * battle end, fainted Pokémon, steps) come from GAME_EVENT; nothing here knows a memory address.
 */
type Party=NativeGameState['party'][number];
const name=(ctx:PassiveContext,accountId=ctx.accountId)=>ctx.services.domain.accounts.get(accountId)?.name??accountId;
const mon=(p:Party)=>p.nickname||p.speciesName;
const holder=(ctx:PassiveContext)=>ctx.services.domain.accounts.get(ctx.accountId)!;
const runId=(ctx:PassiveContext)=>ctx.services.domain.runs.running(ctx.lobbyId,ctx.accountId)?.id??null;
const natureNames=['Hardi','Solo','Brave','Rigide','Mauvais','Assuré','Docile','Relax','Malin','Lâche','Timide','Pressé','Sérieux','Jovial','Naïf','Modeste','Doux','Discret','Pudique','Foufou','Calme','Gentil','Malpoli','Prudent','Bizarre'];
const statNames={hp:'PV',attack:'Attaque',defense:'Défense',speed:'Vitesse',spAttack:'Attaque Spé.',spDefense:'Défense Spé.'} as const;
const itemName=(id:number)=>gen3Items.find(i=>i[0]===id)?.[2]??`objet n°${id}`;

// One game action at a time per holder and passive (observations arrive every second while a command runs); a call
// arriving meanwhile runs once more afterwards, so nothing queued during a run waits for the next observation.
const busy=new Map<string,boolean>();
async function once(ctx:PassiveContext,what:string,run:()=>Promise<unknown>){
 const key=`${ctx.lobbyId}:${ctx.accountId}:${ctx.passive.id}:${what}`;
 if(busy.has(key)){busy.set(key,true);return;}
 try{do{busy.set(key,false);await run();}while(busy.get(key));}
 // Another action holds the game (a reward being paid): what is armed stays armed for the next observation.
 catch(error){if(!(error instanceof DomainError&&error.code==='PLAYER_BUSY'))throw error;}
 finally{busy.delete(key);}
}

/** The holder's game, free on the overworld (a commanded write never lands in battle). */
function freeGame(ctx:PassiveContext){
 const {state}=ctx.services.currentGame.requireState(ctx.lobbyId,ctx.accountId,{capabilities:['pokemon.replace']});
 if(!state.battle?.safe)throw new DomainError('SAFE_STATE_REQUIRED','Sois libre sur la carte (hors combat, hors dialogue) puis réessaie');
 return state;
}
function slotOf(state:NativeGameState,slot:number|undefined){
 const pokemon=state.party.find(p=>p.slot===slot);
 if(!pokemon)throw new DomainError('VALIDATION_FAILED','Choisis un Pokémon de ton équipe');
 const raw=gen3PartyRaw(pokemon);
 if(!raw)throw new DomainError('CAPABILITY_MISSING','Le client n’envoie pas la copie exacte de ce Pokémon');
 return {pokemon,raw};
}
const replace=(ctx:PassiveContext,slot:number,raw:string)=>ctx.services.pokemon.replaceRaw(ctx.lobbyId,ctx.accountId,holder(ctx),slot,raw,true);
/** Party stats again after a nature or IV change (PokéAPI base stats). */
async function stats(ctx:PassiveContext,raw:string,change:{nature?:number;ivs?:Partial<PokemonInjection['ivs']>}){
 const c=decodePokemonCopy(raw),speciesId=nationalSpecies.get(c.internalSpecies)!;
 const {pokemon}=await ctx.services.levelData(speciesId,c.level).catch(()=>{throw new DomainError('VALIDATION_FAILED','PokéAPI indisponible : réessaie dans un instant');});
 return calculateStats(pokemon,{speciesId,level:c.level,nature:change.nature??c.nature,ivs:{...c.ivs as PokemonInjection['ivs'],...change.ivs},evs:c.evs as PokemonInjection['evs']});
}

/** The latest observation if the holder is free on the overworld, otherwise null (offline, in battle). */
function freeState(ctx:PassiveContext){
 try{const {state}=ctx.services.currentGame.requireState(ctx.lobbyId,ctx.accountId,{capabilities:['pokemon.replace']});return state.battle?.safe?state:null;}
 catch{return null;}
}
/**
 * A heal armed in the progression (`key`), done as soon as the holder is free: now, or at a later observation.
 * Conscious members go up to `hp(p)` with their status cleared; fainted ones are left to the PC box rule.
 */
async function healArmed(ctx:PassiveContext,key:string,hp:(p:Party)=>number){
 await once(ctx,'heal',async()=>{
  const state=ctx.get(key,null)?freeState(ctx):null;
  if(!state)return;
  const healed=await heal(ctx,state,hp);
  ctx.set(key,null);
  ctx.audit('passive.heal',`${ctx.passive.name} : ${healed} Pokémon de ${name(ctx)} soignés`);
 });
}
async function heal(ctx:PassiveContext,state:NativeGameState,hp:(p:Party)=>number){
 let healed=0;
 for(const p of state.party){
  if(p.currentHp===0)continue;
  const raw=gen3PartyRaw(p);if(!raw)continue;
  const target=Math.max(p.currentHp,hp(p));
  if(target===p.currentHp&&decodePokemonCopy(raw).status===0)continue;
  await replace(ctx,p.slot,withHp(raw,target,{clearStatus:true}));healed++;
 }
 return healed;
}

/**
 * Items earned and not yet in the bag (offline, bag pocket full): kept in the passive progression and given at the
 * next observation. Sent once: an unknown outcome is audited for an admin, never sent again.
 */
async function giveItems(ctx:PassiveContext){
 await once(ctx,'items',async()=>{
  const {services}=ctx;
  for(let queue=ctx.get<number[]>('items',[]);queue.length;queue=ctx.get<number[]>('items',[])){
   const itemId=queue[0]!;
   let outcome;
   try{
    outcome=await services.commands.withPlayerLock(ctx.lobbyId,ctx.accountId,async()=>{
     const {context,playerId}=services.currentGame.requireState(ctx.lobbyId,ctx.accountId,{capabilities:['items.write']});
     return services.commands.send({lobbyId:ctx.lobbyId,accountId:ctx.accountId,playerId,runId:context.run?.id??null,actorAccountId:null,command:'game.item.add',payload:{itemId}});
    });
   }catch{return;}// game offline or busy: next observation
   if(outcome.status==='FAILED'){
    if(outcome.errorCode==='bag_full'&&!ctx.get('bagFullNotified',false)){ctx.set('bagFullNotified',true);ctx.notify(`🎒 ${ctx.passive.name} — poche du sac pleine : ${itemName(itemId)} attend une place`,{private:true,kind:'warning'});}
    if(['bag_full','not_safe','state_changed'].includes(outcome.errorCode??''))return;
   }
   ctx.set('items',queue.slice(1));ctx.set('bagFullNotified',false);
   if(outcome.status==='COMPLETED')ctx.notify(`🎁 ${ctx.passive.name} — ${name(ctx)} reçoit ${itemName(itemId)}`,{kind:'success'});
   else ctx.audit('passive.item',`${ctx.passive.name} : ${itemName(itemId)} pour ${name(ctx)} ${outcome.status==='REVIEW'?'à vérifier (résultat inconnu)':`refusé (${outcome.errorCode})`}`,{itemId,commandId:outcome.commandId,status:outcome.status});
  }
 });
}
const queueItem=(ctx:PassiveContext,itemId:number)=>ctx.set('items',[...ctx.get<number[]>('items',[]),itemId]);
const giveable=gen3Items.map(i=>i[0]),tms=gen3Items.filter(i=>i[1]==='T').map(i=>i[0]);
const pick=<T>(ctx:PassiveContext,list:readonly T[])=>list[ctx.services.passives.random(list.length)]!;
// « Once per Run » passives: usedRun decides, `used` is what the Passifs page shows; a new Run clears it.
const newRun={RUN_STARTED:(ctx:PassiveContext)=>{ctx.set('used',false);ctx.set('offer',null);}};

// French names of the legendary eggs (Gen III), also the in-game nickname.
const legendaryNames:Record<number,string>={144:'Artikodin',145:'Électhor',146:'Sulfura',150:'Mewtwo',151:'Mew',243:'Raikou',244:'Entei',245:'Suicune',249:'Lugia',250:'Ho-Oh',251:'Celebi',
 377:'Regirock',378:'Regice',379:'Registeel',380:'Latias',381:'Latios',382:'Kyogre',383:'Groudon',384:'Rayquaza',385:'Jirachi',386:'Deoxys'};

/** Server behaviour of the passives that write into the game (merged into passiveHandlers). */
export const gamePassiveHandlers:Record<string,PassiveHandler>={
 // Prime de dresseur: a share of the game's own trainer reward, paid on top.
 'trainer-payday':{on:{TRAINER_VICTORY:async(ctx,event)=>{
  const amount=Math.floor(event.data.baseReward*ctx.passive.params.percent/100);
  if(amount<1)return 'no reward';
  await ctx.reward(`trainer-payday:${event.id}`,{type:'MONEY',amount,reason:`${ctx.passive.params.percent} % de ${event.data.baseReward.toLocaleString('fr-FR')} ₽ gagnés contre un dresseur`});
 }}},

 // Compagnon fidèle: the first Pokémon of the team; N objectives without it leaving = the team is healed.
 'loyal-companion':{
  on:{OBJECTIVE_COMPLETED:(ctx,event)=>{
   if(event.data.initial||!ctx.get('companion',null))return 'ignored';
   const count=ctx.get('objectives',0)+1;
   if(count<ctx.passive.params.objectives){ctx.set('objectives',count);return {count};}
   ctx.set('objectives',0);ctx.set('heal',true);
   ctx.notify(`💚 Compagnon fidèle — ${ctx.get<{name:string}>('companion',{name:'?'}).name} est resté : l’équipe de ${name(ctx)} sera soignée hors combat`);
   return healArmed(ctx,'heal',p=>p.maxHp);
  }},
  observe:async(ctx,state)=>{
   // Identity of a Pokémon: personality and species (an evolution stays the same companion through its personality).
   const companion=ctx.get<{pid:string;name:string}|null>('companion',null);
   const pids=state.party.map(p=>{const raw=gen3PartyRaw(p);return raw?String(decodePokemonCopy(raw).personality):null;});
   if(!companion||!pids.includes(companion.pid)){
    const first=state.party[0],pid=pids[0];
    if(!first||pid==null)return;
    if(companion)ctx.notify(`💔 Compagnon fidèle — ${companion.name} a quitté l’équipe : ${mon(first)} devient le compagnon, compteur remis à zéro`,{private:true,kind:'warning'});
    ctx.set('companion',{pid,name:mon(first)});ctx.set('objectives',0);
   }
   await healArmed(ctx,'heal',p=>p.maxHp);
  }
 },

 // Dernier debout: once per Run, a battle ended with one conscious Pokémon = the team back to half HP at least.
 'last-standing':{
  on:{...newRun,BATTLE_ENDED:(ctx,event)=>{
   const run=runId(ctx);
   if(!run||event.data.outcome==='LOSS'||event.data.conscious!==1)return 'ignored';
   if(ctx.get('usedRun',null)===run)return 'already used';
   ctx.set('usedRun',run);ctx.set('used',true);ctx.set('heal',run);
   ctx.notify(`🩹 Dernier debout — ${name(ctx)} a tenu avec un seul Pokémon : l’équipe remonte à 50 % de ses PV`);
   return healArmed(ctx,'heal',p=>Math.ceil(p.maxHp/2));
  }},
  observe:ctx=>healArmed(ctx,'heal',p=>Math.ceil(p.maxHp/2))
 },

 // Alchimiste: once per Run, a chosen Pokémon takes one of 3 natures (drawn when the Run starts).
 alchemist:{
  observe:ctx=>{
   const run=runId(ctx);if(!run||ctx.get('run',null)===run)return;
   const natures:number[]=[];
   while(natures.length<3){const n=ctx.services.passives.random(25);if(!natures.includes(n))natures.push(n);}
   ctx.set('run',run);ctx.set('used',false);ctx.set('natures',natures);ctx.set('natureNames',natures.map(n=>natureNames[n]));
  },
  act:async(ctx,input)=>{
   if(input.action!=='nature')throw new DomainError('VALIDATION_FAILED','Alchimiste : choisis un Pokémon et une nature');
   const natures=ctx.get<number[]>('natures',[]);
   if(ctx.get('used',false)||ctx.get('run',null)!==runId(ctx))throw new DomainError('CONFLICT','Alchimiste a déjà servi pendant cette Run');
   if(input.nature===undefined||!natures.includes(input.nature))throw new DomainError('VALIDATION_FAILED','Cette nature ne fait pas partie des 3 proposées');
   const {pokemon,raw}=slotOf(freeGame(ctx),input.slot);
   await replace(ctx,pokemon.slot,withNature(raw,input.nature,await stats(ctx,raw,{nature:input.nature})));
   ctx.set('used',true);
   return `Alchimiste — ${mon(pokemon)} de ${name(ctx)} devient de nature ${natureNames[input.nature]}`;
  }
 },

 // ADN instable: every N objectives a charge; a charge = +gain on one random IV (below 31) of a chosen Pokémon.
 'unstable-dna':{
  on:{OBJECTIVE_COMPLETED:(ctx,event)=>{
   if(event.data.initial)return 'initial';
   const count=ctx.get('objectives',0)+1;ctx.set('objectives',count);
   if(count%ctx.passive.params.objectives)return {count};
   ctx.set('charges',ctx.get('charges',0)+1);
   ctx.notify(`🧬 ADN instable — une charge : choisis un Pokémon dont une IV gagne +${ctx.passive.params.gain}`,{private:true});
  }},
  act:async(ctx,input)=>{
   if(input.action!=='iv')throw new DomainError('VALIDATION_FAILED','ADN instable : choisis un Pokémon');
   if(ctx.get('charges',0)<1)throw new DomainError('CONFLICT','Aucune charge d’ADN instable');
   const {pokemon,raw}=slotOf(freeGame(ctx),input.slot);
   const ivs=decodePokemonCopy(raw).ivs as PokemonInjection['ivs'];
   const open=(Object.keys(statNames) as (keyof typeof statNames)[]).filter(k=>ivs[k]<31);
   if(!open.length)throw new DomainError('VALIDATION_FAILED',`${mon(pokemon)} a déjà toutes ses IV à 31`);
   const stat=pick(ctx,open),value=Math.min(31,ivs[stat]+ctx.passive.params.gain);
   await replace(ctx,pokemon.slot,withIv(raw,stat,value,await stats(ctx,raw,{ivs:{[stat]:value}})));
   ctx.set('charges',ctx.get('charges',0)-1);
   return `ADN instable — ${mon(pokemon)} de ${name(ctx)} : IV ${statNames[stat]} ${ivs[stat]} → ${value}`;
  }
 },

 // Chasseur de trésors: every N trainer battles won, a random bag item.
 'treasure-hunter':{
  on:{TRAINER_VICTORY:async ctx=>{
   const wins=ctx.get('wins',0)+1;ctx.set('wins',wins);
   if(wins%ctx.passive.params.every)return {wins};
   queueItem(ctx,pick(ctx,giveable));
   await giveItems(ctx);
  }},
  observe:ctx=>giveItems(ctx)
 },

 // Maître des types: an objective reached with six Pokémon covering N types = a random TM.
 'type-master':{
  on:{OBJECTIVE_COMPLETED:async(ctx,event)=>{
   if(event.data.initial||event.data.batch.at(-1)!==event.data.objectiveId)return 'ignored';
   const {state}=ctx.services.currentGame.requireState(ctx.lobbyId,ctx.accountId,{capabilities:['party.read'],requireRun:false});
   if(state.party.length<6)return 'party not full';
   const types=new Set((await Promise.all(state.party.map(p=>ctx.services.speciesTypes(p.speciesId)))).flat());
   if(types.size<ctx.passive.params.types)return {types:types.size};
   const tm=pick(ctx,tms);
   queueItem(ctx,tm);
   ctx.notify(`🎓 Maître des types — l’équipe de ${name(ctx)} couvre ${types.size} types : ${itemName(tm)}`);
   await giveItems(ctx);
  }},
  observe:ctx=>giveItems(ctx)
 },

 // Marathonien: every N steps over the whole race (all Runs), money.
 marathoner:{on:{STEPS_CHANGED:async(ctx,event)=>{
  const {every,amount}=ctx.passive.params,reached=Math.floor((event.data.total??0)/every);
  ctx.set('steps',event.data.total??0);
  for(let n=ctx.get('paid',0)+1;n<=reached;n++){
   ctx.set('paid',n);
   await ctx.reward(`marathoner:${n}`,{type:'MONEY',amount,reason:`${(n*every).toLocaleString('fr-FR')} pas sur la course`});
  }
 }}},

 // Résurrection: once per Run, instead of going to the PC box, a fainted Pokémon comes back with 1 HP.
 resurrection:{
  on:{...newRun,POKEMON_FAINTED:(ctx,event)=>{ctx.set('lastFainted',event.data.speciesId);}},
  rescue:async(ctx,state)=>{
   const run=runId(ctx);
   if(!run||ctx.get('usedRun',null)===run)return false;
   const fainted=state.party.filter(p=>p.currentHp===0);
   const pokemon=fainted.find(p=>p.speciesId===ctx.get('lastFainted',0))??fainted[0];
   const raw=gen3PartyRaw(pokemon);
   if(!pokemon||!raw)return false;
   // Consumed only once the game confirmed it (a busy game keeps the Pokémon out of the box until it is retried).
   await replace(ctx,pokemon.slot,withHp(raw,1));
   ctx.set('usedRun',run);ctx.set('used',true);
   ctx.notify(`✝ Résurrection — ${mon(pokemon)} de ${name(ctx)} revient à 1 PV au lieu de partir dans la boîte`,{kind:'success'});
   return true;
  }
 },

 // Mutagène: once per Run, 3 moves the chosen Pokémon can learn; one replaces one of its moves.
 mutagen:{on:newRun,act:async(ctx,input)=>{
  const run=runId(ctx);
  if(!run||ctx.get('usedRun',null)===run)throw new DomainError('CONFLICT','Mutagène a déjà servi pendant cette Run');
  if(input.action==='offer'){
   const offer=ctx.get<{run:string}|null>('offer',null);
   if(offer?.run===run)throw new DomainError('CONFLICT','Une offre est déjà en cours pour cette Run');
   const {pokemon,raw}=slotOf(ctx.services.currentGame.requireState(ctx.lobbyId,ctx.accountId,{capabilities:['pokemon.replace']}).state,input.slot);
   const copy=decodePokemonCopy(raw),speciesId=nationalSpecies.get(copy.internalSpecies)!,knownIds=copy.moves.map(m=>m.id);
   const {pokemon:data}=await ctx.services.levelData(speciesId,copy.level).catch(()=>{throw new DomainError('VALIDATION_FAILED','PokéAPI indisponible : réessaie dans un instant');});
   const pool=compatibleMoves(data,copy.level).filter(id=>!knownIds.includes(id)),moves:number[]=[];
   while(moves.length<3&&moves.length<pool.length){const m=pick(ctx,pool);if(!moves.includes(m))moves.push(m);}
   if(!moves.length)throw new DomainError('VALIDATION_FAILED',`${mon(pokemon)} ne peut apprendre aucune autre attaque`);
   const infos=await Promise.all(moves.map(id=>ctx.services.moveInfo(id)));
   // Names of its current moves (null = empty slot), for the choice of the move replaced.
   const known=await Promise.all(copy.moves.map(m=>m.id?ctx.services.moveInfo(m.id).then(i=>i.name):null));
   ctx.set('offer',{run,slot:pokemon.slot,pid:copy.personality,pokemon:mon(pokemon),moves:infos.map(m=>({id:m.id,name:m.name})),known});
   return `Mutagène — ${mon(pokemon)} de ${name(ctx)} : ${infos.map(m=>m.name).join(', ')}`;
  }
  if(input.action!=='mutate')throw new DomainError('VALIDATION_FAILED','Mutagène : choisis un Pokémon');
  const offer=ctx.get<{run:string;slot:number;pid:number;pokemon:string;moves:{id:number;name:string}[]}|null>('offer',null);
  if(!offer||offer.run!==run)throw new DomainError('CONFLICT','Aucune offre de Mutagène en cours');
  const move=offer.moves.find(m=>m.id===input.moveId);
  if(!move||input.moveIndex===undefined)throw new DomainError('VALIDATION_FAILED','Choisis une attaque proposée et l’attaque à remplacer');
  const {pokemon,raw}=slotOf(freeGame(ctx),offer.slot);
  const copy=decodePokemonCopy(raw);
  if(copy.personality!==offer.pid)throw new DomainError('CONFLICT',`${offer.pokemon} n’est plus à cette place de l’équipe`);
  // An empty move slot: the first empty one (moves stay packed, as in the game).
  const old=copy.moves[input.moveIndex]!.id,index=old?input.moveIndex:copy.moves.findIndex(m=>!m.id),{pp}=await ctx.services.moveInfo(move.id);
  await replace(ctx,pokemon.slot,withMove(raw,index,move.id,pp));
  ctx.set('usedRun',run);ctx.set('used',true);ctx.set('offer',null);
  return `Mutagène — ${mon(pokemon)} de ${name(ctx)} apprend ${move.name}${old?` à la place de l’attaque n°${index+1}`:''}`;
 }},

 // Prime de risque: a trainer won with a low average HP, once per badge level.
 'risk-bonus':{on:{TRAINER_VICTORY:async(ctx,event)=>{
  const {state}=ctx.services.currentGame.requireState(ctx.lobbyId,ctx.accountId,{capabilities:['party.read'],requireRun:false});
  if(!state.party.length)return 'no party';
  const average=state.party.reduce((s,p)=>s+p.currentHp/p.maxHp,0)/state.party.length*100;
  if(average>=ctx.passive.params.percent)return {average:Math.round(average)};
  const badges=state.progression.completed.filter(id=>/^badge\d+$/.test(id)).length;
  if(ctx.get('badges',-1)===badges)return 'already rewarded for this badge';
  ctx.set('badges',badges);
  ctx.notify(`🎲 Prime de risque — ${name(ctx)} gagne avec ${Math.round(average)} % de PV moyens : +1 ticket bienveillant`);
  await ctx.reward(`risk-bonus:${event.id}`,{type:'TICKET',tone:'GOOD',reason:`victoire à ${Math.round(average)} % de PV`});
 }}},

 // Héritier des légendes: at N race steps the egg hatches, a level 5 legendary joins the team (room needed).
 'legend-heir':{
  on:{STEPS_CHANGED:(ctx,event)=>{
   ctx.set('steps',Math.min(event.data.total??0,ctx.passive.params.steps));
   if((event.data.total??0)<ctx.passive.params.steps||ctx.get('hatched',null)||ctx.get('ready',false))return;
   ctx.set('ready',true);ctx.notify(`🥚 Héritier des légendes — l’œuf de ${name(ctx)} éclot ! Garde une place dans ton équipe`);
   return hatch(ctx);
  }},
  observe:ctx=>hatch(ctx)
 }
};

/** Héritier des légendes: the egg hatches as soon as the holder is free with a place in the team. */
async function hatch(ctx:PassiveContext){
   await once(ctx,'hatch',async()=>{
    const state=ctx.get('ready',false)?freeState(ctx):null;
    if(!state||state.party.length>=6||!state.capabilities.includes('pokemon.insert'))return;
    const trainer=state.party.map(p=>gen3PartyRaw(p)).find(Boolean);
    if(!trainer)return;
    const ot=decodePokemonCopy(trainer),speciesId=pick(ctx,legendarySpecies),level=5;
    const {pokemon:data,experience}=await ctx.services.levelData(speciesId,level);
    const ivs={hp:randomInt(32),attack:randomInt(32),defense:randomInt(32),speed:randomInt(32),spAttack:randomInt(32),spDefense:randomInt(32)};
    const evs={hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},nature=randomInt(25);
    const statsAt=calculateStats(data,{speciesId,level,nature,ivs,evs});
    const learnt=[...new Set(levelMoves(data,level).map(m=>m.id))].slice(-4);
    const moves=await Promise.all((learnt.length?learnt:[33]).map(id=>ctx.services.moveInfo(id).then(m=>({id,pp:m.pp}))));
    while(moves.length<4)moves.push({id:0,pp:0});
    const raw=encodePokemon({playerId:'passive',slot:1,speciesId,nickname:legendaryNames[speciesId]!.toUpperCase().slice(0,10),level,experience,currentHp:statsAt.maxHp,stats:statsAt,moves,
     heldItem:0,abilitySlot:0,nature,friendship:120,otName:ot.otName,trainerId:ot.trainerId,secretId:ot.secretId,ivs,evs,shiny:false});
    await ctx.services.pokemon.insertRaw(ctx.lobbyId,ctx.accountId,holder(ctx),raw,true);
    ctx.set('ready',false);ctx.set('hatched',legendaryNames[speciesId]);
    ctx.notify(`🌟 Héritier des légendes — ${legendaryNames[speciesId]} (niv. 5) rejoint l’équipe de ${name(ctx)} !`,{kind:'success'});
   });
}
