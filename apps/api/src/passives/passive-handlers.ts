import {gen3PartyRaw,passiveById,type PokemonInjection} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import type {PassiveContext,PassiveHandler} from './passive-events.js';
import {gamePassiveHandlers} from './passive-game-handlers.js';

const name=(ctx:PassiveContext,accountId=ctx.accountId)=>ctx.services.domain.accounts.get(accountId)?.name??accountId;
const fmt=(n:number)=>`${n.toLocaleString('fr-FR')} ₽`;
// A big area: interiors are named "Town — Building — Floor", the town is what counts.
export const areaOf=(label:string)=>label.startsWith('Zone inconnue')?null:label.split(' — ')[0].trim()||null;
// The other player an action names: a lobby member, not the holder.
const requireOther=(ctx:PassiveContext,id:string|undefined)=>{
 if(!id||id===ctx.accountId||!ctx.services.domain.lobbies.isMember(ctx.lobbyId,id))throw new DomainError('VALIDATION_FAILED','Choisissez un autre joueur du lobby');
 return id;
};
const statLabels:Record<string,string>={maxHp:'PV max',attack:'Attaque',defense:'Défense',speed:'Vitesse',spAttack:'Attaque Spé.',spDefense:'Défense Spé.'};

/**
 * Server behaviour of each implemented passive, keyed by catalogue id. A catalogue entry without a handler
 * here is NOT_YET_IMPLEMENTED and is never offered. Adding a passive = one catalogue entry + one handler + tests.
 * Handlers only use validated capabilities (location, party, progression, money) and server data.
 */
