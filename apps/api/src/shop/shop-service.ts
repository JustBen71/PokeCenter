import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {buyProtectionSchema,buyTicketSchema,depositSplit,type Account,type Protection,type ShopSnapshot,type TicketStatus,type WheelResolution,type WheelTicket} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import type {Services} from '../services.js';
import type {MoneyLeg} from '../money/transaction-service.js';

type TicketRow={id:string;lobby_id:string;wheel_type_id:string;buyer_account_id:string;recipient_account_id:string;target_account_id:string|null;price:number;status:TicketStatus;
 command_id:string|null;resolution_id:string|null;created_at:string;queued_at:string|null;resolved_at:string|null;name:string;icon:WheelTicket['icon'];tone:WheelTicket['tone']};
type ProtectionRow={id:string;status:Protection['status'];price:number;acquired_at:string|null;used_at:string|null;command_id:string|null;lobby_id:string;account_id:string};

/**
 * Shop: wheel tickets and protections paid with in-game money. An item exists before its payment (PENDING_PAYMENT),
 * becomes usable only once the game confirmed the debit, and follows the payment into REVIEW or CANCELLED.
 * A protection blocks a hostile ticket only if it was acquired before that ticket was received.
 */
export class ShopService{
 private services!:Services;
 constructor(private readonly deps:{db:Database.Database;changed:(lobbyId:string)=>void}){}
 attach(services:Services){
  this.services=services;
  services.wheels.beforeSpin=input=>this.protect(input.lobbyId,input.wheel.tone,input.target,input.ticketReceivedAt??nowIso(),input.ticketId);
 }

 private tickets(where:string,...args:unknown[]):WheelTicket[]{
  return (this.deps.db.prepare(`SELECT t.*,w.name,w.icon,w.tone FROM wheel_tickets t JOIN wheel_types w ON w.id=t.wheel_type_id WHERE ${where} ORDER BY COALESCE(t.queued_at,t.created_at),t.rowid`).all(...args) as TicketRow[])
   .map(t=>({id:t.id,wheelId:t.wheel_type_id,wheelName:t.name,icon:t.icon,tone:t.tone,buyerId:t.buyer_account_id,recipientId:t.recipient_account_id,targetId:t.target_account_id,
    price:t.price,status:t.status,createdAt:t.created_at,queuedAt:t.queued_at,resolvedAt:t.resolved_at,resolutionId:t.resolution_id}));
 }
 private protections(lobbyId:string,accountId:string):Protection[]{
  return (this.deps.db.prepare('SELECT * FROM protections WHERE lobby_id=? AND account_id=? ORDER BY created_at DESC').all(lobbyId,accountId) as ProtectionRow[])
   .map(p=>({id:p.id,status:p.status,price:p.price,acquiredAt:p.acquired_at,usedAt:p.used_at}));
 }
 // Admin overview: every protection of the lobby with its owner.
 allProtections(lobbyId:string):(Protection&{accountId:string})[]{
  return (this.deps.db.prepare('SELECT * FROM protections WHERE lobby_id=? ORDER BY created_at DESC LIMIT 200').all(lobbyId) as ProtectionRow[])
   .map(p=>({id:p.id,accountId:p.account_id,status:p.status,price:p.price,acquiredAt:p.acquired_at,usedAt:p.used_at}));
 }
 snapshot(lobbyId:string,accountId:string):ShopSnapshot{
  return {wheels:this.services.wheels.list(lobbyId,false).filter(w=>w.forSale),protectionPrice:this.services.domain.lobbies.settings(lobbyId).protectionPrice,
   protections:this.protections(lobbyId,accountId),
   tickets:this.tickets('t.lobby_id=? AND (t.buyer_account_id=? OR t.recipient_account_id=?)',lobbyId,accountId,accountId).slice(-30),
   queue:this.tickets("t.lobby_id=? AND t.status IN ('QUEUED','PAYMENT_REVIEW')",lobbyId)};
 }

