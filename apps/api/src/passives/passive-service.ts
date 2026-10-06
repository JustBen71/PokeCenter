import type Database from 'better-sqlite3';
import {randomInt,randomUUID} from 'node:crypto';
import {defaultRarityWeights,passiveById,passiveCatalog,passiveRarities,passiveRarityLabels,passiveSettingsSchema,PASSIVE_CATALOG_VERSION,
 type LobbyNotification,type OwnedPassive,type PassiveCatalogEntry,type PassiveDefinition,type PassivePhase,type PassiveRarity,type PassiveReward,type PassiveRewardStatus,type PassiveSelectionState,type PassiveSource,type PassivesSnapshot} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import type {PortalDomain} from '../store.js';
import {availability,missingCapabilities} from './passive-catalog.js';

type OwnedRow={id:string;lobby_id:string;account_id:string;passive_id:string;source:PassiveSource;acquired_at:string;metadata_json:string};
type SettingsRow={phase:PassivePhase;weights_json:string;disabled_json:string};
export type PassiveSettings={phase:PassivePhase;weights:Record<PassiveRarity,number>;disabled:string[]};
export type Random=(n:number)=>number;
export type PassiveDeps={
 domain:PortalDomain;implemented:ReadonlySet<string>;random?:Random;
 changed:(lobbyId:string)=>void;notify:(lobbyId:string,n:LobbyNotification,accountId?:string)=>void;
};

/**
 * Possession of race passives (LOBBY + ACCOUNT). Every change is one SQLite transaction, audited (PASSIVE),
 * pushed live and notified. Offers and random grants only use enabled, implemented and compatible passives.
 */
export class PassiveService{
 readonly random:Random;
 constructor(readonly deps:PassiveDeps){this.random=deps.random??(n=>randomInt(n));}
 private get db():Database.Database{return this.deps.domain.db;}

 settings(lobbyId:string):PassiveSettings{
  const row=this.db.prepare('SELECT phase,weights_json,disabled_json FROM passive_settings WHERE lobby_id=?').get(lobbyId) as SettingsRow|undefined;
  return row?{phase:row.phase,weights:JSON.parse(row.weights_json),disabled:JSON.parse(row.disabled_json)}:{phase:'NONE',weights:{...defaultRarityWeights},disabled:[]};
 }
 protected saveSettings(lobbyId:string,s:PassiveSettings){
  this.db.prepare(`INSERT INTO passive_settings(lobby_id,phase,weights_json,disabled_json,updated_at) VALUES(?,?,?,?,?)
   ON CONFLICT(lobby_id) DO UPDATE SET phase=excluded.phase,weights_json=excluded.weights_json,disabled_json=excluded.disabled_json,updated_at=excluded.updated_at`)
   .run(lobbyId,s.phase,JSON.stringify(s.weights),JSON.stringify(s.disabled),nowIso());
 }
 updateSettings(lobbyId:string,body:unknown,actorId:string):PassiveSettings{
  this.deps.domain.lobbies.require(lobbyId);
  const patch=parseBody(passiveSettingsSchema,body);
  const unknown=patch.disabled?.find(id=>!passiveById.has(id));
  if(unknown)throw new DomainError('VALIDATION_FAILED',`Passif inconnu : ${unknown}`);
  const before=this.settings(lobbyId),next={...before,...patch.weights?{weights:patch.weights}:{},...patch.disabled?{disabled:[...new Set(patch.disabled)]}:{}};
  this.saveSettings(lobbyId,next);
  this.audit(lobbyId,{actorAccountId:actorId,action:'passive.settings',message:'Réglages des passifs modifiés',metadata:{from:{weights:before.weights,disabled:before.disabled},to:{weights:next.weights,disabled:next.disabled}}});
  this.deps.changed(lobbyId);
  return next;
 }

 catalog(lobbyId:string):PassiveCatalogEntry[]{
  const {disabled}=this.settings(lobbyId);
  return passiveCatalog.map(p=>({...p,enabled:!disabled.includes(p.id),availability:availability(p,this.deps.implemented),missing:missingCapabilities(p)}));
 }
 // What may be offered or granted at random: enabled, implemented, compatible.
 offerable(lobbyId:string):PassiveDefinition[]{return this.catalog(lobbyId).filter(p=>p.enabled&&p.availability==='AVAILABLE');}

