import {bankOperationSchema,depositSplit,type BankSnapshot} from '@pokerace/shared';
import {parseBody} from '../http.js';
import type {PortalDomain} from '../store.js';
import type {MoneyResult,TransactionService} from './transaction-service.js';

/**
 * Bank of a player in a lobby (it survives lost Runs) and lobby jackpot.
 * Deposit: game −amount → bank +(amount − tax) and jackpot +tax. Withdraw: bank −amount → game +amount.
 * Server balances move only once the game confirmed its side (see TransactionService).
 */
export class BankService{
 constructor(private readonly deps:{domain:PortalDomain;transactions:TransactionService}){}

 snapshot(lobbyId:string,accountId:string):BankSnapshot{
  const {ledger,lobbies}=this.deps.domain;
  return {balance:ledger.bankBalance(lobbyId,accountId),jackpot:ledger.jackpotBalance(lobbyId),taxPercent:lobbies.settings(lobbyId).bankDepositTaxPercent,
   history:ledger.list(lobbyId,{accountId,limit:30})};
 }

 deposit(lobbyId:string,accountId:string,body:unknown):Promise<MoneyResult>{
  const {amount,requestId}=parseBody(bankOperationSchema,body);
  const {bank,tax}=depositSplit(amount,this.deps.domain.lobbies.settings(lobbyId).bankDepositTaxPercent);
  return this.deps.transactions.apply({lobbyId,accountId,actorAccountId:accountId,idempotencyKey:`bank:${lobbyId}:${accountId}:${requestId}`,
   legs:[
    ...(bank>0?[{type:'BANK_DEPOSIT' as const,amount:bank,source:'GAME' as const,destination:'BANK' as const}]:[]),
    ...(tax>0?[{type:'JACKPOT_CONTRIBUTION' as const,amount:tax,source:'GAME' as const,destination:'JACKPOT' as const,metadata:{reason:'bank_deposit_tax'}}]:[])
   ],
   audit:{category:'BANK',action:'bank.deposit',message:`Dépôt de ${amount} ₽ : ${bank} ₽ en banque${tax?`, ${tax} ₽ au jackpot`:''}`}});
 }

 withdraw(lobbyId:string,accountId:string,body:unknown):Promise<MoneyResult>{
  const {amount,requestId}=parseBody(bankOperationSchema,body);
  return this.deps.transactions.apply({lobbyId,accountId,actorAccountId:accountId,idempotencyKey:`bank:${lobbyId}:${accountId}:${requestId}`,
   legs:[{type:'BANK_WITHDRAW',amount,source:'BANK',destination:'GAME'}],
   audit:{category:'BANK',action:'bank.withdraw',message:`Retrait de ${amount} ₽ de la banque vers le jeu`}});
 }
}