 private legs(lobbyId:string,price:number,item:Record<string,unknown>):MoneyLeg[]{
  const {bank:sink,tax:jackpot}=depositSplit(price,this.services.domain.lobbies.settings(lobbyId).shopJackpotPercent);
  return [...(sink>0?[{type:'SHOP_PURCHASE' as const,amount:sink,source:'GAME' as const,destination:'EXTERNAL' as const,metadata:item}]:[]),
   ...(jackpot>0?[{type:'JACKPOT_CONTRIBUTION' as const,amount:jackpot,source:'GAME' as const,destination:'JACKPOT' as const,metadata:{...item,reason:'shop'}}]:[])];
 }
 // Pays an existing pending item; its status follows the payment outcome.
 private async pay(lobbyId:string,buyer:Account,price:number,key:string,item:{table:'wheel_tickets'|'protections';id:string;label:string},onPaid:()=>void){
  const set=(status:string,commandId?:string|null)=>this.deps.db.prepare(`UPDATE ${item.table} SET status=?,command_id=COALESCE(?,command_id) WHERE id=?`).run(status,commandId??null,item.id);
  try{
   if(price>0){
    const result=await this.services.transactions.apply({lobbyId,accountId:buyer.id,actorAccountId:buyer.id,idempotencyKey:key,legs:this.legs(lobbyId,price,{item:item.table,id:item.id}),
     audit:{category:item.table==='protections'?'PROTECTION':'TICKET',action:'shop.buy',message:`${buyer.name} achète ${item.label} (${price} ₽)`}});
    this.deps.db.prepare(`UPDATE ${item.table} SET command_id=? WHERE id=?`).run(result.commandId,item.id);
   }
   onPaid();
  }catch(error){
   const unknown=error instanceof DomainError&&error.code==='COMMAND_OUTCOME_UNKNOWN';
   set(unknown?'PAYMENT_REVIEW':'CANCELLED',unknown?String(error.details?.commandId??''):null);
   throw error;
  }finally{this.deps.changed(lobbyId);}
 }