 private toOwned(r:OwnedRow):OwnedPassive{
  return {id:r.id,accountId:r.account_id,passiveId:r.passive_id,source:r.source,acquiredAt:r.acquired_at,progress:this.progressOf(r.lobby_id,r.account_id,r.passive_id),metadata:JSON.parse(r.metadata_json)};
 }
 owned(lobbyId:string,accountId?:string):OwnedPassive[]{
  const rows=accountId
   ?this.db.prepare('SELECT * FROM race_passives WHERE lobby_id=? AND account_id=? ORDER BY acquired_at,rowid').all(lobbyId,accountId)
   :this.db.prepare('SELECT * FROM race_passives WHERE lobby_id=? ORDER BY acquired_at,rowid').all(lobbyId);
  return (rows as OwnedRow[]).map(r=>this.toOwned(r));
 }
 has(lobbyId:string,accountId:string,passiveId:string){return !!this.db.prepare('SELECT 1 FROM race_passives WHERE lobby_id=? AND account_id=? AND passive_id=?').get(lobbyId,accountId,passiveId);}
 // Accounts of the lobby owning a passive, in acquisition order (deterministic engine evaluation).
 holders(lobbyId:string,passiveId:string):string[]{
  return (this.db.prepare('SELECT account_id FROM race_passives WHERE lobby_id=? AND passive_id=? ORDER BY acquired_at,rowid').all(lobbyId,passiveId) as {account_id:string}[]).map(r=>r.account_id);
 }

