import {randomUUID} from 'node:crypto';
import {passiveById,passiveCatalog,type Account,type Gage,type NativeGameState,type PassiveActInput,type PassiveRewardStatus} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import type {Services} from '../services.js';
import type {DomainEvent,PassiveContext,PassiveHandler,RewardRequest} from './passive-events.js';

type RewardRow={id:string;event_id:string;passive_id:string;lobby_id:string;account_id:string;type:string;payload_json:string;status:PassiveRewardStatus;command_id:string|null;attempts:number};
const MAX_ATTEMPTS=5;
// The game cannot take the reward right now: it stays PENDING for the next observation, without counting an attempt.
const notYet=['GAME_NOT_CONNECTED','GAME_ADAPTER_NOT_READY','GAME_STATE_STALE','CAPABILITY_MISSING','PLAYER_BUSY','RUN_NOT_RUNNING','WRITES_DISABLED'];
const catalogOrder=new Map(passiveCatalog.map((p,i)=>[p.id,i]));

/**
 * Evaluates the passives of a player for one event, in catalogue order (deterministic), after recording the
 * event once (passive_events). Business services only publish events; they never know individual passives.
 * Money goes through TransactionService, tickets through the shop; unknown outcomes stay in REVIEW.
 */
export class PassiveEngine{
 private services!:Services;
 private readonly inFlight=new Set<string>();
 constructor(private readonly handlers:Readonly<Record<string,PassiveHandler>>){}
 attach(services:Services){this.services=services;}
 private get db(){return this.services.domain.db;}

 // Owned passives that have a server handler, in catalogue order.
 private active(lobbyId:string,accountId:string){
  return this.services.passives.owned(lobbyId,accountId)
   .filter(o=>this.handlers[o.passiveId])
   .sort((a,b)=>(catalogOrder.get(a.passiveId)??0)-(catalogOrder.get(b.passiveId)??0));
 }

 private context(lobbyId:string,accountId:string,passiveId:string):PassiveContext{
  const {passives,domain}=this.services,passive=passiveById.get(passiveId)!;
  return {lobbyId,accountId,passive,services:this.services,
   get:(key,fallback)=>passives.progress(lobbyId,accountId,passiveId,key,fallback),
   // A real change of progression is pushed live (badges, Passifs page); identical writes are skipped.
   set:(key,value)=>{
    if(JSON.stringify(passives.progress(lobbyId,accountId,passiveId,key,null))===JSON.stringify(value??null))return;
    passives.setProgress(lobbyId,accountId,passiveId,key,value);passives.deps.changed(lobbyId);
   },
   reward:(eventId,request,to)=>this.reward(lobbyId,to??accountId,passiveId,eventId,request),
   notify:(message,options={})=>passives.deps.notify(lobbyId,{kind:options.kind??'info',message:`${message}`},options.private?accountId:undefined),
   audit:(action,message,metadata={})=>domain.audit.record({lobbyId,targetAccountId:accountId,category:'PASSIVE',action,status:'SUCCESS',message,metadata:{passiveId,...metadata}})};
 }

 /** Processes a domain event once for its player. Returns false when the event was already processed. */
 async publish(event:DomainEvent):Promise<boolean>{
  const {lobbyId,accountId}=event;
  if(!this.services.domain.lobbies.isMember(lobbyId,accountId))return false;
  const inserted=this.db.prepare('INSERT OR IGNORE INTO passive_events(id,lobby_id,account_id,event_id,event_type,processed_at) VALUES(?,?,?,?,?,?)')
   .run(randomUUID(),lobbyId,accountId,event.id,event.type,nowIso()).changes;
  if(!inserted)return false;
  if(event.type==='STEPS_CHANGED')Object.assign(event.data,this.steps(lobbyId,accountId,event.data.absolute));
  const results:Record<string,unknown>={};
  for(const owned of this.active(lobbyId,accountId)){
   const handler=this.handlers[owned.passiveId].on?.[event.type] as ((ctx:PassiveContext,e:DomainEvent)=>unknown)|undefined;
   if(!handler)continue;
   try{results[owned.passiveId]=await handler(this.context(lobbyId,accountId,owned.passiveId),event)??true;}
   catch(error){results[owned.passiveId]={error:error instanceof DomainError?error.code:'INTERNAL_ERROR'};this.failed(lobbyId,accountId,owned.passiveId,event.type,error);}
  }
  // Holders elsewhere in the lobby watching this player (deterministic: catalogue order, then acquisition order).
  for(const passiveId of Object.keys(this.handlers).sort((a,b)=>(catalogOrder.get(a)??0)-(catalogOrder.get(b)??0))){
   const watcher=this.handlers[passiveId].others?.[event.type] as ((ctx:PassiveContext,e:DomainEvent)=>unknown)|undefined;
   if(!watcher)continue;
   for(const holder of this.services.passives.holders(lobbyId,passiveId)){
    if(holder===accountId)continue;
    try{results[`${passiveId}@${holder}`]=await watcher(this.context(lobbyId,holder,passiveId),event)??true;}
    catch(error){this.failed(lobbyId,holder,passiveId,event.type,error);}
   }
  }
  this.db.prepare('UPDATE passive_events SET result_json=? WHERE lobby_id=? AND account_id=? AND event_id=?').run(JSON.stringify(results),lobbyId,accountId,event.id);
  if(Object.keys(results).length)this.services.passives.deps.changed(lobbyId);
  return true;
 }
 /**
  * Race step counter from the game's absolute counter: deltas only, a lower value (new Run, new save) is a new
  * baseline and never a negative delta; the total spans every Run of the race.
  */
 private steps(lobbyId:string,accountId:string,absolute:number){
  const {passives}=this.services,key='_race';
  const last=passives.progress<number|null>(lobbyId,accountId,key,'stepsLast',null),total=passives.progress(lobbyId,accountId,key,'stepsTotal',0);
  const delta=last===null?0:absolute>=last?absolute-last:absolute;
  passives.setProgress(lobbyId,accountId,key,'stepsLast',absolute);passives.setProgress(lobbyId,accountId,key,'stepsTotal',total+delta);
  return {delta,total:total+delta};
 }
 raceSteps(lobbyId:string,accountId:string){return this.services.passives.progress(lobbyId,accountId,'_race','stepsTotal',0);}
 // Publishing never breaks the business action that triggered it.
 emit(event:DomainEvent){void this.publish(event).catch(error=>console.error('Passives:',error));}