 async buyTicket(lobbyId:string,buyer:Account,body:unknown):Promise<WheelTicket>{
  const {wheelId,targetId,requestId}=parseBody(buyTicketSchema,body);
  const wheel=this.services.wheels.require(lobbyId,wheelId);
  if(!wheel.enabled||!wheel.forSale)throw new DomainError('CONFLICT','Cette roue n’est plus en vente');
  if(targetId&&!this.services.domain.lobbies.isMember(lobbyId,targetId))throw new DomainError('NOT_LOBBY_MEMBER','La cible ne participe pas à ce lobby');
  if(wheel.tone==='BAD'&&(!targetId||targetId===buyer.id))throw new DomainError('VALIDATION_FAILED','Choisissez un adversaire comme cible de cette roue');
  const existing=this.deps.db.prepare("SELECT id FROM wheel_tickets WHERE id=?").get(requestId) as {id:string}|undefined;
  if(existing)return this.tickets('t.id=?',requestId)[0];
  // The recipient owns the queue the ticket waits in: the victim for a hostile wheel, otherwise the buyer.
  const recipient=wheel.tone==='BAD'?targetId!:buyer.id;
  this.deps.db.prepare(`INSERT INTO wheel_tickets(id,lobby_id,wheel_type_id,buyer_account_id,recipient_account_id,target_account_id,price,status,created_at) VALUES(?,?,?,?,?,?,?,'PENDING_PAYMENT',?)`)
   .run(requestId,lobbyId,wheel.id,buyer.id,recipient,targetId??null,wheel.price,nowIso());
  await this.pay(lobbyId,buyer,wheel.price,`shop:ticket:${requestId}`,{table:'wheel_tickets',id:requestId,label:`un ticket « ${wheel.name} »`},()=>this.queue(requestId));
  return this.tickets('t.id=?',requestId)[0];
 }
 /**
  * Free ticket given by a passive: a random active wheel of the tone, queued at once like a paid one.
  * A hostile ticket waits in the target's queue and its gage benefits the owner. Null when no wheel matches.
  */
 grantTicket(lobbyId:string,input:{tone:'GOOD'|'BAD';ownerId:string;targetId:string|null;reason:string}):WheelTicket|null{
  const wheels=this.services.wheels.list(lobbyId,false).filter(w=>w.tone===input.tone);
  if(!wheels.length||(input.tone==='BAD'&&!input.targetId))return null;
  const wheel=wheels[this.services.passives.random(wheels.length)],id=randomUUID(),now=nowIso();
  this.deps.db.prepare(`INSERT INTO wheel_tickets(id,lobby_id,wheel_type_id,buyer_account_id,recipient_account_id,target_account_id,price,status,created_at,queued_at) VALUES(?,?,?,?,?,?,0,'QUEUED',?,?)`)
   .run(id,lobbyId,wheel.id,input.ownerId,input.tone==='BAD'?input.targetId:input.ownerId,input.targetId,now,now);
  const owner=this.services.domain.accounts.get(input.ownerId)?.name??input.ownerId;
  this.services.domain.audit.record({lobbyId,actorAccountId:null,targetAccountId:input.targetId??input.ownerId,category:'TICKET',action:'ticket.grant',status:'SUCCESS',
   message:`${input.reason} : ticket « ${wheel.name} » offert à ${owner}`,metadata:{ticketId:id,wheelId:wheel.id}});
  this.deps.changed(lobbyId);
  return this.tickets('t.id=?',id)[0];
 }
 // Paradoxe: a hostile ticket still waiting is cancelled, a consumed protection becomes usable again.
 cancelQueuedTicket(lobbyId:string,ticketId:string){const ok=this.deps.db.prepare("UPDATE wheel_tickets SET status='CANCELLED' WHERE id=? AND lobby_id=? AND status='QUEUED'").run(ticketId,lobbyId).changes>0;this.deps.changed(lobbyId);return ok;}
 restoreProtection(lobbyId:string,protectionId:string){const ok=this.deps.db.prepare("UPDATE protections SET status='ACTIVE',used_at=NULL,used_on_ticket_id=NULL WHERE id=? AND lobby_id=? AND status='USED'").run(protectionId,lobbyId).changes>0;this.deps.changed(lobbyId);return ok;}
 // Admin cancels a wheel still waiting in the queue (nothing drawn, nothing refunded).
 cancelTicket(lobbyId:string,ticketId:string,admin:Account){
  const ticket=this.tickets('t.id=? AND t.lobby_id=?',ticketId,lobbyId)[0];
  if(!ticket)throw new DomainError('NOT_FOUND','Ticket introuvable');
  if(!this.cancelQueuedTicket(lobbyId,ticketId))throw new DomainError('CONFLICT','Ce ticket n’est plus en attente');
  this.services.domain.audit.record({lobbyId,actorAccountId:admin.id,targetAccountId:ticket.recipientId,category:'TICKET',action:'ticket.cancel',status:'SUCCESS',
   message:`${admin.name} annule la roue « ${ticket.wheelName} » en attente`,metadata:{ticketId}});
  return this.tickets('t.id=?',ticketId)[0];
 }
 private queue(ticketId:string){this.deps.db.prepare("UPDATE wheel_tickets SET status='QUEUED',queued_at=? WHERE id=?").run(nowIso(),ticketId);}

 async buyProtection(lobbyId:string,buyer:Account,body:unknown):Promise<Protection>{
  const {requestId}=parseBody(buyProtectionSchema,body);
  if(!this.deps.db.prepare('SELECT 1 FROM protections WHERE id=?').get(requestId)){
   const price=this.services.domain.lobbies.settings(lobbyId).protectionPrice;
   this.deps.db.prepare(`INSERT INTO protections(id,lobby_id,account_id,status,price,created_at) VALUES(?,?,?,'PENDING_PAYMENT',?,?)`).run(requestId,lobbyId,buyer.id,price,nowIso());
   await this.pay(lobbyId,buyer,price,`shop:protection:${requestId}`,{table:'protections',id:requestId,label:'une protection'},()=>this.activate(requestId));
  }
  return this.protections(lobbyId,buyer.id).find(p=>p.id===requestId)!;
 }
 private activate(id:string){this.deps.db.prepare("UPDATE protections SET status='ACTIVE',acquired_at=? WHERE id=?").run(nowIso(),id);}

