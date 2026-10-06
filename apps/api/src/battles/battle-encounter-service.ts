import {randomUUID} from 'node:crypto';
import {battleCreateSchema,battleSourceLabels,battleStatusLabels,type Account,type BattleCreateInput,type BattlePreview,type BattleEncounter,type BattleEncounterSpec,type BattleScalingSpec,type BattleSourceType,type BattleStatus,type BattlesSnapshot,type LobbyNotification} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import type {PortalDomain} from '../store.js';
import {BattleRepository} from './battle-repository.js';
import {validateBattleSpec} from './battle-validator.js';
import {defaultSprite,partyFromGameState,trainerName} from './battle-builders.js';
import {levelSummary,scaleParty} from './battle-scaling-service.js';
import {parseBody} from '../http.js';
import type {CurrentGameService} from '../game/current-game-service.js';
import type {ObjectiveService} from '../objectives/objective-service.js';

export type BattleSource={type:BattleSourceType;refId:string|null;label:string;scaling:BattleScalingSpec};

/**
 * Commanded battles: creation (frozen spec), queue until the game is in a safe state, sending, lifecycle, result,
 * audit and REVIEW. The game side only executes the final spec; nothing here knows a memory address.
 */
export class BattleEncounterService{
 readonly repository:BattleRepository;
 constructor(private readonly deps:{domain:PortalDomain;currentGame:CurrentGameService;objectives:()=>ObjectiveService;changed:(lobbyId:string)=>void;notify:(lobbyId:string,n:LobbyNotification,accountId?:string)=>void}){
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
 queue(lobbyId:string,id:string,actorId:string|null){
  const e=this.repository.require(lobbyId,id);
  const {after}=this.repository.transition(e.id,'WAITING_SAFE_STATE');
  this.audit(after,'battle.start_requested',`Combat contre ${after.trainer.name} demandé pour ${this.name(after.accountId)} : il démarrera dès que le jeu sera dans un état sûr`,{actorId});
  this.deps.notify(lobbyId,{kind:'info',message:`⚔ ${this.name(after.accountId)} va affronter ${after.trainer.name}`});
  this.deps.changed(lobbyId);
  return after;
 }

 cancel(lobbyId:string,id:string,actorId:string|null){
  const e=this.repository.require(lobbyId,id);
  if(!['CREATED','WAITING_SAFE_STATE','REVIEW'].includes(e.status))throw new DomainError('CONFLICT',`Un combat « ${battleStatusLabels[e.status]} » ne peut plus être annulé`);
  const {after}=this.repository.transition(e.id,'CANCELLED');
  this.audit(after,'battle.cancelled',`Combat contre ${after.trainer.name} annulé pour ${this.name(after.accountId)}`,{actorId,status:'INFO'});
  this.deps.changed(lobbyId);
  return after;
 }

 /** Generic lifecycle step, audited; used by the dispatcher and the reconciliation. */
 move(e:BattleEncounter,to:BattleStatus,patch:Parameters<BattleRepository['transition']>[2]={},log?:{action:string;message:string;status?:'SUCCESS'|'FAILED'|'INFO'|'REVIEW'}){
  const {after}=this.repository.transition(e.id,to,patch);
  if(log)this.audit(after,log.action,log.message,{status:log.status});
  this.deps.changed(e.lobbyId);
  return after;
 }
}