 /** Periodic game observation: idempotent progressions, then a controlled attempt for pending rewards. */
 async observe(lobbyId:string,accountId:string,state:NativeGameState){
  for(const owned of this.active(lobbyId,accountId)){
   const observe=this.handlers[owned.passiveId].observe;
   if(!observe)continue;
   try{await observe(this.context(lobbyId,accountId,owned.passiveId),state);}
   catch(error){this.failed(lobbyId,accountId,owned.passiveId,'GAME_OBSERVATION',error);}
  }
  await this.retryPending(lobbyId,accountId);
 }

 /** Modifier: the hostile gages a target's passives allow (Contre-sort). The list is never emptied. */
 filterHostileGages(lobbyId:string,targetId:string,gages:Gage[]):Gage[]{
  let result=gages;
  for(const owned of this.active(lobbyId,targetId)){
   const filter=this.handlers[owned.passiveId].filterHostileGages;
   if(filter)result=filter(this.context(lobbyId,targetId,owned.passiveId),result);
  }
  return result.length?result:gages;
 }

 /** Explicit use of an owned passive by its holder, or by an admin for them. Audited, pushed live. */
 async act(lobbyId:string,accountId:string,passiveId:string,input:PassiveActInput,actor:Account):Promise<{message:string}>{
  const handler=this.handlers[passiveId]?.act;
  if(!this.services.passives.has(lobbyId,accountId,passiveId))throw new DomainError('PASSIVE_NOT_OWNED','Ce joueur ne possède pas ce passif');
  if(!handler)throw new DomainError('VALIDATION_FAILED','Ce passif ne s’utilise pas manuellement');
  const message=await handler(this.context(lobbyId,accountId,passiveId),input,actor);
  this.services.domain.audit.record({lobbyId,actorAccountId:actor.id,targetAccountId:accountId,category:'PASSIVE',action:`passive.act.${input.action}`,status:'SUCCESS',message,metadata:{passiveId,input:{...input}}});
  this.services.passives.deps.notify(lobbyId,{kind:'success',message:`✨ ${message}`});
  this.services.passives.deps.changed(lobbyId);
  return {message};
 }

 /** A passive turning a wheel draw into a choice among N gages: who chooses and among how many. */
 wheelChoice(lobbyId:string,draw:{tone:string;ownerId:string;targetId:string|null;gageCount:number}):{chooserId:string;count:number;passiveId:string}|null{
  for(const [role,accountId] of [['target',draw.targetId],['owner',draw.ownerId]] as const){
   if(!accountId)continue;
   for(const owned of this.active(lobbyId,accountId)){
    const choice=this.handlers[owned.passiveId].wheelChoice;
    const count=choice?.(this.context(lobbyId,accountId,owned.passiveId),{tone:draw.tone,role,gageCount:draw.gageCount});
    if(count)return {chooserId:accountId,count,passiveId:owned.passiveId};
   }
  }
  return null;
 }

 private failed(lobbyId:string,accountId:string,passiveId:string,trigger:string,error:unknown){
  const code=error instanceof DomainError?error.code:'INTERNAL_ERROR';
  this.services.domain.audit.record({lobbyId,targetAccountId:accountId,category:'PASSIVE',action:'passive.error',status:'FAILED',errorCode:code,
   message:`${passiveById.get(passiveId)?.name??passiveId} : échec sur ${trigger}`,metadata:{passiveId,trigger,error:error instanceof Error?error.message:String(error)}});
 }

 // ---- Rewards: recorded once per (event, passive), applied at most once, REVIEW when unknown. ----

