import {randomUUID} from 'node:crypto';
import {battleSourceLabels,battleStatusLabels,type Account,type BattleEncounter,type BattleEncounterSpec,type BattleScalingSpec,type BattleSourceType,type BattleStatus,type BattlesSnapshot,type LobbyNotification} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import type {PortalDomain} from '../store.js';
import {BattleRepository} from './battle-repository.js';
import {validateBattleSpec} from './battle-validator.js';

export type BattleSource={type:BattleSourceType;refId:string|null;label:string;scaling:BattleScalingSpec};

/**
 * Commanded battles: creation (frozen spec), queue until the game is in a safe state, sending, lifecycle, result,
 * audit and REVIEW. The game side only executes the final spec; nothing here knows a memory address.
 */
export class BattleEncounterService{
 readonly repository:BattleRepository;
 constructor(private readonly deps:{domain:PortalDomain;changed:(lobbyId:string)=>void;notify:(lobbyId:string,n:LobbyNotification,accountId?:string)=>void}){
  this.repository=new BattleRepository(deps.domain.db);
 }
 private name(id:string|null){return id?this.deps.domain.accounts.get(id)?.name??id:'—';}
 private audit(e:BattleEncounter,action:string,message:string,options:{actorId?:string|null;status?:'SUCCESS'|'FAILED'|'INFO'|'REVIEW';metadata?:Record<string,unknown>}={}){
  this.deps.domain.audit.record({lobbyId:e.lobbyId,actorAccountId:options.actorId??null,targetAccountId:e.accountId,runId:e.runId,category:'BATTLE',action,status:options.status??'SUCCESS',
   commandId:e.commandId,message,metadata:{encounterId:e.id,source:e.sourceType,trainer:e.trainer.name,...options.metadata}});
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
