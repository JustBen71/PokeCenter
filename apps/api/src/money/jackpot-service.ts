import {z} from 'zod';
import type {Account,JackpotSnapshot} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import type {PortalDomain} from '../store.js';
import type {GameCommandService} from '../game/game-command-service.js';
import type {TransactionService} from './transaction-service.js';

const adjustSchema=z.object({operation:z.enum(['add','remove']),amount:z.number().int().min(1).max(999999999),reason:z.string().trim().min(1).max(200)}).strict();
export const jackpotLock=(lobbyId:string)=>`jackpot:${lobbyId}`;

/**
 * Lobby jackpot. Contributions arrive through the ledger (bank tax, shop, auctions, wheels); payouts are paid into
 * a player's game under the jackpot lock, so two payouts can never both spend the same balance.
 */
export class JackpotService{
 constructor(private readonly deps:{domain:PortalDomain;transactions:TransactionService;commands:GameCommandService}){}

 balance(lobbyId:string){return this.deps.domain.ledger.jackpotBalance(lobbyId);}

 snapshot(lobbyId:string):JackpotSnapshot{
  const {ledger}=this.deps.domain;
  const rows=ledger.list(lobbyId,{limit:500}).filter(t=>t.source==='JACKPOT'||t.destination==='JACKPOT');
  const confirmed=rows.filter(t=>t.status==='CONFIRMED');
  // Main sources: confirmed inflows grouped by the operation that produced them.
  const sources=new Map<string,number>();
  for(const t of confirmed.filter(t=>t.destination==='JACKPOT')){
   const reason=String(t.metadata.reason??(t.type==='ADMIN_ADJUSTMENT'?'admin':'other'));
   sources.set(reason,(sources.get(reason)??0)+t.amount);
  }
  return {balance:this.balance(lobbyId),recent:rows.slice(0,30),
   sources:[...sources].map(([reason,amount])=>({reason,amount})).sort((a,b)=>b.amount-a.amount),
   totalIn:confirmed.filter(t=>t.destination==='JACKPOT').reduce((n,t)=>n+t.amount,0),
   totalOut:confirmed.filter(t=>t.source==='JACKPOT').reduce((n,t)=>n+t.amount,0)};
 }

 /** Pays `amount` (capped to the balance) from the jackpot into a player's game. Returns the amount paid. */
 async pay(lobbyId:string,account:Account,amount:number,input:{actorAccountId:string|null;idempotencyKey:string;label:string;metadata?:Record<string,unknown>}):Promise<number>{
  const paid=Math.min(amount,this.balance(lobbyId));
  if(paid<=0)return 0;
  await this.deps.transactions.apply({lobbyId,accountId:account.id,actorAccountId:input.actorAccountId,idempotencyKey:input.idempotencyKey,lockKeys:[jackpotLock(lobbyId)],
   legs:[{type:'JACKPOT_REWARD',amount:paid,source:'JACKPOT',destination:'GAME',metadata:input.metadata}],
   audit:{category:'JACKPOT',action:'jackpot.pay',message:`${input.label} : ${paid} ₽ du jackpot pour ${account.name}`}});
  return paid;
 }
 payPercent(lobbyId:string,account:Account,percent:number,input:Parameters<JackpotService['pay']>[3]){return this.pay(lobbyId,account,Math.floor(this.balance(lobbyId)*percent/100),input);}
 payAll(lobbyId:string,account:Account,input:Parameters<JackpotService['pay']>[3]){return this.pay(lobbyId,account,this.balance(lobbyId),input);}

 /** Splits the jackpot equally between the given players; already paid shares are never paid again (per-player keys). */
 async share(lobbyId:string,accounts:Account[],input:{actorAccountId:string|null;idempotencyKey:string;label:string}){
  const each=accounts.length?Math.floor(this.balance(lobbyId)/accounts.length):0;
  const paid:Account[]=[],failed:Account[]=[];
  if(each<=0)return {each:0,paid,failed};
  for(const account of accounts){
   try{await this.pay(lobbyId,account,each,{...input,idempotencyKey:`${input.idempotencyKey}:${account.id}`});paid.push(account);}catch{failed.push(account);}
  }
  return {each,paid,failed};
 }

 // Admin correction of the pot itself (no game involved), recorded as ADMIN_ADJUSTMENT under the jackpot lock.
 adjust(lobbyId:string,admin:Account,body:unknown){
  const {operation,amount,reason}=parseBody(adjustSchema,body);
  return this.deps.commands.withPlayerLock(lobbyId,jackpotLock(lobbyId),async()=>{
   if(operation==='remove'&&this.balance(lobbyId)<amount)throw new DomainError('INSUFFICIENT_FUNDS','Le jackpot ne contient pas ce montant');
   const transaction=this.deps.domain.ledger.record({lobbyId,type:'ADMIN_ADJUSTMENT',amount,source:operation==='add'?'EXTERNAL':'JACKPOT',destination:operation==='add'?'JACKPOT':'EXTERNAL',metadata:{reason:'admin',note:reason}});
   this.deps.domain.audit.record({lobbyId,actorAccountId:admin.id,category:'JACKPOT',action:`jackpot.${operation}`,status:'SUCCESS',message:`Jackpot ${operation==='add'?'+':'−'}${amount} ₽ (${reason})`});
   return transaction;
  });
 }
}
