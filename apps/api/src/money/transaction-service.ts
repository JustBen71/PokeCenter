import {randomUUID} from 'node:crypto';
import type {AuditCategory,GameCapability,MoneyAccount,MoneyTransaction,MoneyTransactionType,NativeGameState} from '@pokerace/shared';
import type {GameCommandName} from '../game/game-command-service.js';
import {DomainError} from '../errors.js';
import type {AuditService} from '../audit/audit-service.js';
import type {CurrentGameService} from '../game/current-game-service.js';
import {GameCommandService} from '../game/game-command-service.js';
import type {LedgerService} from './ledger-service.js';

export type MoneyLeg={type:MoneyTransactionType;amount:number;source:MoneyAccount;destination:MoneyAccount;metadata?:Record<string,unknown>};
export type MoneyOperation={
 lobbyId:string;accountId:string;actorAccountId:string|null;legs:MoneyLeg[];idempotencyKey:string;
 audit:{category:AuditCategory;action:string;message:string};
 // Extra lock keys, e.g. the lobby jackpot so two payouts cannot both pass the balance check.
 lockKeys?:string[];
 // Replaces the default game.money.add/remove, e.g. an auction purchase that debits and inserts in one write.
 gameCommand?:{capabilities:GameCapability[];build:(state:NativeGameState)=>{command:GameCommandName|'pokemon.purchase';payload:Record<string,unknown>}};
};
export type MoneyResult={status:'CONFIRMED'|'FAILED'|'REVIEW';commandId:string|null;transactions:MoneyTransaction[]};

const MAX_GAME_MONEY=999999;
const net=(legs:MoneyLeg[],side:MoneyAccount)=>legs.reduce((sum,l)=>sum+(l.destination===side?l.amount:0)-(l.source===side?l.amount:0),0);

/**
 * Shared money engine for bank, auctions, shop, wheels, rewards and admin corrections.
 * Order: player lock → fresh game context → ledger rows (PENDING → APPLYING) → one game command → CONFIRMED
 * (server balances move in the same SQLite transaction) or FAILED (game unchanged) or REVIEW (unknown, never retried).
 */
export class TransactionService{
 constructor(private readonly deps:{ledger:LedgerService;currentGame:CurrentGameService;commands:GameCommandService;audit:AuditService}){}

 async apply(op:MoneyOperation):Promise<MoneyResult>{
  const {ledger}=this.deps;
  const existing=op.legs.map((_,i)=>ledger.byKey(`${op.idempotencyKey}#${i}`)).filter((t):t is MoneyTransaction=>!!t);
  // A replayed request returns the recorded outcome and never sends a second game command.
  if(existing.length)return {status:existing[0].status==='CONFIRMED'?'CONFIRMED':existing[0].status==='REVIEW'||existing[0].status==='APPLYING'?'REVIEW':'FAILED',commandId:existing[0].commandId,transactions:existing};
  const gameDelta=net(op.legs,'GAME');
  if(gameDelta===0)return this.serverOnly(op);
  return this.locked(op,async()=>{
   const {context,playerId,state}=this.deps.currentGame.requireState(op.lobbyId,op.accountId,{capabilities:op.gameCommand?.capabilities??['money.read','money.write']});
   const money=state.trainer.money;
   if(money+gameDelta<0)throw new DomainError('INSUFFICIENT_FUNDS','Pas assez de Pokédollars dans le jeu',{money,required:-gameDelta});
   if(money+gameDelta>MAX_GAME_MONEY)throw new DomainError('VALIDATION_FAILED','Le portefeuille en jeu est limité à 999 999 ₽',{money,delta:gameDelta});
   this.checkServerFunds(op);
   const commandId=randomUUID();
   const legs=ledger.atomic(()=>op.legs.map((leg,i)=>ledger.transition(ledger.create({...leg,lobbyId:op.lobbyId,accountId:op.accountId,runId:context.run?.id??null,commandId,idempotencyKey:`${op.idempotencyKey}#${i}`,metadata:leg.metadata}).id,'APPLYING',{commandId})));
   const custom=op.gameCommand?.build(state);
   const outcome=await this.deps.commands.send({lobbyId:op.lobbyId,accountId:op.accountId,playerId,runId:context.run?.id??null,actorAccountId:op.actorAccountId,commandId,
    ...(custom??{command:gameDelta>0?'game.money.add':'game.money.remove',payload:{amount:Math.abs(gameDelta),expectedMoney:money}})});
   let result:MoneyResult;
   if(outcome.status==='COMPLETED'){
    try{result={status:'CONFIRMED',commandId,transactions:ledger.atomic(()=>legs.map(t=>ledger.transition(t.id,'CONFIRMED')))};}
    catch(error){
     // The game changed but a server balance could not follow (should not happen under the player lock).
     ledger.atomic(()=>legs.forEach(t=>ledger.transition(t.id,'REVIEW',{metadata:{reason:'server_balance_conflict'}})));
     this.deps.audit.record({lobbyId:op.lobbyId,actorAccountId:op.actorAccountId,targetAccountId:op.accountId,category:'ERROR',action:op.audit.action,status:'REVIEW',commandId,errorCode:error instanceof DomainError?error.code:'INTERNAL_ERROR',message:'Jeu modifié mais soldes serveur non appliqués : à vérifier'});
     throw error;
    }
   }else{
    const status=outcome.status==='FAILED'?'FAILED':'REVIEW';
    ledger.atomic(()=>legs.forEach(t=>ledger.transition(t.id,status,{metadata:{clientError:outcome.errorCode}})));
    this.record(op,status,commandId,outcome.errorCode);
    GameCommandService.raise(outcome);
   }
   this.record(op,'CONFIRMED',commandId,null);
   return result;
  });
 }

