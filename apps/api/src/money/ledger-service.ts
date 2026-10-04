import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {moneyTransactionTransitions,type MoneyAccount,type MoneyTransaction,type MoneyTransactionStatus,type MoneyTransactionType} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';

export type NewMoneyTransaction={
 lobbyId:string;accountId?:string|null;runId?:string|null;type:MoneyTransactionType;amount:number;
 source:MoneyAccount;destination:MoneyAccount;commandId?:string|null;idempotencyKey?:string|null;metadata?:Record<string,unknown>;
};
type Row={id:string;lobby_id:string;account_id:string|null;run_id:string|null;type:MoneyTransactionType;amount:number;source:MoneyAccount;destination:MoneyAccount;
 status:MoneyTransactionStatus;command_id:string|null;idempotency_key:string|null;created_at:string;updated_at:string;confirmed_at:string|null;metadata_json:string};
const toTransaction=(r:Row):MoneyTransaction=>({id:r.id,lobbyId:r.lobby_id,accountId:r.account_id,runId:r.run_id,type:r.type,amount:r.amount,source:r.source,destination:r.destination,
 status:r.status,commandId:r.command_id,idempotencyKey:r.idempotency_key,createdAt:r.created_at,updatedAt:r.updated_at,confirmedAt:r.confirmed_at,metadata:JSON.parse(r.metadata_json)});
const MAX_AMOUNT=999_999_999;
// Fields that define what an idempotency key promises; a replay must ask for exactly the same movement.
const fingerprint=(t:{lobbyId:string;accountId:string|null;runId:string|null;type:string;amount:number;source:string;destination:string})=>
 JSON.stringify([t.lobbyId,t.accountId,t.runId,t.type,t.amount,t.source,t.destination]);

/**
 * Every server-side money movement is a row here. Server balances (BANK, JACKPOT) change only when a row
 * becomes CONFIRMED, inside the same SQLite transaction. GAME legs are records of in-game changes performed
 * through game commands: the ledger never touches the game itself and never retries an uncertain row.
 */
export class LedgerService{
 constructor(private readonly db:Database.Database){}

 // Runs several ledger operations as one SQLite transaction (nested calls become savepoints).
 atomic<T>(work:()=>T):T{return this.db.transaction(work)();}

 get(id:string):MoneyTransaction|undefined{const row=this.db.prepare('SELECT * FROM money_transactions WHERE id=?').get(id) as Row|undefined;return row&&toTransaction(row);}
 require(id:string){const t=this.get(id);if(!t)throw new DomainError('TRANSACTION_NOT_FOUND','Transaction introuvable');return t;}
 list(lobbyId:string,filter:{accountId?:string;status?:MoneyTransactionStatus;limit?:number}={}):MoneyTransaction[]{
  const where=['lobby_id=?'],args:unknown[]=[lobbyId];
  if(filter.accountId){where.push('account_id=?');args.push(filter.accountId);}
  if(filter.status){where.push('status=?');args.push(filter.status);}
  args.push(Math.min(Math.max(filter.limit??100,1),500));
  return (this.db.prepare(`SELECT * FROM money_transactions WHERE ${where.join(' AND ')} ORDER BY created_at DESC,rowid DESC LIMIT ?`).all(...args) as Row[]).map(toTransaction);
 }
 byKey(idempotencyKey:string):MoneyTransaction|undefined{const row=this.db.prepare('SELECT * FROM money_transactions WHERE idempotency_key=?').get(idempotencyKey) as Row|undefined;return row&&toTransaction(row);}
 byCommand(commandId:string):MoneyTransaction[]{return (this.db.prepare('SELECT * FROM money_transactions WHERE command_id=? ORDER BY rowid').all(commandId) as Row[]).map(toTransaction);}

 bankBalance(lobbyId:string,accountId:string):number{return (this.db.prepare('SELECT balance FROM bank_accounts WHERE lobby_id=? AND account_id=?').get(lobbyId,accountId) as {balance:number}|undefined)?.balance??0;}
 jackpotBalance(lobbyId:string):number{return (this.db.prepare('SELECT balance FROM jackpots WHERE lobby_id=?').get(lobbyId) as {balance:number}|undefined)?.balance??0;}

