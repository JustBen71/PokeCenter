import {randomInt} from 'node:crypto';
import {calculateStats,decodePokemonCopy,depositSplit,gageParamsSchemas,gen3Items,gen3PartyRaw,magikarpFrom,nationalSpecies,passiveById,passiveRarityLabels,withLevel,
 type Account,type Gage,type GageHandler,type PassiveRarity,type PokemonInjection} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import type {Services} from '../services.js';
import {wheelSlots} from '../battles/board-draw.js';
import {GameCommandService} from '../game/game-command-service.js';

export type HandlerContext={
 lobbyId:string;resolutionId:string;actorId:string;gage:Gage;owner:Account;target:Account|null;
 choice:{slot?:number;confirmOutOfBattle?:boolean;passiveId?:string};services:Services;
};
type Handler=(ctx:HandlerContext)=>Promise<string>;

const params=<H extends GageHandler>(ctx:HandlerContext,handler:H)=>gageParamsSchemas[handler].parse(ctx.gage.params) as Record<string,any>;
const needTarget=(ctx:HandlerContext)=>{if(!ctx.target)throw new DomainError('VALIDATION_FAILED','Ce gage demande une cible');return ctx.target;};
const actor=(ctx:HandlerContext)=>ctx.services.domain.accounts.get(ctx.actorId)!;
const key=(ctx:HandlerContext,part:string)=>`wheel:${ctx.resolutionId}:${part}`;

// Money moved to or from a player's game through the shared engine (ledger + verified command).
const gameMoney=(ctx:HandlerContext,account:Account,amount:number,direction:'in'|'out',part:string,extra:{jackpotShare?:number;source?:'EXTERNAL'|'JACKPOT'}={})=>{
 const jackpot=extra.jackpotShare??0;
 const legs=direction==='in'
  ?[{type:extra.source==='JACKPOT'?'JACKPOT_REWARD' as const:'WHEEL_REWARD' as const,amount,source:extra.source??'EXTERNAL' as const,destination:'GAME' as const}]
  :[...(amount-jackpot>0?[{type:'WHEEL_TRANSFER' as const,amount:amount-jackpot,source:'GAME' as const,destination:'EXTERNAL' as const}]:[]),
    ...(jackpot>0?[{type:'JACKPOT_CONTRIBUTION' as const,amount:jackpot,source:'GAME' as const,destination:'JACKPOT' as const,metadata:{reason:'wheel'}}]:[])];
 return ctx.services.transactions.apply({lobbyId:ctx.lobbyId,accountId:account.id,actorAccountId:ctx.actorId,idempotencyKey:key(ctx,part),legs:legs.map(l=>({...l,metadata:{...('metadata' in l?l.metadata:{}),resolutionId:ctx.resolutionId,gage:ctx.gage.name}})),
  lockKeys:extra.source==='JACKPOT'?[`jackpot:${ctx.lobbyId}`]:[],
  audit:{category:extra.source==='JACKPOT'?'JACKPOT':'WHEEL',action:`wheel.${ctx.gage.handler.toLowerCase()}`,message:`${ctx.gage.name} : ${direction==='in'?'+':'−'}${amount} ₽ pour ${account.name}`}});
};