export const passiveHandlers:Record<string,PassiveHandler>={
 // Cartographe: each new big area counts once for the whole race; every N areas, a kind wheel ticket.
 cartographer:{observe:async(ctx,state)=>{
  const area=areaOf(state.location.label);if(!area)return;
  const places=ctx.get<string[]>('places',[]);if(places.includes(area))return;
  places.push(area);ctx.set('places',places);
  const every=ctx.passive.params.every;
  if(places.length%every===0){
   ctx.notify(`🗺 Cartographe — ${name(ctx)} a découvert ${places.length} lieux : +1 ticket bienveillant`);
   await ctx.reward(`cartographer:${places.length}`,{type:'TICKET',tone:'GOOD',reason:`${places.length} lieux découverts`});
  }
 }},

 // Collectionneur: distinct species that went through the team during the race.
 collector:{observe:async(ctx,state)=>{
  const species=ctx.get<number[]>('species',[]);
  const fresh=[...new Set(state.party.map(p=>p.speciesId))].filter(id=>!species.includes(id));
  if(!fresh.length)return;
  const every=ctx.passive.params.every,before=species.length;
  species.push(...fresh);ctx.set('species',species);
  for(let n=Math.floor(before/every)+1;n*every<=species.length;n++){
   ctx.notify(`📚 Collectionneur — ${name(ctx)} a fait jouer ${n*every} espèces différentes : +1 ticket bienveillant`);
   await ctx.reward(`collector:${n*every}`,{type:'TICKET',tone:'GOOD',reason:`${n*every} espèces différentes`});
  }
 }},

 // Brocanteur: after N lost auctions, one real stat of the next lot joined is revealed to this player only.
 'bargain-hunter':{on:{
  AUCTION_LOST:ctx=>{
   const losses=ctx.get('losses',0)+1;
   if(losses>=ctx.passive.params.losses){ctx.set('losses',0);ctx.set('armed',true);ctx.notify('🔎 Brocanteur — ta prochaine enchère révélera une vraie statistique du lot',{private:true});}
   else ctx.set('losses',losses);
  },
  AUCTION_JOINED:(ctx,event)=>{
   if(!ctx.get('armed',false))return 'not armed';
   const row=ctx.services.domain.db.prepare("SELECT template_json,name FROM lobby_auctions WHERE id=? AND lobby_id=? AND status='OPEN'").get(event.data.auctionId,ctx.lobbyId) as {template_json:string;name:string}|undefined;
   if(!row)return 'auction closed';
   // One stat only, never the whole template; the value is sent to the player alone and not stored in the public progression.
   const stats=(JSON.parse(row.template_json) as PokemonInjection).stats;
   const key=Object.keys(statLabels)[ctx.services.passives.random(Object.keys(statLabels).length)] as keyof typeof stats;
   ctx.set('armed',false);
   ctx.notify(`🔎 Brocanteur — ${row.name} : ${statLabels[key]} = ${stats[key]} (valeur exacte)`,{private:true});
   ctx.audit('passive.reveal',`Brocanteur : une statistique de ${row.name} révélée à ${name(ctx)}`,{auctionId:event.data.auctionId,stat:key});
   return {stat:key};
  }
 }},

 // Éclaireur: after an objective, the next one and its reward are revealed to the player.
 scout:{on:{OBJECTIVE_COMPLETED:(ctx,event)=>{
  const done=new Set(ctx.services.objectives.completions(ctx.lobbyId).filter(c=>c.accountId===ctx.accountId).map(c=>c.objectiveId));
  const next=ctx.services.objectives.list(ctx.lobbyId).filter(o=>o.enabled&&!done.has(o.id)).sort((a,b)=>a.order-b.order)[0];
  ctx.set('next',next?`${next.name}${next.rewardMoney?` · récompense ${fmt(next.rewardMoney)}`:''}`:null);
  if(next&&!event.data.initial)ctx.notify(`🔭 Éclaireur — prochain objectif : ${next.name}${next.rewardMoney?` (récompense ${fmt(next.rewardMoney)})`:''}`,{private:true});
  return next?.id??null;
 }}},

 // Deuxième souffle: a Run started right after a lost one begins with extra money, a limited number of times.
 'second-wind':{on:{RUN_STARTED:async(ctx,event)=>{
  if(!event.data.afterLoss)return 'not after a loss';
  const uses=ctx.get('uses',0),{max,amount}=ctx.passive.params;
  if(uses>=max)return 'exhausted';
  ctx.set('uses',uses+1);if(uses+1>=max)ctx.set('consumed',true);
  await ctx.reward(`second-wind:${event.data.runId}`,{type:'MONEY',amount,reason:`Deuxième souffle, Run #${event.data.number}`});
 }}},

 // Contre-sort: a hostile wheel cannot inflict the same gage as the previous hostile wheel suffered.
 counterspell:{
  filterHostileGages:(ctx,gages)=>{
   const last=ctx.get<{id:string;name:string}|null>('lastBadGage',null);
   if(!last)return gages;
   const kept=gages.filter(g=>g.id!==last.id);
   if(!kept.length){ctx.audit('counterspell_fallback',`Contre-sort : la roue n’a qu’un gage possible, « ${last.name} » reste tirable`);return gages;}
   if(kept.length<gages.length)ctx.notify(`🛡 Contre-sort — le dernier malus subi par ${name(ctx)} est retiré du tirage`);
   return kept;
  },
  on:{WHEEL_RESOLVED:(ctx,event)=>{
   if(event.data.role!=='target'||event.data.tone!=='BAD')return 'ignored';
   ctx.set('lastBadGage',{id:event.data.gageId,name:event.data.gageName});
  }}
 },

 // Rivalité: overtaking players in the ranking sends one hostile wheel to the first player overtaken.
 rivalry:{on:{OBJECTIVE_COMPLETED:async(ctx,event)=>{
  if(event.data.initial)return 'initial';
  // Objectives reached together are one ranking move, evaluated on the last of them.
  if(event.data.batch.at(-1)!==event.data.objectiveId)return 'batched';
  const {objectives}=ctx.services,me=ctx.accountId;
  const before=objectives.scores(ctx.lobbyId,{accountId:me,objectiveIds:event.data.batch}),after=objectives.scores(ctx.lobbyId);
  const from=before.get(me)??0,to=after.get(me)??0;
  // The rank must really improve (ties share a rank); an opponent is overtaken if they were ahead or tied
  // and are now strictly behind. The first one overtaken is the closest one ahead.
  const others=[...after].filter(([id])=>id!==me);
  const rank=(score:number)=>others.filter(([,s])=>s>score).length+1;
  if(rank(to)>=rank(from))return 'rank unchanged';
  const overtaken=others.filter(([,score])=>score>=from&&score<to).sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0]));
  if(!overtaken.length)return 'no overtake';
  const victim=overtaken[0][0];
  ctx.notify(`⚔ Rivalité — ${name(ctx)} dépasse ${name(ctx,victim)} : ${name(ctx,victim)} reçoit une roue hostile`,{kind:'warning'});
  await ctx.reward(`rivalry:${event.data.objectiveId}`,{type:'TICKET',tone:'BAD',targetId:victim,reason:`${name(ctx)} dépasse ${name(ctx,victim)}`});
  return {victim};
 }}},

 // Le sixième homme: each new badge obtained with six Pokémon gives a kind wheel; a badge counts once.
 'sixth-man':{observe:async(ctx,state)=>{
  const badges=state.progression.completed.filter(id=>/^badge\d+$/.test(id));
  const known=ctx.get<string[]|null>('badges',null);
  // First observation: badges already owned are the baseline, never rewarded.
  if(known===null){ctx.set('badges',badges);return;}
  const fresh=badges.filter(b=>!known.includes(b));
  if(!fresh.length)return;
  ctx.set('badges',[...known,...fresh]);
  if(state.party.length<6){ctx.audit('passive.skip',`Le sixième homme : badge obtenu avec ${state.party.length} Pokémon, pas de roue`,{badges:fresh});return;}
  const rewarded=ctx.get<string[]>('rewarded',[]);
  for(const badge of fresh){
   rewarded.push(badge);ctx.set('rewarded',rewarded);
   ctx.notify(`🏅 Le sixième homme — ${name(ctx)} obtient un badge avec 6 Pokémon : +1 roue bienveillante`);
   await ctx.reward(`sixth-man:${badge}`,{type:'TICKET',tone:'GOOD',reason:'badge obtenu avec 6 Pokémon'});
  }
 }},
 // ---- Légendaires réalisables côté serveur (aucune nouvelle source mémoire). ----

 // Usurpateur: once in the race, copies a non-legendary passive of an opponent, who keeps it.
 usurper:{act:(ctx,input)=>{
  if(input.action!=='copy')throw new DomainError('VALIDATION_FAILED','Usurpateur : choisissez un adversaire et un de ses passifs');
  if(ctx.get('consumed',false))throw new DomainError('CONFLICT','Usurpateur a déjà été utilisé');
  const target=requireOther(ctx,input.targetId),passiveId=input.passiveId??'';
  const passive=passiveById.get(passiveId);
  if(!passive||!ctx.services.passives.has(ctx.lobbyId,target,passiveId))throw new DomainError('PASSIVE_NOT_OWNED',`${name(ctx,target)} ne possède pas ce passif`);
  if(passive.rarity==='LEGENDARY')throw new DomainError('VALIDATION_FAILED','Un passif légendaire ne se copie pas');
  ctx.services.passives.grant(ctx.lobbyId,ctx.accountId,passiveId,'EVENT',{quiet:true,metadata:{copiedFrom:target,via:'usurper'}});
  ctx.set('consumed',true);ctx.set('copied',passive.name);
  return `Usurpateur — ${name(ctx)} copie « ${passive.name} » de ${name(ctx,target)}`;
 }},

 // Lien du destin: each 3 new objectives of one of the pair give the other a kind wheel ticket.
 'fate-link':{
  act:(ctx,input)=>{
   if(input.action!=='link')throw new DomainError('VALIDATION_FAILED','Lien du destin : choisissez un joueur');
   if(ctx.get<string|null>('partner',null))throw new DomainError('CONFLICT','Le lien est déjà formé');
   const partner=requireOther(ctx,input.targetId);
   ctx.set('partner',partner);ctx.set('partnerName',name(ctx,partner));ctx.set('mine',0);ctx.set('theirs',0);
   return `Lien du destin — ${name(ctx)} se lie à ${name(ctx,partner)}`;
  },
  on:{OBJECTIVE_COMPLETED:async(ctx,event)=>{
   const partner=ctx.get<string|null>('partner',null);if(!partner||event.data.initial)return 'ignored';
   const mine=ctx.get('mine',0)+1;ctx.set('mine',mine);
   if(mine%ctx.passive.params.objectives===0)await ctx.reward(`fate-link:${ctx.accountId}:${mine}`,{type:'TICKET',tone:'GOOD',reason:`${name(ctx)} cumule ${mine} objectifs`},partner);
  }},
  others:{OBJECTIVE_COMPLETED:async(ctx,event)=>{
   if(ctx.get<string|null>('partner',null)!==event.accountId||event.data.initial)return 'ignored';
   const theirs=ctx.get('theirs',0)+1;ctx.set('theirs',theirs);
   if(theirs%ctx.passive.params.objectives===0)await ctx.reward(`fate-link:${event.accountId}:${theirs}`,{type:'TICKET',tone:'GOOD',reason:`${name(ctx,event.accountId)} cumule ${theirs} objectifs`});
  }}
 },

 // Couronne du champion: while #1, each objective is a charge; 3 charges = choose one of 3 Common/Uncommon passives.
 'champion-crown':{
  on:{OBJECTIVE_COMPLETED:(ctx,event)=>{
   if(event.data.initial||event.data.batch.at(-1)!==event.data.objectiveId)return 'ignored';
   const scores=ctx.services.objectives.scores(ctx.lobbyId),mine=scores.get(ctx.accountId)??0;
   if([...scores].some(([id,s])=>id!==ctx.accountId&&s>mine))return 'not first';
   if(ctx.get<string[]|null>('offer',null))return 'offer pending';
   const charges=ctx.get('charges',0)+1;
   if(charges<ctx.passive.params.charges){ctx.set('charges',charges);return {charges};}
   const offer:string[]=[];
   for(let i=0;i<3;i++){const p=ctx.services.passives.pick(ctx.lobbyId,ctx.accountId,{rarities:['COMMON','UNCOMMON'],exclude:offer});if(p)offer.push(p.id);}
   if(!offer.length){ctx.set('charges',charges);return 'nothing to offer';}
   ctx.set('charges',0);ctx.set('offer',offer);
   ctx.notify(`👑 Couronne du champion — choisis un nouveau passif parmi ${offer.length}`,{private:true});
   return {offer};
  }},
  act:(ctx,input)=>{
   const offer=ctx.get<string[]|null>('offer',null);
   if(input.action!=='choose'||!offer)throw new DomainError('CONFLICT','Aucune offre de la Couronne en attente');
   if(!input.passiveId||!offer.includes(input.passiveId))throw new DomainError('VALIDATION_FAILED','Ce passif ne fait pas partie de l’offre');
   ctx.services.passives.grant(ctx.lobbyId,ctx.accountId,input.passiveId,'EVENT',{quiet:true,metadata:{via:'champion-crown'}});
   ctx.set('offer',null);
   return `Couronne du champion — ${name(ctx)} obtient « ${passiveById.get(input.passiveId)!.name} »`;
  }
 },

 // Sixième sens: a kind wheel won by the holder draws 2 gages, the holder picks one (every time).
 'sixth-sense':{wheelChoice:(ctx,draw)=>draw.tone==='GOOD'&&draw.role==='owner'&&draw.gageCount>=2?2:null},

 // Maître du chaos: once, a hostile wheel against the holder draws 3 different gages, the holder picks one.
 'chaos-master':{wheelChoice:(ctx,draw)=>{
  if(draw.tone!=='BAD'||draw.role!=='target'||draw.gageCount<2||ctx.get('consumed',false))return null;
  ctx.set('consumed',true);ctx.audit('passive.chaos','Maître du chaos : le joueur choisira son gage');
  return Math.min(3,draw.gageCount);
 }},

 // Paradoxe: once, undoes the latest reversible negative Pokérace action (hostile ticket waiting, consumed
 // protection, money taken by a wheel). Never an arbitrary RAM or Pokémon rollback.
 paradox:{act:async(ctx,input)=>{
  if(input.action!=='undo')throw new DomainError('VALIDATION_FAILED','Paradoxe : action inconnue');
  if(ctx.get('consumed',false))throw new DomainError('CONFLICT','Paradoxe a déjà été utilisé');
  const {db}=ctx.services.domain,me=ctx.accountId,lobby=ctx.lobbyId;
  const ticket=db.prepare("SELECT t.id,t.queued_at AS at,w.name FROM wheel_tickets t JOIN wheel_types w ON w.id=t.wheel_type_id WHERE t.lobby_id=? AND t.recipient_account_id=? AND t.status='QUEUED' AND w.tone='BAD' ORDER BY t.queued_at DESC LIMIT 1").get(lobby,me) as {id:string;at:string;name:string}|undefined;
  const protection=db.prepare("SELECT id,used_at AS at FROM protections WHERE lobby_id=? AND account_id=? AND status='USED' ORDER BY used_at DESC LIMIT 1").get(lobby,me) as {id:string;at:string}|undefined;
  const money=db.prepare(`SELECT command_id AS id,MAX(confirmed_at) AS at,SUM(amount) AS amount FROM money_transactions WHERE lobby_id=? AND account_id=? AND status='CONFIRMED' AND source='GAME'
   AND type IN ('WHEEL_TRANSFER','JACKPOT_CONTRIBUTION') AND json_extract(metadata_json,'$.resolutionId') IS NOT NULL GROUP BY command_id ORDER BY at DESC LIMIT 1`).get(lobby,me) as {id:string;at:string;amount:number}|undefined;
  const latest=[ticket&&{kind:'ticket' as const,...ticket},protection&&{kind:'protection' as const,...protection},money&&{kind:'money' as const,...money}]
   .filter(<T>(x:T|undefined|0|''):x is T=>!!x).sort((a,b)=>b.at.localeCompare(a.at))[0];
  if(!latest)throw new DomainError('CONFLICT','Aucune action négative réversible à annuler');
  let message:string;
  if(latest.kind==='ticket'){ctx.services.shop.cancelQueuedTicket(lobby,latest.id);message=`le ticket hostile « ${ticket!.name} » est annulé`;}
  else if(latest.kind==='protection'){ctx.services.shop.restoreProtection(lobby,latest.id);message='la protection consommée est rendue';}
  else{await ctx.reward(`paradox:${latest.id}`,{type:'MONEY',amount:money!.amount,reason:'Paradoxe'});message=`${fmt(money!.amount)} perdus sur une roue sont rendus`;}
  ctx.set('consumed',true);ctx.set('undone',latest.kind);
  return `Paradoxe — pour ${name(ctx)}, ${message}`;
 }},

 // Âme liée: one bound Pokémon (exact server-side copy); after a lost Run an admin may reinject it.
 'bound-soul':{
  act:async(ctx,input,actor)=>{
   if(input.action==='bind'){
    const {state}=ctx.services.currentGame.requireState(ctx.lobbyId,ctx.accountId,{capabilities:['party.read']});
    const pokemon=state.party.find(p=>p.slot===input.slot),raw=gen3PartyRaw(pokemon);
    if(!pokemon)throw new DomainError('VALIDATION_FAILED','Cet emplacement est vide');
    if(!raw)throw new DomainError('CAPABILITY_MISSING','Le client n’envoie pas la copie exacte de ce Pokémon');
    // The exact copy stays server-side (« _ » key); only what is shown on the badge is public.
    ctx.set('_raw',raw);ctx.set('bound',{name:pokemon.nickname||pokemon.speciesName,speciesName:pokemon.speciesName,level:pokemon.level});ctx.set('ready',false);
    return `Âme liée — ${name(ctx)} lie ${pokemon.nickname||pokemon.speciesName} (niv. ${pokemon.level})`;
   }
   if(input.action==='reinject'){
    if(!actor.admin)throw new DomainError('ADMIN_REQUIRED','La réinjection est faite par un admin, hors combat');
    const raw=ctx.get<string|null>('_raw',null),bound=ctx.get<{name:string}|null>('bound',null);
    if(!raw||!ctx.get('ready',false))throw new DomainError('CONFLICT','Aucun Pokémon lié à réinjecter (il faut une Run perdue)');
    if(!ctx.services.domain.runs.running(ctx.lobbyId,ctx.accountId))throw new DomainError('RUN_NOT_RUNNING','La nouvelle Run doit être en cours');
    await ctx.services.pokemon.insertRaw(ctx.lobbyId,ctx.accountId,actor,raw,input.confirmOutOfBattle===true);
    ctx.set('ready',false);
    return `Âme liée — ${bound?.name} rejoint l’équipe de ${name(ctx)}`;
   }
   throw new DomainError('VALIDATION_FAILED','Âme liée : action inconnue');
  },
  on:{RUN_LOST:ctx=>{
   if(!ctx.get('bound',null))return 'nothing bound';
   ctx.set('ready',true);ctx.notify(`🔗 Âme liée — ${ctx.get<{name:string}>('bound',{name:'?'}).name} pourra rejoindre la prochaine Run`,{private:true});
  }}
 },
 ...gamePassiveHandlers
};

export const implementedPassives:ReadonlySet<string>=new Set(Object.keys(passiveHandlers));