 private locked<T>(op:MoneyOperation,work:()=>Promise<T>):Promise<T>{
  const keys=[op.accountId,...(op.lockKeys??[])];
  return keys.reduceRight<()=>Promise<T>>((next,key)=>()=>this.deps.commands.withPlayerLock(op.lobbyId,key,next),work)();
 }

 // Movements between server balances only (bank ↔ jackpot, rewards to the bank…).
 private serverOnly(op:MoneyOperation):MoneyResult{
  const {ledger}=this.deps;
  const transactions=ledger.atomic(()=>op.legs.map((leg,i)=>ledger.record({...leg,lobbyId:op.lobbyId,accountId:op.accountId,idempotencyKey:`${op.idempotencyKey}#${i}`,metadata:leg.metadata})));
  this.record(op,'CONFIRMED',null,null);
  return {status:'CONFIRMED',commandId:null,transactions};
 }

 private checkServerFunds(op:MoneyOperation){
  const bank=-net(op.legs,'BANK'),jackpot=-net(op.legs,'JACKPOT');
  if(bank>0&&this.deps.ledger.bankBalance(op.lobbyId,op.accountId)<bank)throw new DomainError('INSUFFICIENT_FUNDS','Solde bancaire insuffisant');
  if(jackpot>0&&this.deps.ledger.jackpotBalance(op.lobbyId)<jackpot)throw new DomainError('INSUFFICIENT_FUNDS','Jackpot insuffisant');
 }

 private record(op:MoneyOperation,status:'CONFIRMED'|'FAILED'|'REVIEW',commandId:string|null,clientError:string|null){
  this.deps.audit.record({lobbyId:op.lobbyId,actorAccountId:op.actorAccountId,targetAccountId:op.accountId,category:op.audit.category,action:op.audit.action,commandId,
   status:status==='CONFIRMED'?'SUCCESS':status,errorCode:status==='REVIEW'?'COMMAND_OUTCOME_UNKNOWN':status==='FAILED'?'GAME_COMMAND_FAILED':null,
   message:status==='CONFIRMED'?op.audit.message:status==='FAILED'?`${op.audit.message} — refusé, rien n’a été appliqué`:`${op.audit.message} — confirmation perdue, à vérifier`,
   metadata:{legs:op.legs.map(l=>({type:l.type,amount:l.amount,source:l.source,destination:l.destination})),clientError}});
 }
}