const fmt=(n:number)=>`${n.toLocaleString('fr-FR')} ₽`;
// Whose game a gage changes (beneficiary or target).
const whom=(ctx:HandlerContext,who:'OWNER'|'TARGET')=>who==='TARGET'?needTarget(ctx):ctx.owner;
// One Pokémon of a party: random, highest or lowest level, or the slot chosen after the draw.
const pickPokemon=(ctx:HandlerContext,account:Account,selector:'random'|'highest'|'lowest'|'choice',capability:'pokemon.replace'|'pokemon.remove')=>{
 const {state}=ctx.services.currentGame.requireState(ctx.lobbyId,account.id,{capabilities:[capability]});
 const party=[...state.party];
 if(!party.length)throw new DomainError('VALIDATION_FAILED',`${account.name} n’a pas de Pokémon`);
 const slot=selector==='choice'?ctx.choice.slot:selector==='random'?party[randomInt(party.length)]!.slot
  :[...party].sort((a,b)=>selector==='highest'?b.level-a.level:a.level-b.level)[0]!.slot;
 const pokemon=party.find(p=>p.slot===slot);
 if(!pokemon)throw new DomainError('VALIDATION_FAILED','Choisissez l’emplacement du Pokémon');
 const raw=gen3PartyRaw(pokemon);
 if(!raw)throw new DomainError('CAPABILITY_MISSING','Le client n’envoie pas la copie exacte de ce Pokémon');
 return {pokemon,raw,state,label:`${pokemon.nickname||pokemon.speciesName} (niv. ${pokemon.level})`};
};
const outOfBattle=(ctx:HandlerContext)=>ctx.choice.confirmOutOfBattle===true;
// Bag commands: sent once (an unknown outcome is to check, never replayed).
const itemCommand=async(ctx:HandlerContext,account:Account,command:'game.item.add'|'game.item.take_random',payload:Record<string,unknown>)=>{
 const {services}=ctx;
 return services.commands.withPlayerLock(ctx.lobbyId,account.id,async()=>{
  const {context,playerId}=services.currentGame.requireState(ctx.lobbyId,account.id,{capabilities:['items.write']});
  const outcome=await services.commands.send({lobbyId:ctx.lobbyId,accountId:account.id,playerId,runId:context.run?.id??null,actorAccountId:ctx.actorId,command,payload});
  if(outcome.status!=='COMPLETED')GameCommandService.raise(outcome);
  return outcome.result as {itemId:number};
 });
};
const itemName=(id:number)=>gen3Items.find(i=>i[0]===id)?.[2]??`objet n°${id}`;
const payout=(ctx:HandlerContext)=>({actorAccountId:ctx.actorId,idempotencyKey:key(ctx,'jackpot'),label:ctx.gage.name,metadata:{resolutionId:ctx.resolutionId}});
// A passive drawn among compatible, enabled, not owned ones; no fake success when there is none.
const grantPassive=(ctx:HandlerContext,rarities:PassiveRarity[])=>{
 const {passives}=ctx.services;
 const passive=passives.pick(ctx.lobbyId,ctx.owner.id,{rarities});
 if(!passive)throw new DomainError('NO_PASSIVE_AVAILABLE',`Aucun passif ${rarities.map(r=>passiveRarityLabels[r]).join(' / ')} compatible à donner à ${ctx.owner.name}`);
 passives.grant(ctx.lobbyId,ctx.owner.id,passive.id,'WHEEL',{actorId:ctx.actorId,metadata:{resolutionId:ctx.resolutionId,wheel:ctx.gage.name},
  announce:`✨ ${passive.rarity==='LEGENDARY'?'Passif légendaire':'Nouveau passif'} — ${ctx.gage.name} accorde « ${passive.name} » à ${ctx.owner.name}`});
 return `${ctx.owner.name} obtient le passif « ${passive.name} » (${passiveRarityLabels[passive.rarity]})`;
};
const jackpotResult=(ctx:HandlerContext,paid:number,suffix='')=>paid>0?`${ctx.owner.name} remporte ${fmt(paid)} du jackpot${suffix}`:'Le jackpot est vide : rien à gagner cette fois';

