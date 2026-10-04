import type Database from 'better-sqlite3';
import {objectiveUpdateSchema,progressionData,type Objective,type ObjectiveCompletion,type ObjectiveRewardStatus,type ObjectivesSnapshot} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import type {AuditService} from '../audit/audit-service.js';
import type {RunService} from '../runs/run-service.js';
import type {TransactionService} from '../money/transaction-service.js';

type ObjectiveRow={id:string;name:string;description:string;sort_order:number;reward_money:number;map_section:string|null;condition_json:string;enabled:number};
type CompletionRow={objective_id:string;account_id:string;run_id:string|null;completed_at:string;reward_status:ObjectiveRewardStatus;reward_attempts:number};
const toObjective=(r:ObjectiveRow):Objective=>({id:r.id,name:r.name,description:r.description,order:r.sort_order,rewardMoney:r.reward_money,mapPosition:r.map_section,gameCondition:JSON.parse(r.condition_json),enabled:r.enabled===1});
const MAX_REWARD_ATTEMPTS=5;

/**
 * Lobby objectives. A completion is recorded once per player and objective (primary key), whatever the Run.
 * Its reward goes through the money engine with a stable idempotency key per attempt, so it is paid at most once;
 * an unknown outcome stays in REVIEW for an admin.
 */
export class ObjectiveService{
 private readonly inFlight=new Set<string>();
 constructor(private readonly deps:{db:Database.Database;runs:RunService;audit:AuditService;transactions:()=>TransactionService;changed:(lobbyId:string)=>void}){}

 // New lobbies start with the Emerald story objectives in game order, without reward.
 seed(lobbyId:string){
  const {db}=this.deps;
  if(db.prepare('SELECT 1 FROM objectives WHERE lobby_id=? LIMIT 1').get(lobbyId))return;
  const insert=db.prepare('INSERT INTO objectives(lobby_id,id,name,description,sort_order,reward_money,map_section,condition_json,enabled) VALUES(?,?,?,?,?,0,?,?,1)');
  db.transaction(()=>progressionData.objectives.forEach((o,i)=>insert.run(lobbyId,o.id,o.label,'',(i+1)*10,o.section,JSON.stringify({type:'progression',objectiveId:o.id}))))();
 }

 list(lobbyId:string):Objective[]{return (this.deps.db.prepare('SELECT * FROM objectives WHERE lobby_id=? ORDER BY sort_order,id').all(lobbyId) as ObjectiveRow[]).map(toObjective);}
 completions(lobbyId:string):ObjectiveCompletion[]{
  return (this.deps.db.prepare('SELECT * FROM objective_completions WHERE lobby_id=? ORDER BY completed_at').all(lobbyId) as CompletionRow[])
   .map(r=>({objectiveId:r.objective_id,accountId:r.account_id,runId:r.run_id,completedAt:r.completed_at,rewardStatus:r.reward_status}));
 }
 snapshot(lobbyId:string):ObjectivesSnapshot{return {objectives:this.list(lobbyId),completions:this.completions(lobbyId)};}

 update(lobbyId:string,objectiveId:string,body:unknown,actorAccountId:string):Objective{
  const patch=parseBody(objectiveUpdateSchema,body);
  const before=this.list(lobbyId).find(o=>o.id===objectiveId);
  if(!before)throw new DomainError('NOT_FOUND','Objectif introuvable');
  const next={...before,...patch};
  this.deps.db.prepare('UPDATE objectives SET name=?,description=?,reward_money=?,sort_order=?,enabled=? WHERE lobby_id=? AND id=?')
   .run(next.name,next.description,next.rewardMoney,next.order,next.enabled?1:0,lobbyId,objectiveId);
  this.deps.audit.record({lobbyId,actorAccountId,category:'ADMIN',action:'objective.update',status:'SUCCESS',message:`Objectif « ${next.name} » modifié`,metadata:{from:{reward:before.rewardMoney,order:before.order,enabled:before.enabled},to:{reward:next.rewardMoney,order:next.order,enabled:next.enabled}}});
  this.deps.changed(lobbyId);
  return next;
 }