 /** Hostile wheel: consumes the oldest protection acquired strictly before the attack was received. */
 private protect(lobbyId:string,tone:string,target:Account|null,receivedAt:string,ticketId?:string|null):string|null{
  if(tone!=='BAD'||!target)return null;
  const protection=this.deps.db.prepare("SELECT * FROM protections WHERE lobby_id=? AND account_id=? AND status='ACTIVE' AND acquired_at<? ORDER BY acquired_at LIMIT 1").get(lobbyId,target.id,receivedAt) as ProtectionRow|undefined;
  if(!protection)return null;
  this.deps.db.prepare("UPDATE protections SET status='USED',used_at=?,used_on_ticket_id=? WHERE id=?").run(nowIso(),ticketId??null,protection.id);
  this.services.domain.audit.record({lobbyId,targetAccountId:target.id,category:'PROTECTION',action:'protection.used',status:'SUCCESS',message:`La protection de ${target.name} bloque une roue hostile`,metadata:{protectionId:protection.id,ticketId}});
  this.deps.changed(lobbyId);
  return `🛡 ${target.name} était protégé : la roue est bloquée`;
 }

 /** Admin resolves the queue one ticket at a time: the wheel is spun for the ticket's buyer and target. */
 resolveTicket(lobbyId:string,ticketId:string,admin:Account):WheelResolution{
  const ticket=this.tickets('t.id=? AND t.lobby_id=?',ticketId,lobbyId)[0];
  if(!ticket)throw new DomainError('NOT_FOUND','Ticket introuvable');
  const claimed=this.deps.db.prepare("UPDATE wheel_tickets SET status='RESOLVED',resolved_at=? WHERE id=? AND status='QUEUED'").run(nowIso(),ticketId).changes;
  if(!claimed)throw new DomainError('CONFLICT','Ce ticket n’est pas en attente');
  try{
   const resolution=this.services.wheels.spin(lobbyId,ticket.wheelId,{ownerId:ticket.buyerId,...(ticket.targetId?{targetId:ticket.targetId}:{})},admin,ticketId,ticket.queuedAt??ticket.createdAt);
   this.deps.db.prepare('UPDATE wheel_tickets SET status=?,resolution_id=? WHERE id=?').run(resolution.status==='BLOCKED'?'BLOCKED':'RESOLVED',resolution.id,ticketId);
   return resolution;
  }catch(error){
   this.deps.db.prepare("UPDATE wheel_tickets SET status='QUEUED',resolved_at=NULL WHERE id=?").run(ticketId);
   throw error;
  }finally{this.deps.changed(lobbyId);}
 }

 // An uncertain payment checked by an admin: the item becomes usable or is cancelled.
 commandResolved(commandId:string,applied:boolean){
  const ticket=this.deps.db.prepare("SELECT id,lobby_id FROM wheel_tickets WHERE command_id=? AND status='PAYMENT_REVIEW'").get(commandId) as {id:string;lobby_id:string}|undefined;
  if(ticket){if(applied)this.queue(ticket.id);else this.deps.db.prepare("UPDATE wheel_tickets SET status='CANCELLED' WHERE id=?").run(ticket.id);this.deps.changed(ticket.lobby_id);}
  const protection=this.deps.db.prepare("SELECT id,lobby_id FROM protections WHERE command_id=? AND status='PAYMENT_REVIEW'").get(commandId) as {id:string;lobby_id:string}|undefined;
  if(protection){if(applied)this.activate(protection.id);else this.deps.db.prepare("UPDATE protections SET status='CANCELLED' WHERE id=?").run(protection.id);this.deps.changed(protection.lobby_id);}
 }
}