 private async reward(lobbyId:string,accountId:string,passiveId:string,eventId:string,request:RewardRequest){
  const inserted=this.db.prepare("INSERT OR IGNORE INTO passive_rewards(id,event_id,passive_id,lobby_id,account_id,type,payload_json,status,created_at) VALUES(?,?,?,?,?,?,?,'PENDING',?)")
   .run(randomUUID(),eventId,passiveId,lobbyId,accountId,request.type,JSON.stringify(request),nowIso()).changes;
  if(!inserted)return;
  this.services.passives.deps.changed(lobbyId);
  const row=this.db.prepare('SELECT * FROM passive_rewards WHERE lobby_id=? AND account_id=? AND event_id=? AND passive_id=?').get(lobbyId,accountId,eventId,passiveId) as RewardRow;
  await this.apply(row);
 }

 async retryPending(lobbyId:string,accountId:string){
  const rows=this.db.prepare("SELECT * FROM passive_rewards WHERE lobby_id=? AND account_id=? AND status='PENDING' ORDER BY created_at,rowid").all(lobbyId,accountId) as RewardRow[];
  for(const row of rows)await this.apply(row);
 }

 private set(row:RewardRow,status:PassiveRewardStatus,options:{commandId?:string|null;attempted?:boolean}={}){
  this.db.prepare('UPDATE passive_rewards SET status=?,command_id=COALESCE(?,command_id),attempts=attempts+?,resolved_at=? WHERE id=?')
   .run(status,options.commandId??null,options.attempted?1:0,['CONFIRMED','FAILED'].includes(status)?nowIso():null,row.id);
  this.services.passives.deps.changed(row.lobby_id);
 }

 private async apply(row:RewardRow){
  if(this.inFlight.has(row.id))return;
  // Claim: only one attempt at a time, whatever the number of observations arriving meanwhile.
  if(!this.db.prepare("UPDATE passive_rewards SET status='APPLYING' WHERE id=? AND status='PENDING'").run(row.id).changes)return;
  this.inFlight.add(row.id);
  const request=JSON.parse(row.payload_json) as RewardRequest,passive=passiveById.get(row.passive_id)!;
  const account=this.services.domain.accounts.get(row.account_id)!;
  try{
   if(request.type==='TICKET'){
    const ticket=this.services.shop.grantTicket(row.lobby_id,{tone:request.tone,ownerId:row.account_id,targetId:request.targetId??null,reason:`${passive.name} : ${request.reason}`});
    this.set(row,ticket?'CONFIRMED':'FAILED',{attempted:true});
    if(!ticket)this.services.domain.audit.record({lobbyId:row.lobby_id,targetAccountId:row.account_id,category:'PASSIVE',action:'passive.reward',status:'FAILED',message:`${passive.name} : aucune roue ${request.tone==='GOOD'?'bienveillante':'hostile'} active, récompense perdue`,metadata:{passiveId:passive.id,eventId:row.event_id}});
    return;
   }
   const result=await this.services.transactions.apply({lobbyId:row.lobby_id,accountId:row.account_id,actorAccountId:null,idempotencyKey:`passive:${row.id}:attempt-${row.attempts}`,
    legs:[{type:'PASSIVE_REWARD',amount:request.amount,source:'EXTERNAL',destination:'GAME',metadata:{passiveId:passive.id,eventId:row.event_id,reason:request.reason}}],
    audit:{category:'PASSIVE',action:'passive.reward',message:`${passive.name} : +${request.amount.toLocaleString('fr-FR')} ₽ pour ${account.name} (${request.reason})`}});
   if(result.status==='CONFIRMED'){
    this.set(row,'CONFIRMED',{commandId:result.commandId,attempted:true});
    this.services.passives.deps.notify(row.lobby_id,{kind:'success',message:`${passive.name} — ${account.name} : +${request.amount.toLocaleString('fr-FR')} ₽ (${request.reason})`});
   }else this.set(row,result.status==='REVIEW'?'REVIEW':row.attempts+1>=MAX_ATTEMPTS?'FAILED':'PENDING',{commandId:result.commandId,attempted:true});
  }catch(error){
   const code=error instanceof DomainError?error.code:'INTERNAL_ERROR';
   if(code==='COMMAND_OUTCOME_UNKNOWN')this.set(row,'REVIEW',{commandId:String((error as DomainError).details?.commandId??''),attempted:true});
   else if(notYet.includes(code))this.set(row,'PENDING');
   else this.set(row,row.attempts+1>=MAX_ATTEMPTS?'FAILED':'PENDING',{attempted:true});
  }finally{this.inFlight.delete(row.id);}
 }

 /** An admin checked the game: the uncertain reward is confirmed, or pending again for one new attempt. */
 commandResolved(commandId:string,applied:boolean){
  const row=this.db.prepare("SELECT * FROM passive_rewards WHERE command_id=? AND status='REVIEW'").get(commandId) as RewardRow|undefined;
  if(row)this.set(row,applied?'CONFIRMED':'PENDING');
 }
}