 /** Called on every game observation: records new completions, then (re)tries their pending rewards. */
 async observe(lobbyId:string,accountId:string,completed:readonly string[]){
  const {db}=this.deps;
  const objectives=this.list(lobbyId).filter(o=>o.enabled&&completed.includes(o.gameCondition.objectiveId));
  const run=this.deps.runs.running(lobbyId,accountId);
  let changed=false;
  for(const objective of objectives){
   const inserted=db.prepare(`INSERT OR IGNORE INTO objective_completions(lobby_id,objective_id,account_id,run_id,completed_at,reward_status) VALUES(?,?,?,?,?,?)`)
    .run(lobbyId,objective.id,accountId,run?.id??null,nowIso(),objective.rewardMoney>0?'PENDING':'NONE').changes;
   if(inserted){changed=true;this.deps.audit.record({lobbyId,targetAccountId:accountId,runId:run?.id??null,category:'RUN',action:'objective.completed',status:'SUCCESS',message:`Objectif atteint : ${objective.name}`});}
  }
  if(changed)this.deps.changed(lobbyId);
  await this.payPending(lobbyId,accountId);
 }

 private async payPending(lobbyId:string,accountId:string){
  const {db}=this.deps;
  const pending=db.prepare(`SELECT c.*,o.reward_money,o.name FROM objective_completions c JOIN objectives o ON o.lobby_id=c.lobby_id AND o.id=c.objective_id
   WHERE c.lobby_id=? AND c.account_id=? AND c.reward_status='PENDING' AND c.reward_attempts<?`).all(lobbyId,accountId,MAX_REWARD_ATTEMPTS) as (CompletionRow&{reward_money:number;name:string})[];
  for(const row of pending){
   const key=`objective:${lobbyId}:${row.objective_id}:${accountId}`;
   if(this.inFlight.has(key))continue;
   this.inFlight.add(key);
   try{
    const result=await this.deps.transactions().apply({lobbyId,accountId,actorAccountId:null,idempotencyKey:`${key}:attempt-${row.reward_attempts}`,
     legs:[{type:'OBJECTIVE_REWARD',amount:row.reward_money,source:'EXTERNAL',destination:'GAME',metadata:{objectiveId:row.objective_id}}],
     audit:{category:'MONEY',action:'objective.reward',message:`Récompense « ${row.name} » : ${row.reward_money} ₽`}});
    this.setReward(lobbyId,row.objective_id,accountId,result.status==='CONFIRMED'?'PAID':result.status==='REVIEW'?'REVIEW':'PENDING',result.commandId,result.status==='FAILED');
   }catch(error){
    // Preconditions (no Run, game offline, busy player) leave the reward pending for the next observation;
    // a lost confirmation is final until an admin checks it.
    const code=error instanceof DomainError?error.code:'INTERNAL_ERROR';
    if(code==='COMMAND_OUTCOME_UNKNOWN')this.setReward(lobbyId,row.objective_id,accountId,'REVIEW',String(error instanceof DomainError?error.details?.commandId??'':''),false);
    else if(['GAME_STATE_CHANGED','GAME_COMMAND_FAILED','INSUFFICIENT_FUNDS','VALIDATION_FAILED'].includes(code))this.setReward(lobbyId,row.objective_id,accountId,'PENDING',null,true);
   }finally{this.inFlight.delete(key);}
  }
 }

 // An admin resolved the uncertain reward command: paid, or pending again for a new attempt.
 commandResolved(commandId:string,applied:boolean){
  const row=this.deps.db.prepare("SELECT lobby_id,objective_id,account_id FROM objective_completions WHERE reward_command_id=? AND reward_status='REVIEW'").get(commandId) as {lobby_id:string;objective_id:string;account_id:string}|undefined;
  if(row)this.setReward(row.lobby_id,row.objective_id,row.account_id,applied?'PAID':'PENDING',null,!applied);
 }

 private setReward(lobbyId:string,objectiveId:string,accountId:string,status:ObjectiveRewardStatus,commandId:string|null,attempted:boolean){
  this.deps.db.prepare('UPDATE objective_completions SET reward_status=?,reward_command_id=COALESCE(?,reward_command_id),reward_attempts=reward_attempts+? WHERE lobby_id=? AND objective_id=? AND account_id=?')
   .run(status,commandId||null,attempted?1:0,lobbyId,objectiveId,accountId);
  this.deps.changed(lobbyId);
 }
}
