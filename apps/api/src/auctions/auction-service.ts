import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {auctionBidSchema,auctionCreateSchema,depositSplit,encodePokemon,type Account,type AuctionStatus,type LobbyAuction,type AuctionsSnapshot,type PokemonInjection,type PublicNativeClient} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import {auctionHints} from '../auction-hints.js';
import {auctionParticipants} from '../auction-participants.js';
import {generateLot} from '../auction-generator.js';
import type {PortalDomain} from '../store.js';
import type {CurrentGameService} from '../game/current-game-service.js';
import type {LibraryService} from '../library/library-service.js';
import type {TransactionService} from '../money/transaction-service.js';
import type {DomainEvent} from '../passives/passive-events.js';

type Row={id:string;lobby_id:string;status:AuctionStatus;species_id:number;name:string;level:number;sample_size:number;uncertainty:number;hints_json:string;template_json:string;log_json:string;
 winner_account_id:string|null;price:number|null;command_id:string|null;created_at:string;closed_at:string|null};
const PURCHASE_CAPABILITIES=['money.read','money.write','pokemon.insert'] as const;
const FINISHED:AuctionStatus[]=['SOLD','CANCELLED'];

/**
 * Lobby auctions. Bids are checked against the bidder's fresh in-game money; closing freezes the best bid and pays it
 * with one verified purchase (debit + insertion) through the money engine. The real stats stay server-side until the end.
 */
export class AuctionService{
 private generating=new Set<string>();
 constructor(private readonly deps:{domain:PortalDomain;db:Database.Database;currentGame:CurrentGameService;transactions:TransactionService;library:LibraryService;
  clients:(lobbyId:string)=>PublicNativeClient[];generate?:typeof generateLot;changed:(lobbyId:string)=>void;
  // Passive events: joined (each bid, deduplicated by id), won and lost once the lot is sold.
  events?:(event:DomainEvent)=>void}){}

 private row(id:string,lobbyId:string){
  const row=this.deps.db.prepare('SELECT * FROM lobby_auctions WHERE id=? AND lobby_id=?').get(id,lobbyId) as Row|undefined;
  if(!row)throw new DomainError('NOT_FOUND','Enchère introuvable');
  return row;
 }
 private bids(auctionId:string){
  return this.deps.db.prepare('SELECT b.account_id,b.amount,b.created_at,a.name FROM auction_bids b JOIN accounts a ON a.id=b.account_id WHERE b.auction_id=? ORDER BY b.amount')
   .all(auctionId) as {account_id:string;amount:number;created_at:string;name:string}[];
 }
 private toPublic(r:Row):LobbyAuction{
  const winner=r.winner_account_id?this.deps.domain.accounts.get(r.winner_account_id):undefined;
  return {id:r.id,status:r.status,speciesId:r.species_id,name:r.name,level:r.level,sampleSize:r.sample_size,uncertainty:r.uncertainty,hints:JSON.parse(r.hints_json),
   bids:this.bids(r.id).map(b=>({accountId:b.account_id,name:b.name,amount:b.amount,at:b.created_at})),log:JSON.parse(r.log_json),createdAt:r.created_at,closedAt:r.closed_at,
   winner:r.winner_account_id&&r.price!==null?{accountId:r.winner_account_id,name:winner?.name??r.winner_account_id,price:r.price}:null,commandId:r.command_id,
   // Exact values only once nothing can be bid any more.
   revealed:FINISHED.includes(r.status)?JSON.parse(r.template_json):null};
 }
 private update(id:string,patch:{status?:AuctionStatus;log?:string;winner?:string|null;price?:number|null;commandId?:string|null;closed?:boolean}){
  const r=this.deps.db.prepare('SELECT * FROM lobby_auctions WHERE id=?').get(id) as Row;
  const log=JSON.parse(r.log_json) as string[];if(patch.log)log.push(`${new Date().toLocaleTimeString('fr-FR')} · ${patch.log}`);
  this.deps.db.prepare('UPDATE lobby_auctions SET status=?,log_json=?,winner_account_id=?,price=?,command_id=?,closed_at=? WHERE id=?')
   .run(patch.status??r.status,JSON.stringify(log.slice(-50)),patch.winner===undefined?r.winner_account_id:patch.winner,patch.price===undefined?r.price:patch.price,
    patch.commandId===undefined?r.command_id:patch.commandId,patch.closed?nowIso():r.closed_at,id);
 }

 snapshot(lobbyId:string):AuctionsSnapshot{
  const rows=this.deps.db.prepare('SELECT * FROM lobby_auctions WHERE lobby_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').all(lobbyId) as Row[];
  return {auctions:rows.map(r=>this.toPublic(r)),generating:this.generating.has(lobbyId)};
 }