 progressOf(lobbyId:string,accountId:string,passiveId:string):Record<string,unknown>{
  // Keys starting with « _ » are server-only (e.g. the exact copy of a bound Pokémon) and never published.
  const rows=this.db.prepare("SELECT key,value_json FROM passive_progress WHERE lobby_id=? AND account_id=? AND passive_id=? AND key NOT LIKE '\\_%' ESCAPE '\\'").all(lobbyId,accountId,passiveId) as {key:string;value_json:string}[];
  return Object.fromEntries(rows.map(r=>[r.key,JSON.parse(r.value_json)]));
 }
 progress<T>(lobbyId:string,accountId:string,passiveId:string,key:string,fallback:T):T{
  const row=this.db.prepare('SELECT value_json FROM passive_progress WHERE lobby_id=? AND account_id=? AND passive_id=? AND key=?').get(lobbyId,accountId,passiveId,key) as {value_json:string}|undefined;
  return row?JSON.parse(row.value_json) as T:fallback;
 }
 setProgress(lobbyId:string,accountId:string,passiveId:string,key:string,value:unknown){
  this.db.prepare(`INSERT INTO passive_progress(lobby_id,account_id,passive_id,key,value_json,updated_at) VALUES(?,?,?,?,?,?)
   ON CONFLICT(lobby_id,account_id,passive_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).run(lobbyId,accountId,passiveId,key,JSON.stringify(value),nowIso());
 }
 // A single-use passive fully consumed cannot be stolen.
 consumed(lobbyId:string,accountId:string,passiveId:string){return this.progress<boolean>(lobbyId,accountId,passiveId,'consumed',false)===true;}

 private member(lobbyId:string,accountId:string){
  const account=this.deps.domain.accounts.get(accountId);
  if(!account||!this.deps.domain.lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Ce joueur ne participe pas à ce lobby');
  return account;
 }
 private definition(passiveId:string){
  const passive=passiveById.get(passiveId);if(!passive)throw new DomainError('NOT_FOUND','Passif inconnu');
  return passive;
 }
 private requireOfferable(lobbyId:string,passive:PassiveDefinition){
  const entry=this.catalog(lobbyId).find(p=>p.id===passive.id)!;
  if(entry.availability!=='AVAILABLE')throw new DomainError('CAPABILITY_MISSING',`« ${passive.name} » n’est pas disponible (${entry.availability==='DISABLED_MISSING_CAPABILITY'?`capability manquante : ${entry.missing.join(', ')}`:'pas encore implémenté'})`);
  if(!entry.enabled)throw new DomainError('CONFLICT',`« ${passive.name} » est désactivé dans ce lobby`);
 }
 protected audit(lobbyId:string,entry:{actorAccountId?:string|null;targetAccountId?:string|null;action:string;message:string;status?:'SUCCESS'|'FAILED'|'INFO'|'PENDING'|'REVIEW';metadata?:Record<string,unknown>}){
  this.deps.domain.audit.record({lobbyId,category:'PASSIVE',status:'SUCCESS',...entry});
 }
 private insert(lobbyId:string,accountId:string,passiveId:string,source:PassiveSource,metadata:Record<string,unknown>){
  try{
   this.db.prepare('INSERT INTO race_passives(id,lobby_id,account_id,passive_id,source,acquired_at,metadata_json) VALUES(?,?,?,?,?,?,?)')
    .run(randomUUID(),lobbyId,accountId,passiveId,source,nowIso(),JSON.stringify(metadata));
  }catch(e){
   if(e instanceof Error&&/UNIQUE constraint failed: race_passives/.test(e.message))throw new DomainError('PASSIVE_ALREADY_OWNED','Ce joueur possède déjà ce passif');
   throw e;
  }
 }

 /** Gives a passive (initial choice, admin, wheel…). Refused if already owned or not available. */
 grant(lobbyId:string,accountId:string,passiveId:string,source:PassiveSource,options:{actorId?:string|null;metadata?:Record<string,unknown>;announce?:string;quiet?:boolean}={}):OwnedPassive{
  const account=this.member(lobbyId,accountId),passive=this.definition(passiveId);
  this.requireOfferable(lobbyId,passive);
  this.db.transaction(()=>{
   if(this.has(lobbyId,accountId,passiveId))throw new DomainError('PASSIVE_ALREADY_OWNED',`${account.name} possède déjà « ${passive.name} »`);
   this.insert(lobbyId,accountId,passiveId,source,options.metadata??{});
   this.audit(lobbyId,{actorAccountId:options.actorId??null,targetAccountId:accountId,action:'passive.grant',message:`${account.name} obtient « ${passive.name} » (${passiveRarityLabels[passive.rarity]})`,metadata:{passiveId,source,...options.metadata}});
  })();
  if(!options.quiet)this.deps.notify(lobbyId,{kind:'success',message:options.announce??`✨ ${passive.rarity==='LEGENDARY'?'Passif légendaire':'Nouveau passif'} — ${account.name} obtient « ${passive.name} »`});
  this.deps.changed(lobbyId);
  return this.owned(lobbyId,accountId).find(p=>p.passiveId===passiveId)!;
 }

 /** Removes a passive and its progression (admin correction, offer reset). */
 revoke(lobbyId:string,accountId:string,passiveId:string,options:{actorId?:string|null;reason?:string}={}){
  const account=this.member(lobbyId,accountId),passive=this.definition(passiveId);
  this.db.transaction(()=>{
   const removed=this.db.prepare('DELETE FROM race_passives WHERE lobby_id=? AND account_id=? AND passive_id=?').run(lobbyId,accountId,passiveId).changes;
   if(!removed)throw new DomainError('PASSIVE_NOT_OWNED',`${account.name} ne possède pas « ${passive.name} »`);
   this.db.prepare('DELETE FROM passive_progress WHERE lobby_id=? AND account_id=? AND passive_id=?').run(lobbyId,accountId,passiveId);
   this.audit(lobbyId,{actorAccountId:options.actorId??null,targetAccountId:accountId,action:'passive.revoke',message:`${account.name} perd « ${passive.name} »${options.reason?` (${options.reason})`:''}`,metadata:{passiveId}});
  })();
  this.deps.changed(lobbyId);
 }

 /** Atomic steal: the target loses the passive, the receiver gains it with its progression. */
 transfer(lobbyId:string,fromId:string,toId:string,passiveId:string,options:{actorId?:string|null;source?:PassiveSource;metadata?:Record<string,unknown>}={}){
  const from=this.member(lobbyId,fromId),to=this.member(lobbyId,toId),passive=this.definition(passiveId);
  if(fromId===toId)throw new DomainError('VALIDATION_FAILED','On ne se vole pas soi-même');
  this.db.transaction(()=>{
   if(!this.has(lobbyId,fromId,passiveId))throw new DomainError('PASSIVE_NOT_OWNED',`${from.name} ne possède pas « ${passive.name} »`);
   if(this.has(lobbyId,toId,passiveId))throw new DomainError('PASSIVE_ALREADY_OWNED',`${to.name} possède déjà « ${passive.name} »`);
   if(this.consumed(lobbyId,fromId,passiveId))throw new DomainError('CONFLICT',`« ${passive.name} » est déjà consommé`);
   this.db.prepare('UPDATE passive_progress SET account_id=?,updated_at=? WHERE lobby_id=? AND account_id=? AND passive_id=?').run(toId,nowIso(),lobbyId,fromId,passiveId);
   this.db.prepare('DELETE FROM race_passives WHERE lobby_id=? AND account_id=? AND passive_id=?').run(lobbyId,fromId,passiveId);
   this.insert(lobbyId,toId,passiveId,options.source??'WHEEL',{...options.metadata,stolenFrom:fromId});
   this.audit(lobbyId,{actorAccountId:options.actorId??null,targetAccountId:fromId,action:'passive.steal',message:`${to.name} vole « ${passive.name} » à ${from.name}`,metadata:{passiveId,from:fromId,to:toId,...options.metadata}});
  })();
  this.deps.notify(lobbyId,{kind:'warning',message:`😈 Passif volé — ${to.name} t’a volé « ${passive.name} »`},fromId);
  this.deps.notify(lobbyId,{kind:'success',message:`🎭 Vol réussi — tu récupères « ${passive.name} » de ${from.name}`},toId);
  this.deps.notify(lobbyId,{kind:'info',message:`🎭 ${to.name} vole « ${passive.name} » à ${from.name}`});
  this.deps.changed(lobbyId);
 }
 // Passives of a player that another one could steal.
 stealable(lobbyId:string,fromId:string,toId:string):OwnedPassive[]{
  return this.owned(lobbyId,fromId).filter(p=>!this.has(lobbyId,toId,p.passiveId)&&p.progress.consumed!==true);
 }

 /**
  * Weighted draw: a rarity by the lobby weights (among rarities that still have candidates), then a passive of it.
  * Excludes passives the player owns and the given ids. Returns null when nothing is compatible.
  */
 pick(lobbyId:string,accountId:string,options:{rarities?:readonly PassiveRarity[];exclude?:readonly string[]}={}):PassiveDefinition|null{
  const owned=new Set(this.owned(lobbyId,accountId).map(p=>p.passiveId));
  const pool=this.offerable(lobbyId).filter(p=>!owned.has(p.id)&&!options.exclude?.includes(p.id)&&(!options.rarities||options.rarities.includes(p.rarity)));
  if(!pool.length)return null;
  const {weights}=this.settings(lobbyId);
  const rarities=passiveRarities.filter(r=>pool.some(p=>p.rarity===r));
  const total=rarities.reduce((n,r)=>n+weights[r],0);
  let rarity:PassiveRarity;
  // Only zero-weight rarities left (e.g. a wheel asking for one): every remaining rarity is equally likely.
  if(total===0)rarity=rarities[this.random(rarities.length)];
  else{let roll=this.random(total);rarity=rarities.find(r=>(roll-=weights[r])<0)!;}
  const ofRarity=pool.filter(p=>p.rarity===rarity);
  return ofRarity[this.random(ofRarity.length)];
 }

 // ---- Initial selection: three private cards per player, one choice, persisted. ----

 private generation(lobbyId:string,accountId:string):number{
  return (this.db.prepare('SELECT COALESCE(MAX(generation),0) AS g FROM passive_offers WHERE lobby_id=? AND account_id=?').get(lobbyId,accountId) as {g:number}).g;
 }
 private offerRows(lobbyId:string,accountId:string){
  return this.db.prepare("SELECT passive_id,status FROM passive_offers WHERE lobby_id=? AND account_id=? AND generation=? ORDER BY offer_index").all(lobbyId,accountId,this.generation(lobbyId,accountId)) as {passive_id:string;status:string}[];
 }
 selectionState(lobbyId:string,accountId:string):PassiveSelectionState['status']{
  const rows=this.offerRows(lobbyId,accountId);
  if(rows.some(r=>r.status==='CHOSEN'))return 'CHOSEN';
  return rows.some(r=>r.status==='OFFERED')?'WAITING':'NO_OFFER';
 }
 // The viewer's own pending cards; a reconnection returns the same offer.
 pendingOffer(lobbyId:string,accountId:string):string[]|null{
  const rows=this.offerRows(lobbyId,accountId);
  return rows.length&&rows.every(r=>r.status==='OFFERED')?rows.map(r=>r.passive_id):null;
 }
 private requirePhase(lobbyId:string,phase:PassivePhase,message:string){
  if(this.settings(lobbyId).phase!==phase)throw new DomainError('CONFLICT',message);
 }

 /** Draws up to three different compatible passives for a player and stores them as a new generation. */
 private generateOffer(lobbyId:string,accountId:string):string[]{
  const picked:string[]=[];
  for(let i=0;i<3;i++){const p=this.pick(lobbyId,accountId,{exclude:picked});if(!p)break;picked.push(p.id);}
  if(!picked.length)throw new DomainError('NO_PASSIVE_AVAILABLE','Aucun passif compatible à proposer');
  const generation=this.generation(lobbyId,accountId)+1,at=nowIso();
  const insert=this.db.prepare("INSERT INTO passive_offers(id,lobby_id,account_id,generation,passive_id,offer_index,status,generated_at) VALUES(?,?,?,?,?,?,'OFFERED',?)");
  picked.forEach((id,i)=>insert.run(randomUUID(),lobbyId,accountId,generation,id,i,at));
  return picked;
 }

 /** Admin launches the race: every member receives a private offer, then the lobby waits for the choices. */
 startSelection(lobbyId:string,actorId:string){
  this.deps.domain.lobbies.require(lobbyId);
  this.requirePhase(lobbyId,'NONE','La sélection des passifs a déjà été lancée');
  const members=this.deps.domain.lobbies.members(lobbyId);
  if(!members.length)throw new DomainError('CONFLICT','Aucun participant dans ce lobby');
  this.db.transaction(()=>{
   for(const m of members)if(this.selectionState(lobbyId,m.accountId)==='NO_OFFER')this.generateOffer(lobbyId,m.accountId);
   this.saveSettings(lobbyId,{...this.settings(lobbyId),phase:'SELECTION'});
   this.audit(lobbyId,{actorAccountId:actorId,action:'passive.selection.start',message:`Sélection des passifs lancée pour ${members.length} joueur${members.length>1?'s':''}`});
  })();
  this.deps.notify(lobbyId,{kind:'info',message:'🃏 La course commence : choisis ton passif parmi trois cartes'});
  this.deps.changed(lobbyId);
 }

 /** The player picks one of their own cards: the passive is granted, the two others are rejected. */
 choose(lobbyId:string,accountId:string,passiveId:string){
  this.requirePhase(lobbyId,'SELECTION','La sélection des passifs n’est pas ouverte');
  const passive=this.definition(passiveId);
  this.db.transaction(()=>{
   const generation=this.generation(lobbyId,accountId);
   const claimed=this.db.prepare("UPDATE passive_offers SET status='CHOSEN',chosen_at=? WHERE lobby_id=? AND account_id=? AND generation=? AND passive_id=? AND status='OFFERED' AND NOT EXISTS(SELECT 1 FROM passive_offers o WHERE o.lobby_id=? AND o.account_id=? AND o.generation=? AND o.status='CHOSEN')")
    .run(nowIso(),lobbyId,accountId,generation,passiveId,lobbyId,accountId,generation).changes;
   if(!claimed)throw new DomainError('CONFLICT',this.selectionState(lobbyId,accountId)==='CHOSEN'?'Ton passif est déjà choisi':'Ce passif ne fait pas partie de ton offre');
   this.db.prepare("UPDATE passive_offers SET status='REJECTED' WHERE lobby_id=? AND account_id=? AND generation=? AND status='OFFERED'").run(lobbyId,accountId,generation);
   this.grant(lobbyId,accountId,passiveId,'INITIAL_CHOICE',{actorId:accountId,announce:`✨ ${this.deps.domain.accounts.get(accountId)!.name} choisit « ${passive.name} » (${passiveRarityLabels[passive.rarity]})`});
  })();
  return this.owned(lobbyId,accountId).find(p=>p.passiveId===passiveId)!;
 }

 // Removes the initial choice of the current generation, if any (reset or cancel before the start).
 private dropInitialChoice(lobbyId:string,accountId:string,actorId:string){
  const chosen=this.offerRows(lobbyId,accountId).find(r=>r.status==='CHOSEN');
  if(chosen&&this.has(lobbyId,accountId,chosen.passive_id))this.revoke(lobbyId,accountId,chosen.passive_id,{actorId,reason:'choix initial annulé'});
 }

 /** Admin, before the start: cancels the current offer (and its choice) and draws a new one. */
 resetOffer(lobbyId:string,accountId:string,actorId:string):string[]{
  this.requirePhase(lobbyId,'SELECTION','Les offres ne se modifient qu’avant le départ de la course');
  const account=this.member(lobbyId,accountId);
  const offer=this.db.transaction(()=>{
   this.dropInitialChoice(lobbyId,accountId,actorId);
   this.db.prepare("UPDATE passive_offers SET status='CANCELLED' WHERE lobby_id=? AND account_id=? AND generation=?").run(lobbyId,accountId,this.generation(lobbyId,accountId));
   const cards=this.generateOffer(lobbyId,accountId);
   this.audit(lobbyId,{actorAccountId:actorId,targetAccountId:accountId,action:'passive.offer.reset',message:`Nouvelle offre de passifs pour ${account.name}`});
   return cards;
  })();
  this.deps.notify(lobbyId,{kind:'info',message:'🃏 Une nouvelle offre de passifs t’attend'},accountId);
  this.deps.changed(lobbyId);
  return offer;
 }

 /** Admin, before the start: the player chooses again among the same three cards. */
 cancelChoice(lobbyId:string,accountId:string,actorId:string){
  this.requirePhase(lobbyId,'SELECTION','Un choix ne s’annule qu’avant le départ de la course');
  const account=this.member(lobbyId,accountId);
  if(this.selectionState(lobbyId,accountId)!=='CHOSEN')throw new DomainError('CONFLICT',`${account.name} n’a pas encore choisi`);
  this.db.transaction(()=>{
   this.dropInitialChoice(lobbyId,accountId,actorId);
   this.db.prepare("UPDATE passive_offers SET status='OFFERED',chosen_at=NULL WHERE lobby_id=? AND account_id=? AND generation=?").run(lobbyId,accountId,this.generation(lobbyId,accountId));
   this.audit(lobbyId,{actorAccountId:actorId,targetAccountId:accountId,action:'passive.choice.cancel',message:`Choix de passif de ${account.name} annulé`});
  })();
  this.deps.changed(lobbyId);
 }

 /** Ends the selection and starts the race. Without force, every member must have chosen. */
 startRace(lobbyId:string,actorId:string,force=false){
  this.requirePhase(lobbyId,'SELECTION','Lancez d’abord la sélection des passifs');
  const {accounts,lobbies}=this.deps.domain;
  const waiting=lobbies.members(lobbyId).filter(m=>this.selectionState(lobbyId,m.accountId)!=='CHOSEN').map(m=>accounts.get(m.accountId)?.name??m.accountId);
  if(waiting.length&&!force)throw new DomainError('CONFLICT',`En attente du choix de : ${waiting.join(', ')}`,{waiting});
  this.db.transaction(()=>{
   this.saveSettings(lobbyId,{...this.settings(lobbyId),phase:'DONE'});
   if(lobbies.require(lobbyId).status==='OPEN')lobbies.setStatus(lobbyId,'RUNNING');
   this.audit(lobbyId,{actorAccountId:actorId,action:'passive.race.start',message:`Course lancée${waiting.length?` (sans choix : ${waiting.join(', ')})`:''}`});
  })();
  this.deps.notify(lobbyId,{kind:'success',message:'🏁 Les passifs sont choisis : la course est lancée !'});
  this.deps.changed(lobbyId);
 }

 private rewards(lobbyId:string):PassiveReward[]{
  return (this.db.prepare('SELECT * FROM passive_rewards WHERE lobby_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(lobbyId) as {id:string;account_id:string;passive_id:string;event_id:string;type:string;payload_json:string;status:PassiveRewardStatus;command_id:string|null;created_at:string;resolved_at:string|null}[])
   .map(r=>({id:r.id,accountId:r.account_id,passiveId:r.passive_id,eventId:r.event_id,type:r.type,payload:JSON.parse(r.payload_json),status:r.status,commandId:r.command_id,createdAt:r.created_at,resolvedAt:r.resolved_at}));
 }

 /** What a viewer may see: owned passives are public, offers only reach their own player, rewards only admins. */
 snapshot(lobbyId:string,viewerId:string):PassivesSnapshot{
  const {phase,weights}=this.settings(lobbyId);
  const viewer=this.deps.domain.accounts.get(viewerId);
  return {phase,catalogVersion:PASSIVE_CATALOG_VERSION,weights,catalog:this.catalog(lobbyId),owned:this.owned(lobbyId),
   selection:this.deps.domain.lobbies.members(lobbyId).map(m=>({accountId:m.accountId,status:this.selectionState(lobbyId,m.accountId)})),
   myOffer:phase==='SELECTION'?this.pendingOffer(lobbyId,viewerId):null,
   ...(viewer?.admin?{rewards:this.rewards(lobbyId)}:{})};
 }
}
