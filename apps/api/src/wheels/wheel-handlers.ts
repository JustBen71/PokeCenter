import {randomInt} from 'node:crypto';
import {depositSplit,gageParamsSchemas,passiveById,passiveRarityLabels,type Account,type Gage,type GageHandler,type PassiveRarity} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import type {Services} from '../services.js';

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
  const builder=p.builder==='OTHER_PLAYER'?{type:'OTHER_PLAYER' as const,opponentId:(other??needTarget(ctx)).id}:{type:p.builder as 'MIRROR'|'LEADER'};
  const battle=ctx.services.battles.createFrom(ctx.lobbyId,{accountId:fighter.id,builder,scaling:p.scaling,trainer:p.spriteId?{spriteId:p.spriteId}:{}},ctx.actorId);
  return `Combat lancé : ${fighter.name} VS ${battle.trainer.name} (${battle.party.length} Pokémon, niv. ${battle.party.map(m=>m.level).join(' / ')}) — il démarre dès que ${fighter.name} est libre sur la carte`;
 }
};