 async create(lobbyId:string,actor:Account,body:unknown):Promise<LobbyAuction>{
  const {uncertainty}=parseBody(auctionCreateSchema,body);
  if(this.generating.has(lobbyId)||this.deps.db.prepare("SELECT 1 FROM lobby_auctions WHERE lobby_id=? AND status IN ('OPEN','SETTLING','REVIEW')").get(lobbyId))
   throw new DomainError('CONFLICT','Terminez ou annulez l’enchère en cours');
  this.generating.add(lobbyId);this.deps.changed(lobbyId);
  try{
   // Level from the Pokémon of the active players (members with a live, readable game).
   const players=auctionParticipants([],this.deps.clients(lobbyId).filter(c=>this.deps.domain.lobbies.isMember(lobbyId,c.accountId)));
   let lot;
   try{lot=await (this.deps.generate??generateLot)(players);}catch(e){throw new DomainError('VALIDATION_FAILED',e instanceof Error?e.message:'Génération impossible');}
   const id=randomUUID();
   this.deps.db.prepare(`INSERT INTO lobby_auctions(id,lobby_id,status,species_id,name,level,sample_size,uncertainty,hints_json,template_json,log_json,created_by,created_at) VALUES(?,?,'OPEN',?,?,?,?,?,?,?,?,?,?)`)
    .run(id,lobbyId,lot.speciesId,lot.name,lot.level,lot.sampleSize,uncertainty,JSON.stringify(auctionHints(lot.template,uncertainty)),JSON.stringify(lot.template),
     JSON.stringify([`Lot généré : ${lot.name} niv. ${lot.level}. Les enchères démarrent à la première mise (1 ₽ minimum).`]),actor.id,nowIso());
   this.deps.domain.audit.record({lobbyId,actorAccountId:actor.id,category:'AUCTION',action:'auction.create',status:'SUCCESS',message:`Enchère créée : ${lot.name} niv. ${lot.level}`,metadata:{auctionId:id,uncertainty}});
   return this.toPublic(this.row(id,lobbyId));
  }finally{this.generating.delete(lobbyId);this.deps.changed(lobbyId);}
 }