/** Every handler is server code covered by tests; a gage only selects one and gives it validated parameters. */
export const wheelHandlers:Record<GageHandler,Handler>={
 NOTICE:async ctx=>`${ctx.target?.name??ctx.owner.name} doit réaliser le gage « ${ctx.gage.name} »${ctx.gage.description?` : ${ctx.gage.description}`:''}`,
 GIVE_MONEY:async ctx=>{const {amount}=params(ctx,'GIVE_MONEY');await gameMoney(ctx,ctx.owner,amount,'in','give');return `${ctx.owner.name} gagne ${fmt(amount)}`;},
 TAKE_MONEY:async ctx=>{
  const target=needTarget(ctx),{amount}=params(ctx,'TAKE_MONEY');
  const share=depositSplit(amount,ctx.services.domain.lobbies.settings(ctx.lobbyId).wheelJackpotPercent).tax;
  await gameMoney(ctx,target,amount,'out','take',{jackpotShare:share});
  return `${target.name} perd ${fmt(amount)}${share?` (dont ${fmt(share)} au jackpot)`:''}`;
 },
 STEAL_MONEY:async ctx=>{
  const target=needTarget(ctx),{amount}=params(ctx,'STEAL_MONEY');
  if(target.id===ctx.owner.id)throw new DomainError('VALIDATION_FAILED','On ne se braque pas soi-même');
  // Two games are involved: debit first, then credit. A failed credit is reported for review, never retried silently.
  await gameMoney(ctx,target,amount,'out','steal-debit');
  try{await gameMoney(ctx,ctx.owner,amount,'in','steal-credit');}
  catch(error){throw new DomainError('COMMAND_OUTCOME_UNKNOWN',`${fmt(amount)} retirés à ${target.name} mais non crédités à ${ctx.owner.name} : à vérifier`,{cause:error instanceof DomainError?error.code:'INTERNAL_ERROR'});}
  return `${ctx.owner.name} braque ${fmt(amount)} à ${target.name}`;
 },
 REMOVE_POKEMON:async ctx=>{
  const target=needTarget(ctx),{selector}=params(ctx,'REMOVE_POKEMON');
  const {state}=ctx.services.currentGame.requireState(ctx.lobbyId,target.id,{capabilities:['pokemon.remove']});
  if(state.party.length<=1)throw new DomainError('LAST_POKEMON',`${target.name} n’a plus qu’un Pokémon`);
  const party=[...state.party];
  const slot=selector==='choice'?ctx.choice.slot:selector==='random'?party[randomInt(party.length)].slot
   :[...party].sort((a,b)=>selector==='highest'?b.level-a.level:a.level-b.level)[0].slot;
  const pokemon=party.find(p=>p.slot===slot);
  if(!pokemon)throw new DomainError('VALIDATION_FAILED','Choisissez le Pokémon à retirer');
  await ctx.services.pokemon.apply(ctx.lobbyId,target.id,actor(ctx),{action:'remove',slot:pokemon.slot,confirmOutOfBattle:ctx.choice.confirmOutOfBattle===true});
  return `${target.name} perd ${pokemon.nickname||pokemon.speciesName} (niv. ${pokemon.level})`;
 },
 GIVE_LIBRARY_POKEMON:async ctx=>{
  const {artifactId}=params(ctx,'GIVE_LIBRARY_POKEMON');
  const item=ctx.services.library.require(artifactId);
  await ctx.services.pokemon.apply(ctx.lobbyId,ctx.owner.id,actor(ctx),{action:'insert',artifactId,confirmOutOfBattle:ctx.choice.confirmOutOfBattle===true});
  return `${ctx.owner.name} reçoit ${item.label}`;
 },
 JACKPOT_FIXED:async ctx=>{const {amount}=params(ctx,'JACKPOT_FIXED');return jackpotResult(ctx,await ctx.services.jackpot.pay(ctx.lobbyId,ctx.owner,amount,payout(ctx)));},
 JACKPOT_PERCENT:async ctx=>{const {percent}=params(ctx,'JACKPOT_PERCENT');return jackpotResult(ctx,await ctx.services.jackpot.payPercent(ctx.lobbyId,ctx.owner,percent,payout(ctx)),` (${percent} %)`);},
 JACKPOT_EMPTY:async ctx=>jackpotResult(ctx,await ctx.services.jackpot.payAll(ctx.lobbyId,ctx.owner,payout(ctx)),' : le jackpot est vidé !'),
 JACKPOT_SHARE:async ctx=>{
  const {lobbies,accounts}=ctx.services.domain;
  // Shared between members whose game can receive money right now.
  const eligible=lobbies.members(ctx.lobbyId).map(m=>accounts.get(m.accountId)!).filter(a=>{try{ctx.services.currentGame.require(ctx.lobbyId,a.id,{capabilities:['money.write']});return true;}catch{return false;}});
  const {each,paid,failed}=await ctx.services.jackpot.share(ctx.lobbyId,eligible,{actorAccountId:ctx.actorId,idempotencyKey:key(ctx,'share'),label:ctx.gage.name});
  if(each<=0)return 'Personne ne peut recevoir le jackpot pour l’instant';
  if(failed.length)throw new DomainError('GAME_COMMAND_FAILED',`Jackpot partagé : ${paid.map(a=>a.name).join(', ')||'personne'} payé(s), échec pour ${failed.map(a=>a.name).join(', ')}`);
  return `Le jackpot est partagé : ${fmt(each)} pour ${paid.map(a=>a.name).join(', ')}`;
 },
 PASSIVE_GRANT_RANDOM:async ctx=>grantPassive(ctx,params(ctx,'PASSIVE_GRANT_RANDOM').rarities),
 PASSIVE_GRANT_RARITY:async ctx=>grantPassive(ctx,[params(ctx,'PASSIVE_GRANT_RARITY').rarity]),
 // A real transfer (with progression), atomic in SQLite; the stolen passive is chosen after the draw.
 PASSIVE_STEAL:async ctx=>{
  const target=needTarget(ctx);
  if(target.id===ctx.owner.id)throw new DomainError('VALIDATION_FAILED','On ne se vole pas soi-même');
  if(!ctx.choice.passiveId)throw new DomainError('VALIDATION_FAILED','Choisissez le passif à voler');
  const {passives}=ctx.services;
  passives.transfer(ctx.lobbyId,target.id,ctx.owner.id,ctx.choice.passiveId,{actorId:ctx.actorId,source:'WHEEL',metadata:{resolutionId:ctx.resolutionId,wheel:ctx.gage.name}});
  return `${ctx.owner.name} vole « ${passiveById.get(ctx.choice.passiveId)?.name} » à ${target.name}`;
 },
 // A real trainer battle in the fighter's game. The gage succeeds once the battle is created and queued; its
 // start and result are followed by the battle itself (it may wait for a safe moment in the game).
 START_BATTLE:async ctx=>{
  const p=params(ctx,'START_BATTLE');
  const fighter=p.fighter==='TARGET'?needTarget(ctx):ctx.owner;
  const other=p.fighter==='TARGET'?ctx.owner:ctx.target;
  // A player who chooses himself fights his own team (mirror): there is no « other » player then.
  const opponent=p.builder==='OTHER_PLAYER'?(other??needTarget(ctx)):null;
  const builder=opponent&&opponent.id!==fighter.id?{type:'OTHER_PLAYER' as const,opponentId:opponent.id}:p.builder==='LEADER'?{type:'LEADER' as const}:{type:'MIRROR' as const};
  const battle=ctx.services.battles.createFrom(ctx.lobbyId,{accountId:fighter.id,builder,scaling:p.scaling,trainer:p.spriteId?{spriteId:p.spriteId}:{}},ctx.actorId);
  return `Combat lancé : ${fighter.name} VS ${battle.trainer.name} (${battle.party.length} Pokémon, niv. ${battle.party.map(m=>m.level).join(' / ')}) — il démarre dès que ${fighter.name} est libre sur la carte`;
 },
 ITEM_GIVE:async ctx=>{
  const p=params(ctx,'ITEM_GIVE'),account=whom(ctx,p.who),got:string[]=[];
  for(let i=0;i<p.count;i++){
   const item=gen3Items[randomInt(gen3Items.length)]!;
   try{await itemCommand(ctx,account,'game.item.add',{itemId:item[0]});got.push(item[2]);}
   catch(error){if(!got.length)throw error;break;}// pocket full after some items: keep what was given
  }
  return `${account.name} reçoit ${got.join(', ')}`;
 },
 ITEM_TAKE:async ctx=>{
  const p=params(ctx,'ITEM_TAKE'),account=whom(ctx,p.who),lost:string[]=[];
  for(let i=0;i<p.count;i++){
   try{lost.push(itemName((await itemCommand(ctx,account,'game.item.take_random',{})).itemId));}
   catch(error){
    const empty=error instanceof DomainError&&error.details?.clientError==='bag_empty';
    if(empty&&!lost.length)return `${account.name} n’a aucun objet à perdre`;
    if(empty)break;
    throw error;
   }
  }
  return `${account.name} perd ${lost.join(', ')}`;
 },
 POKEMON_TRANSFER:async ctx=>{
  const p=params(ctx,'POKEMON_TRANSFER'),target=needTarget(ctx);
  const [from,to]=p.direction==='GIVE'?[ctx.owner,target]:[target,ctx.owner];
  const {pokemon,raw,state,label}=pickPokemon(ctx,from,p.selector,'pokemon.remove');
  if(state.party.length<=1)throw new DomainError('LAST_POKEMON',`${from.name} n’a plus qu’un Pokémon`);
  const dest=ctx.services.currentGame.requireState(ctx.lobbyId,to.id,{capabilities:['pokemon.insert']}).state;
  if(dest.party.length>=6)throw new DomainError('PARTY_FULL',`L’équipe de ${to.name} est complète`);
  await ctx.services.pokemon.removeSlot(ctx.lobbyId,from.id,actor(ctx),pokemon.slot,outOfBattle(ctx));
  try{await ctx.services.pokemon.insertRaw(ctx.lobbyId,to.id,actor(ctx),raw,true);}
  catch(error){
   // Put it back where it was: never lose a Pokémon between two games.
   await ctx.services.pokemon.insertRaw(ctx.lobbyId,from.id,actor(ctx),raw,true).catch(()=>{});
   throw error;
  }
  return `${label} passe de l’équipe de ${from.name} à celle de ${to.name}`;
 },
 POKEMON_LEVEL:async ctx=>{
  const p=params(ctx,'POKEMON_LEVEL'),account=whom(ctx,p.who);
  const {pokemon,raw,label}=pickPokemon(ctx,account,p.selector,'pokemon.replace');
  const level=Math.max(1,Math.min(100,pokemon.level+p.delta));
  if(level===pokemon.level)return `${label} de ${account.name} est déjà au niveau ${level}`;
  const copy=decodePokemonCopy(raw),speciesId=nationalSpecies.get(copy.internalSpecies)!;
  const {pokemon:data,experience}=await ctx.services.levelData(speciesId,level).catch(()=>{throw new DomainError('VALIDATION_FAILED','PokéAPI indisponible : niveau inchangé');});
  const stats=calculateStats(data,{speciesId,level,nature:copy.nature,ivs:copy.ivs as PokemonInjection['ivs'],evs:copy.evs as PokemonInjection['evs']});
  await ctx.services.pokemon.replaceRaw(ctx.lobbyId,account.id,actor(ctx),pokemon.slot,withLevel(raw,{level,experience,stats}),outOfBattle(ctx));
  return `${label} de ${account.name} ${level>pokemon.level?'monte':'descend'} au niveau ${level}`;
 },
 MAGIKARP_CURSE:async ctx=>{
  const p=params(ctx,'MAGIKARP_CURSE'),account=whom(ctx,p.who);
  const {pokemon,raw,label}=pickPokemon(ctx,account,p.selector,'pokemon.replace');
  await ctx.services.pokemon.replaceRaw(ctx.lobbyId,account.id,actor(ctx),pokemon.slot,magikarpFrom(raw),outOfBattle(ctx));
  return `🐟 Malédiction : ${label} de ${account.name} devient un Magicarpe niveau 1`;
 },
 BOARD_BATTLE:async ctx=>{
  const p=params(ctx,'BOARD_BATTLE');
  // Levels around the beneficiary's team (their last observed party).
  let levels:number[];
  try{levels=ctx.services.currentGame.requireState(ctx.lobbyId,ctx.owner.id,{capabilities:['party.read'],requireRun:false,requireFresh:false}).state.party.map(m=>m.level);}
  catch{throw new DomainError('GAME_ADAPTER_NOT_READY',`Équipe de ${ctx.owner.name} illisible : lancez son jeu pour calibrer les niveaux`);}
  if(!levels.length)throw new DomainError('GAME_ADAPTER_NOT_READY',`${ctx.owner.name} n’a pas encore de Pokémon`);
  const average=levels.reduce((a,b)=>a+b,0)/levels.length;
  const team=await ctx.services.board.create(ctx.lobbyId,{slots:wheelSlots(average,p as {count:number;spread:number;legendary:'NO'|'ALLOWED'|'ONLY'})},ctx.actorId,'WHEEL');
  return `Nouveau combat au tableau : ${team.trainer.name} (${team.party.length} Pokémon, niv. ${team.party.map(m=>m.level).join(' / ')}) — récompense ${fmt(team.reward)} pour le premier qui le remporte`;
 }
};