 // Creates a PENDING row. Replaying the same idempotency key returns the original row instead of a duplicate.
 create(input:NewMoneyTransaction):MoneyTransaction{
  if(!Number.isSafeInteger(input.amount)||input.amount<=0||input.amount>MAX_AMOUNT)throw new DomainError('VALIDATION_FAILED','Montant invalide');
  if(input.source===input.destination)throw new DomainError('VALIDATION_FAILED','Source et destination identiques');
  const accountId=input.accountId??null,runId=input.runId??null;
  if((['GAME','BANK'] as MoneyAccount[]).some(a=>a===input.source||a===input.destination)&&!accountId)throw new DomainError('VALIDATION_FAILED','Un compte joueur est requis pour ce mouvement');
  return this.atomic(()=>{
   if(input.idempotencyKey){
    const existing=this.db.prepare('SELECT * FROM money_transactions WHERE idempotency_key=?').get(input.idempotencyKey) as Row|undefined;
    if(existing){
     const previous=toTransaction(existing);
     if(fingerprint(previous)!==fingerprint({...input,accountId,runId}))throw new DomainError('IDEMPOTENCY_CONFLICT','Cette clé d’idempotence correspond à une autre opération',{transactionId:previous.id});
     return previous;
    }
   }
   const id=randomUUID(),now=nowIso();
   this.db.prepare(`INSERT INTO money_transactions(id,lobby_id,account_id,run_id,type,amount,source,destination,status,command_id,idempotency_key,created_at,updated_at,confirmed_at,metadata_json)
    VALUES(?,?,?,?,?,?,?,?,'PENDING',?,?,?,?,NULL,?)`)
    .run(id,input.lobbyId,accountId,runId,input.type,input.amount,input.source,input.destination,input.commandId??null,input.idempotencyKey??null,now,now,JSON.stringify(input.metadata??{}));
   return this.get(id)!;
  });
 }

 // Moves a row along the state machine. Reaching CONFIRMED applies server balances in the same transaction.
 transition(id:string,to:MoneyTransactionStatus,patch:{commandId?:string;metadata?:Record<string,unknown>}={}):MoneyTransaction{
  return this.atomic(()=>{
   const t=this.require(id);
   if(t.status===to&&to!=='PENDING')return t;
   if(!moneyTransactionTransitions[t.status].includes(to))throw new DomainError('INVALID_TRANSACTION_TRANSITION',`Transition ${t.status} → ${to} interdite`,{from:t.status,to});
   if(to==='CONFIRMED')this.applyBalances(t);
   const now=nowIso();
   this.db.prepare('UPDATE money_transactions SET status=?,updated_at=?,confirmed_at=?,command_id=COALESCE(?,command_id),metadata_json=? WHERE id=?')
    .run(to,now,to==='CONFIRMED'?now:null,patch.commandId??null,JSON.stringify({...t.metadata,...patch.metadata}),id);
   return this.get(id)!;
  });
 }

 // Server-only movement (e.g. admin correction, jackpot payout to bank): created and confirmed atomically.
 record(input:NewMoneyTransaction):MoneyTransaction{
  if(input.source==='GAME'||input.destination==='GAME')throw new DomainError('VALIDATION_FAILED','Un mouvement en jeu doit passer par une commande de jeu');
  return this.atomic(()=>{const t=this.create(input);return t.status==='PENDING'?this.transition(t.id,'CONFIRMED'):t;});
 }

 private applyBalances(t:MoneyTransaction){
  const now=nowIso();
  // UPDATE first: SQLite checks CHECK(balance>=0) on the inserted row before resolving an upsert conflict.
  const move=(side:MoneyAccount,delta:number)=>{
   if(side==='BANK'){
    if(delta<0&&this.bankBalance(t.lobbyId,t.accountId!)<-delta)throw new DomainError('INSUFFICIENT_FUNDS','Solde bancaire insuffisant',{transactionId:t.id});
    if(this.db.prepare('UPDATE bank_accounts SET balance=balance+?,updated_at=? WHERE lobby_id=? AND account_id=?').run(delta,now,t.lobbyId,t.accountId).changes===0)
     this.db.prepare('INSERT INTO bank_accounts(lobby_id,account_id,balance,updated_at) VALUES(?,?,?,?)').run(t.lobbyId,t.accountId,delta,now);
   }
   if(side==='JACKPOT'){
    if(delta<0&&this.jackpotBalance(t.lobbyId)<-delta)throw new DomainError('INSUFFICIENT_FUNDS','Jackpot insuffisant',{transactionId:t.id});
    if(this.db.prepare('UPDATE jackpots SET balance=balance+?,updated_at=? WHERE lobby_id=?').run(delta,now,t.lobbyId).changes===0)
     this.db.prepare('INSERT INTO jackpots(lobby_id,balance,updated_at) VALUES(?,?,?)').run(t.lobbyId,delta,now);
   }
  };
  move(t.source,-t.amount);move(t.destination,t.amount);
 }
}