 bid(lobbyId:string,auctionId:string,bidder:Account,body:unknown):LobbyAuction{
  const {amount}=parseBody(auctionBidSchema,body);
  if(!this.deps.domain.lobbies.isMember(lobbyId,bidder.id))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby pour miser');
  // A bid must be payable right now: live game, purchase capabilities, money and a free slot.
  const {state}=this.deps.currentGame.requireState(lobbyId,bidder.id,{capabilities:[...PURCHASE_CAPABILITIES]});
  if(amount>state.trainer.money)throw new DomainError('INSUFFICIENT_FUNDS','Pas assez de Pokédollars dans le jeu pour cette mise');
  if(state.party.length>=6)throw new DomainError('PARTY_FULL','Libérez un emplacement d’équipe pour miser');
  // Check and insert in one SQLite transaction: concurrent bids are serialized, the unique amount refuses ties.
  this.deps.db.transaction(()=>{
   const r=this.row(auctionId,lobbyId);
   if(r.status!=='OPEN')throw new DomainError('CONFLICT','Les mises sont closes');
   const best=this.bids(auctionId).at(-1);
   if(best&&amount<=best.amount)throw new DomainError('CONFLICT',`La mise doit dépasser ${best.amount} ₽`,{best:best.amount});
   if(this.bids(auctionId).length>=1000)throw new DomainError('CONFLICT','Limite de mises atteinte');
   this.deps.db.prepare('INSERT INTO auction_bids(id,auction_id,account_id,amount,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),auctionId,bidder.id,amount,nowIso());
   this.update(auctionId,{log:best?`${bidder.name} mise ${amount} ₽`:`Première mise : ${bidder.name}, ${amount} ₽. L’enchère est lancée !`});
  })();
  this.deps.changed(lobbyId);
  this.deps.events?.({lobbyId,accountId:bidder.id,id:`auction-joined:${auctionId}`,type:'AUCTION_JOINED',data:{auctionId}});
  return this.toPublic(this.row(auctionId,lobbyId));
 }

 // Winner and losers of a sold lot, for the passives.
 private sold(lobbyId:string,auctionId:string,winnerId:string){
  for(const accountId of new Set(this.bids(auctionId).map(b=>b.account_id)))
   this.deps.events?.(accountId===winnerId
    ?{lobbyId,accountId,id:`auction-won:${auctionId}`,type:'AUCTION_WON',data:{auctionId}}
    :{lobbyId,accountId,id:`auction-lost:${auctionId}`,type:'AUCTION_LOST',data:{auctionId}});
 }

 cancel(lobbyId:string,auctionId:string,actor:Account):LobbyAuction{
  const r=this.row(auctionId,lobbyId);
  if(r.status!=='OPEN')throw new DomainError('CONFLICT','Seule une enchère ouverte peut être annulée');
  this.update(auctionId,{status:'CANCELLED',closed:true,log:'Annulée sans débit.'});
  this.deps.domain.audit.record({lobbyId,actorAccountId:actor.id,category:'AUCTION',action:'auction.cancel',status:'SUCCESS',message:`Enchère ${r.name} annulée`,metadata:{auctionId}});
  this.deps.changed(lobbyId);
  return this.toPublic(this.row(auctionId,lobbyId));
 }

 /** Admin closing: the best bid is frozen, then paid and delivered in one verified game write. */
 async close(lobbyId:string,auctionId:string,actor:Account):Promise<LobbyAuction>{
  const frozen=this.deps.db.transaction(()=>{
   const r=this.row(auctionId,lobbyId);
   if(r.status!=='OPEN')throw new DomainError('CONFLICT','Cette enchère ne peut pas être clôturée');
   const best=this.bids(auctionId).at(-1);
   if(!best)throw new DomainError('CONFLICT','Aucune mise : annulez l’enchère ou attendez une offre');
   this.update(auctionId,{status:'SETTLING',winner:best.account_id,price:best.amount,log:`Clôture : ${best.name} remporte le lot pour ${best.amount} ₽. Paiement en cours.`});
   return {row:r,best};
  })();
  this.deps.changed(lobbyId);
  const {best,row}=frozen;
  const template=JSON.parse(row.template_json) as PokemonInjection;
  const {tax:jackpot,bank:payment}=depositSplit(best.amount,this.deps.domain.lobbies.settings(lobbyId).auctionJackpotPercent);
  try{
   const result=await this.deps.transactions.apply({lobbyId,accountId:best.account_id,actorAccountId:actor.id,idempotencyKey:`auction:${auctionId}`,
    legs:[...(payment>0?[{type:'AUCTION_PAYMENT' as const,amount:payment,source:'GAME' as const,destination:'EXTERNAL' as const,metadata:{auctionId}}]:[]),
     ...(jackpot>0?[{type:'JACKPOT_CONTRIBUTION' as const,amount:jackpot,source:'GAME' as const,destination:'JACKPOT' as const,metadata:{auctionId,reason:'auction'}}]:[])],
    audit:{category:'AUCTION',action:'auction.settle',message:`${best.name} achète ${row.name} pour ${best.amount} ₽`},
    gameCommand:{capabilities:[...PURCHASE_CAPABILITIES],requireSafeState:true,build:state=>{
     if(state.party.length>=6)throw new DomainError('PARTY_FULL','L’équipe du gagnant est complète');
     return {command:'pokemon.purchase',payload:{price:best.amount,expectedMoney:state.trainer.money,expectedCount:state.party.length,raw:encodePokemon({...template,slot:state.party.length+1})}};
    }}});
   this.update(auctionId,{status:'SOLD',closed:true,commandId:result.commandId,log:'Paiement et ajout dans l’équipe confirmés par le jeu.'});
   this.sold(lobbyId,auctionId,best.account_id);
  }catch(error){
   const code=error instanceof DomainError?error.code:'INTERNAL_ERROR';
   if(code==='COMMAND_OUTCOME_UNKNOWN'){
    this.update(auctionId,{status:'REVIEW',commandId:String((error as DomainError).details?.commandId??''),log:'Confirmation perdue : vérifiez le solde et l’équipe du gagnant. Aucun nouvel essai automatique.'});
   }else{
    // Nothing was written: the auction stays open so the admin can retry or cancel.
    this.update(auctionId,{status:'OPEN',winner:null,price:null,log:`Paiement impossible (${error instanceof Error?error.message:code}). Rien n’a été débité.`});
   }
   this.deps.changed(lobbyId);
   throw error;
  }
  this.deps.changed(lobbyId);
  return this.toPublic(this.row(auctionId,lobbyId));
 }

 // Manual outcome after checking the game (REVIEW only). Ledger rows follow through the command resolution.
 commandResolved(commandId:string,applied:boolean){
  const r=this.deps.db.prepare("SELECT * FROM lobby_auctions WHERE command_id=? AND status='REVIEW'").get(commandId) as Row|undefined;
  if(!r)return;
  if(applied&&r.winner_account_id)this.sold(r.lobby_id,r.id,r.winner_account_id);
  this.update(r.id,applied?{status:'SOLD',closed:true,log:'Vérification : paiement et Pokémon présents dans le jeu.'}:{status:'OPEN',winner:null,price:null,commandId:null,log:'Vérification : rien n’a été appliqué, l’enchère est rouverte.'});
  this.deps.changed(r.lobby_id);
 }

 // After the end, an admin may keep the lot in the library without taking it from the winner.
 copyToLibrary(lobbyId:string,auctionId:string,actor:Account){
  const r=this.row(auctionId,lobbyId);
  if(!FINISHED.includes(r.status))throw new DomainError('CONFLICT','Disponible une fois l’enchère terminée');
  return this.deps.library.create({label:`${r.name} · enchère`,template:JSON.parse(r.template_json),source:'Enchère'},actor.id);
 }
}

