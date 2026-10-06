import type {PokemonInjection} from '@pokerace/shared';
import type {PassiveContext,PassiveHandler} from './passive-events.js';

const name=(ctx:PassiveContext,accountId=ctx.accountId)=>ctx.services.domain.accounts.get(accountId)?.name??accountId;
const fmt=(n:number)=>`${n.toLocaleString('fr-FR')} ₽`;
// A big area: interiors are named "Town — Building — Floor", the town is what counts.
export const areaOf=(label:string)=>label.startsWith('Zone inconnue')?null:label.split(' — ')[0].trim()||null;
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
 }}
};

export const implementedPassives:ReadonlySet<string>=new Set(Object.keys(passiveHandlers));
