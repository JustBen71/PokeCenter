import {randomUUID} from 'node:crypto';
import {battleCreateSchema,battleSourceLabels,battleStatusLabels,type Account,type BattleCreateInput,type BattlePreview,type BattleResult,type NativeGameState,type BattleEncounter,type BattleEncounterSpec,type BattleScalingSpec,type BattleSourceType,type BattleStatus,type BattlesSnapshot,type LobbyNotification} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import type {PortalDomain} from '../store.js';
import {BattleRepository} from './battle-repository.js';
import {validateBattleSpec} from './battle-validator.js';
import {defaultSprite,partyFromGameState,trainerName} from './battle-builders.js';
import {levelSummary,scaleParty} from './battle-scaling-service.js';
import {parseBody} from '../http.js';
import type {CurrentGameService} from '../game/current-game-service.js';
import type {ObjectiveService} from '../objectives/objective-service.js';
import type {GameCommandService} from '../game/game-command-service.js';

export type BattleSource={type:BattleSourceType;refId:string|null;label:string;scaling:BattleScalingSpec};

/**
 * Commanded battles: creation (frozen spec), queue until the game is in a safe state, sending, lifecycle, result,
 * audit and REVIEW. The game side only executes the final spec; nothing here knows a memory address.
 */
export class BattleEncounterService{
 readonly repository:BattleRepository;
 private readonly inFlight=new Set<string>();
 constructor(private readonly deps:{domain:PortalDomain;currentGame:CurrentGameService;commands:GameCommandService;objectives:()=>ObjectiveService;changed:(lobbyId:string)=>void;notify:(lobbyId:string,n:LobbyNotification,accountId?:string)=>void;
  // A battle reached WON, LOST, CANCELLED or FAILED (the Tableau des combats follows its own battles).
  ended?:(e:BattleEncounter)=>void}){
  this.repository=new BattleRepository(deps.domain.db);
 }
 private name(id:string|null){return id?this.deps.domain.accounts.get(id)?.name??id:'—';}
 private audit(e:BattleEncounter,action:string,message:string,options:{actorId?:string|null;status?:'SUCCESS'|'FAILED'|'INFO'|'REVIEW';metadata?:Record<string,unknown>}={}){
  this.deps.domain.audit.record({lobbyId:e.lobbyId,actorAccountId:options.actorId??null,targetAccountId:e.accountId,runId:e.runId,category:'BATTLE',action,status:options.status??'SUCCESS',
   commandId:e.commandId,message,metadata:{encounterId:e.id,source:e.sourceType,trainer:e.trainer.name,...options.metadata}});
 }
 // A member's live party (exact copies), for a source or for the player's reference levels.
 private party(lobbyId:string,accountId:string){
  const owner=this.deps.domain.accounts.get(accountId);
  if(!owner||!this.deps.domain.lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Ce joueur ne participe pas à ce lobby');
  try{return {owner,state:this.deps.currentGame.requireState(lobbyId,accountId,{capabilities:['party.read'],requireRun:false,requireFresh:false}).state};}
  catch(error){throw new DomainError('BATTLE_SOURCE_UNAVAILABLE',`Équipe de ${owner.name} illisible : ${error instanceof Error?error.message:'jeu non connecté'}`);}
 }

 /**
  * Builds the final battle (what the admin previews and what the game will receive): source snapshot, scaling,
  * trainer identity, then the same validation as at sending time.
  */
 prepare(lobbyId:string,body:unknown):BattlePreview&{accountId:string}{
  const input:BattleCreateInput=parseBody(battleCreateSchema,body);
  const {domain}=this.deps;
  const target=domain.accounts.get(input.accountId);
  if(!target||!domain.lobbies.isMember(lobbyId,target.id))throw new DomainError('NOT_LOBBY_MEMBER','Ce joueur ne participe pas à ce lobby');
  let source:{type:BattleSourceType;refId:string|null;label:string;party:BattleEncounterSpec['party'];name:string;avatar?:string};
  const b=input.builder;
  if(b.type==='CUSTOM')source={type:'CUSTOM_PARTY',refId:null,label:'Équipe personnalisée',party:b.party,name:'RIVAL'};
  else{
   let opponentId=target.id;
   if(b.type==='OTHER_PLAYER'){
    if(b.opponentId===target.id)throw new DomainError('VALIDATION_FAILED','Choisissez un autre joueur, ou le mode Miroir');
    opponentId=b.opponentId;
   }
   if(b.type==='LEADER'){
    // The #1 of the race other than the player (ties: first by id), as on the Course page.
    const ranked=[...this.deps.objectives().scores(lobbyId)].filter(([id])=>id!==target.id).sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]));
    if(!ranked.length)throw new DomainError('BATTLE_SOURCE_UNAVAILABLE','Aucun autre joueur classé');
    opponentId=ranked[0][0];
   }
   const {owner,state}=this.party(lobbyId,opponentId);
   source={type:b.type==='MIRROR'?'CURRENT_PLAYER_PARTY':b.type==='LEADER'?'LEADER_PARTY':'OTHER_PLAYER_CURRENT_PARTY',refId:owner.id,
    label:b.type==='MIRROR'?`Miroir de ${owner.name}`:b.type==='LEADER'?`${owner.name} (#1)`:owner.name,party:partyFromGameState(state,owner.name),name:owner.name,avatar:owner.sprite};
  }
  const needsPlayer=['MATCH_PLAYER_AVERAGE','MATCH_PLAYER_HIGHEST'].includes(input.scaling.mode);
  const playerLevels=needsPlayer||b.type==='MIRROR'?this.party(lobbyId,target.id).state.party.map(p=>p.level):null;
  const party=scaleParty(source.party,input.scaling,playerLevels);
  const spec=validateBattleSpec({encounterId:randomUUID(),trainer:{name:input.trainer.name??trainerName(source.name),spriteId:input.trainer.spriteId??defaultSprite(source.avatar)},party});
  return {accountId:target.id,spec,sourceType:source.type,sourceRefId:source.refId,sourceLabel:source.label,scaling:input.scaling,
   playerLevels:playerLevels?levelSummary(playerLevels):null,sourceLevels:source.party.map(p=>p.level)};
 }

 /** Admin (or a gage): prepares, persists and, unless asked otherwise, queues the battle at once. */
 createFrom(lobbyId:string,body:unknown,actorId:string|null,options:{queue?:boolean}={}){
  const preview=this.prepare(lobbyId,body);
  // Refused before anything is created when the player already has a battle queued, running or uncertain.
  if(options.queue!==false&&this.repository.active(lobbyId,preview.accountId))throw new DomainError('BATTLE_ALREADY_PENDING','Un combat commandité est déjà en attente ou en cours pour ce joueur');
  const created=this.create(lobbyId,preview.accountId,{trainer:preview.spec.trainer,party:preview.spec.party},{type:preview.sourceType,refId:preview.sourceRefId,label:preview.sourceLabel,scaling:preview.scaling},actorId);
  return options.queue===false?created:this.queue(lobbyId,created.id,actorId);
 }

 snapshot(lobbyId:string):BattlesSnapshot{return {encounters:this.repository.list(lobbyId)};}
 get(lobbyId:string,id:string){return this.repository.require(lobbyId,id);}
 active(lobbyId:string,accountId:string){return this.repository.active(lobbyId,accountId);}

 /** Persists a battle with its final spec (snapshot of the source at creation: later changes never alter it). */
 create(lobbyId:string,accountId:string,spec:Omit<BattleEncounterSpec,'encounterId'|'options'>,source:BattleSource,actorId:string|null):BattleEncounter{
  const account=this.deps.domain.accounts.get(accountId);
  if(!account||!this.deps.domain.lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Ce joueur ne participe pas à ce lobby');
  const valid=validateBattleSpec({...spec,encounterId:randomUUID()});
  const encounter=this.repository.insert({id:valid.encounterId,lobbyId,accountId,runId:this.deps.domain.runs.running(lobbyId,accountId)?.id??null,
   sourceType:source.type,sourceRefId:source.refId,sourceLabel:source.label,trainer:valid.trainer,party:valid.party,scaling:source.scaling,createdBy:actorId});
  this.audit(encounter,'battle.created',`${account.name} VS ${valid.trainer.name} (${battleSourceLabels[source.type]} · ${source.label}) : ${valid.party.length} Pokémon, niveaux ${valid.party.map(p=>p.level).join(' / ')}`,
   {actorId,metadata:{levels:valid.party.map(p=>p.level),scaling:source.scaling}});
  this.deps.changed(lobbyId);
  return encounter;
 }

 /** Queues the battle: it is sent as soon as the player's game reports a safe state. */
 queue(lobbyId:string,id:string,actorId:string|null,options:{notify?:boolean}={}){
  const e=this.repository.require(lobbyId,id);
  const {after}=this.repository.transition(e.id,'WAITING_SAFE_STATE');
  this.audit(after,'battle.start_requested',`Combat contre ${after.trainer.name} demandé pour ${this.name(after.accountId)} : il démarrera dès que le jeu sera dans un état sûr`,{actorId});
  if(options.notify!==false)this.deps.notify(lobbyId,{kind:'info',message:`⚔ ${this.name(after.accountId)} va affronter ${after.trainer.name}`});
  this.deps.changed(lobbyId);
  // Already on a safe overworld? Then it leaves now instead of waiting for the next change of the game.
  this.retry(lobbyId,after.accountId);
  return after;
 }

 cancel(lobbyId:string,id:string,actorId:string|null){
  const e=this.repository.require(lobbyId,id);
  if(!['CREATED','WAITING_SAFE_STATE','REVIEW'].includes(e.status))throw new DomainError('CONFLICT',`Un combat « ${battleStatusLabels[e.status]} » ne peut plus être annulé`);
  const {after}=this.repository.transition(e.id,'CANCELLED');
  this.audit(after,'battle.cancelled',`Combat contre ${after.trainer.name} annulé pour ${this.name(after.accountId)}`,{actorId,status:'INFO'});
  this.deps.changed(lobbyId);this.deps.ended?.(after);
  return after;
 }

 /**
  * Called on every observation of a player's game. Sends the queued battle once the game reports a safe state,
  * and follows the client's battle state: started, result, or reconciliation of an uncertain command.
  */
 async observe(lobbyId:string,accountId:string,state:NativeGameState){
  const e=this.repository.active(lobbyId,accountId),battle=state.battle;
  if(!e||!battle||this.inFlight.has(e.id))return;
  if(battle.last?.encounterId===e.id&&e.status!=='WAITING_SAFE_STATE')return this.finish(e,battle.last.outcome);
  if(battle.activeEncounterId===e.id&&(e.status==='STARTING'||e.status==='REVIEW'))return this.started(e);
  if(e.status==='WAITING_SAFE_STATE'&&battle.safe)await this.dispatch(e);
 }

 /** Re-evaluates a player's queued battle with the latest known game state (queue, Run started…). */
 retry(lobbyId:string,accountId:string){
  let state:NativeGameState;
  try{state=this.deps.currentGame.requireState(lobbyId,accountId,{requireRun:false,requireFresh:false}).state;}catch{return;}
  void this.observe(lobbyId,accountId,state).catch(error=>console.error('Battles:',error));
 }

 private started(e:BattleEncounter){
  const after=this.move(e,'RUNNING',{},{action:'battle.started',message:`${this.name(e.accountId)} VS ${e.trainer.name} : le combat a commencé`});
  this.deps.notify(e.lobbyId,{kind:'info',message:`⚔ Combat lancé : ${this.name(e.accountId)} VS ${e.trainer.name}`});
  return after;
 }

 // WIN → WON, LOSS/DRAW → LOST (the Run itself stays under the race rules), ABORTED → FAILED, unknown → REVIEW.
 private finish(e:BattleEncounter,outcome:BattleResult){
  const result={outcome,observedAt:new Date().toISOString()},who=this.name(e.accountId);
  if(outcome==='WIN'||outcome==='LOSS'||outcome==='DRAW'){
   const won=outcome==='WIN';
   const after=this.move(e,won?'WON':'LOST',{result},{action:won?'battle.won':'battle.lost',status:won?'SUCCESS':'INFO',
    message:`${who} VS ${e.trainer.name} : ${won?'victoire':outcome==='DRAW'?'égalité (les deux équipes K.O.), comptée comme défaite':'défaite'}`});
   this.deps.notify(e.lobbyId,{kind:won?'success':'warning',message:won?`✅ Victoire de ${who} contre ${e.trainer.name}`:`❌ Défaite de ${who} contre ${e.trainer.name}`});
   return after;
  }
  if(outcome==='ABORTED'){
   const after=this.move(e,'FAILED',{result,errorCode:'battle_aborted'},{action:'battle.failed',status:'FAILED',message:`${who} VS ${e.trainer.name} : le jeu n’a pas lancé le combat (rien n’a changé)`});
   this.deps.notify(e.lobbyId,{kind:'error',message:`✖ Le combat de ${who} contre ${e.trainer.name} n’a pas démarré`});
   return after;
  }
  if(e.status==='REVIEW')return e;
  return this.move(e,'REVIEW',{result,errorCode:'battle_outcome_unknown'},{action:'battle.review',status:'REVIEW',message:`${who} VS ${e.trainer.name} : résultat illisible, à vérifier`});
 }

 /**
  * One controlled attempt: the battle is sent with a fresh commandId (a refusal is never cached for the next try);
  * the client refuses an encounterId it already started. Unknown outcome = REVIEW, never re-sent automatically.
  */
 private async dispatch(e:BattleEncounter){
  if(this.inFlight.has(e.id))return;
  this.inFlight.add(e.id);
  try{
   let context;
   try{context=this.deps.currentGame.requireState(e.lobbyId,e.accountId,{capabilities:['battle.trainer.start']});}
   catch{return;}// game offline, no Run, capability missing: stays queued
   const sending=this.move(e,'SENDING');
   const payload={encounterId:e.id,trainer:e.trainer,party:e.party,options:{rewardMode:'GAME_DEFAULT'}};
   let outcome;
   try{
    outcome=await this.deps.commands.withPlayerLock(e.lobbyId,e.accountId,()=>this.deps.commands.send({lobbyId:e.lobbyId,accountId:e.accountId,playerId:context.playerId,
     runId:context.context.run?.id??null,actorAccountId:sending.createdBy,command:'game.battle.start',payload}));
   }catch(error){
    if(error instanceof DomainError&&error.code==='PLAYER_BUSY'){this.move(sending,'WAITING_SAFE_STATE');return;}
    throw error;
   }
   if(outcome.status==='COMPLETED'){
    const r=outcome.result as {state?:string;outcome?:BattleResult};
    const starting=this.move(sending,'STARTING',{commandId:outcome.commandId},{action:'battle.sent',message:`${this.name(e.accountId)} VS ${e.trainer.name} : combat transmis au jeu`});
    if(r.state==='ENDED'&&r.outcome)this.finish(starting,r.outcome);
   }else if(outcome.status==='FAILED'&&['not_safe','battle_busy'].includes(outcome.errorCode??'')){
    this.move(sending,'WAITING_SAFE_STATE',{commandId:outcome.commandId});// the player moved: wait for the next safe moment
   }else if(outcome.status==='FAILED'){
    this.move(sending,'FAILED',{commandId:outcome.commandId,errorCode:outcome.errorCode},{action:'battle.failed',status:'FAILED',message:`Combat contre ${e.trainer.name} refusé par le client (${outcome.errorCode}) : jeu inchangé`});
    this.deps.notify(e.lobbyId,{kind:'error',message:`✖ Combat de ${this.name(e.accountId)} refusé par le jeu (${outcome.errorCode})`});
   }else{
    this.move(sending,'REVIEW',{commandId:outcome.commandId,errorCode:'outcome_unknown'},{action:'battle.review',status:'REVIEW',message:`${this.name(e.accountId)} VS ${e.trainer.name} : confirmation perdue, le combat a peut-être démarré`});
   }
  }finally{this.inFlight.delete(e.id);}
  // Observations that arrived during the sending were skipped: catch up once the battle is known to be started.
  if(this.repository.get(e.id)?.status==='STARTING')this.retry(e.lobbyId,e.accountId);
 }

 /** Admin checked an uncertain start in « Opérations à vérifier »: not applied = FAILED; applied = wait for the game's report. */
 commandResolved(commandId:string,applied:boolean){
  const row=this.repository.byCommand(commandId);
  if(row?.status==='REVIEW'&&!applied)this.move(row,'FAILED',{errorCode:'not_applied'},{action:'battle.failed',status:'FAILED',message:`Combat contre ${row.trainer.name} : non démarré (vérifié par un admin)`});
 }

 /** Generic lifecycle step, audited; used by the dispatcher and the reconciliation. */
 move(e:BattleEncounter,to:BattleStatus,patch:Parameters<BattleRepository['transition']>[2]={},log?:{action:string;message:string;status?:'SUCCESS'|'FAILED'|'INFO'|'REVIEW'}){
  const {after}=this.repository.transition(e.id,to,patch);
  if(log)this.audit(after,log.action,log.message,{status:log.status});
  this.deps.changed(e.lobbyId);
  if(['WON','LOST','CANCELLED','FAILED'].includes(to))this.deps.ended?.(after);
  return after;
 }
}
