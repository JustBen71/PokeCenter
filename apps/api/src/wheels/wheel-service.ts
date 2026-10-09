import type Database from 'better-sqlite3';
import {randomInt,randomUUID} from 'node:crypto';
import {autoWheelSchema,applySchema,chooseGageSchema,gageHandlerInfo,gageNeedsTarget,spinSchema,wheelInputSchema,type Account,type AutoWheel,type Gage,type GageHandler,type LobbyNotification,type ResolutionStatus,type WheelInput,type WheelResolution,type WheelTone,type WheelType,type WheelsSnapshot} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import type {Services} from '../services.js';
import {wheelHandlers} from './wheel-handlers.js';

type WheelRow={id:string;name:string;description:string;price:number;icon:WheelType['icon'];tone:WheelTone;enabled:number;for_sale:number};
type BatchRow={id:string;lobby_id:string;wheel_type_id:string;launcher_account_id:string;status:string};
type GageRow={id:string;name:string;description:string;handler:GageHandler;params_json:string;weight:number};
type ResolutionRow={id:string;lobby_id:string;wheel_type_id:string;gage_json:string;owner_account_id:string;target_account_id:string|null;ticket_id:string|null;status:ResolutionStatus;strip_json:string;result:string|null;created_at:string;applied_at:string|null;options_json:string|null;chooser_account_id:string|null};

// Party changes need an explicit "not in battle" confirmation and a steal needs the passive to take:
// they always wait for the admin form.
const PARTY_HANDLERS:GageHandler[]=['REMOVE_POKEMON','GIVE_LIBRARY_POKEMON','PASSIVE_STEAL','POKEMON_TRANSFER','POKEMON_LEVEL','MAGIKARP_CURSE'];
const STRIP_LENGTH=30,WINNER_INDEX=26;

const defaults:WheelInput[]=[
 {name:'Bonne étoile',description:'Une roue bienveillante.',price:1000,icon:'green-1',tone:'GOOD',enabled:true,forSale:true,gages:[
  {name:'Petit bonus',description:'',handler:'GIVE_MONEY',params:{amount:500},weight:1},
  {name:'Gros lot',description:'',handler:'GIVE_MONEY',params:{amount:2000},weight:1},
  {name:'Part du jackpot',description:'',handler:'JACKPOT_PERCENT',params:{percent:10},weight:1},
  {name:'Pause bien méritée',description:'Rien ne se passe : profites-en pour souffler.',handler:'NOTICE',params:{},weight:1}]},
 {name:'Coup bas',description:'Une roue hostile à lancer sur un adversaire.',price:1500,icon:'purple-1',tone:'BAD',enabled:true,forSale:true,gages:[
  {name:'Amende',description:'',handler:'TAKE_MONEY',params:{amount:500},weight:1},
  {name:'Braquage',description:'',handler:'STEAL_MONEY',params:{amount:1000},weight:1},
  {name:'Exil',description:'Un Pokémon au hasard quitte l’équipe.',handler:'REMOVE_POKEMON',params:{selector:'random'},weight:1},
  {name:'Karaoké',description:'La cible chante le générique Pokémon en vocal.',handler:'NOTICE',params:{},weight:1}]}
];

/**
 * Wheels and their gages. The server draws the gage (weights) before any animation and stores it with the strip
 * the browsers will scroll; applying it runs one tested handler. Unknown outcomes stay in REVIEW.
 */
export class WheelService{
 private services!:Services;
 private readonly spinAllQueue=new Map<string,Promise<void>>();
 // Hook for protections (Sprint 8): may block a hostile wheel before it is drawn.
 beforeSpin:(input:{lobbyId:string;wheel:WheelType;owner:Account;target:Account|null;ticketId:string|null;ticketReceivedAt:string|null})=>string|null=()=>null;
 // spinAllSpacingMs: time between two players' spins of « Lancer à tous » (each animation is seen); tests use 0.
 constructor(private readonly deps:{db:Database.Database;notify:(lobbyId:string,n:LobbyNotification)=>void;changed:(lobbyId:string)=>void;spun:(lobbyId:string,r:WheelResolution)=>void;spinAllSpacingMs?:number}){}
 attach(services:Services){this.services=services;}

 seed(lobbyId:string){
  if(this.deps.db.prepare('SELECT 1 FROM wheel_types WHERE lobby_id=? LIMIT 1').get(lobbyId))return;
  for(const wheel of defaults)this.write(lobbyId,null,wheel);
 }

 private gages(wheelId:string):Gage[]{
  return (this.deps.db.prepare('SELECT * FROM wheel_gages WHERE wheel_type_id=? ORDER BY sort_order').all(wheelId) as GageRow[])
   .map(g=>({id:g.id,name:g.name,description:g.description,handler:g.handler,params:JSON.parse(g.params_json),weight:g.weight,requiresTarget:gageNeedsTarget(g.handler,JSON.parse(g.params_json))}));
 }
 list(lobbyId:string,includeDisabled=true):WheelType[]{
  return (this.deps.db.prepare(`SELECT * FROM wheel_types WHERE lobby_id=? AND deleted=0 ${includeDisabled?'':'AND enabled=1'} ORDER BY created_at,rowid`).all(lobbyId) as WheelRow[])
   .map(w=>({id:w.id,name:w.name,description:w.description,price:w.price,icon:w.icon,tone:w.tone,enabled:w.enabled===1,forSale:w.for_sale===1,gages:this.gages(w.id)}));
 }
 require(lobbyId:string,wheelId:string){const wheel=this.list(lobbyId).find(w=>w.id===wheelId);if(!wheel)throw new DomainError('NOT_FOUND','Roue introuvable');return wheel;}

 private write(lobbyId:string,wheelId:string|null,input:WheelInput):WheelType{
  const id=wheelId??randomUUID(),now=nowIso();
  this.deps.db.transaction(()=>{
   if(wheelId)this.deps.db.prepare('UPDATE wheel_types SET name=?,description=?,price=?,icon=?,tone=?,enabled=?,for_sale=?,updated_at=? WHERE id=?').run(input.name,input.description,input.price,input.icon,input.tone,input.enabled?1:0,input.forSale?1:0,now,id);
   else this.deps.db.prepare('INSERT INTO wheel_types(id,lobby_id,name,description,price,icon,tone,enabled,for_sale,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,lobbyId,input.name,input.description,input.price,input.icon,input.tone,input.enabled?1:0,input.forSale?1:0,now,now);
   // Past resolutions keep their own copy of the gage, so gages can be replaced freely.
   this.deps.db.prepare('DELETE FROM wheel_gages WHERE wheel_type_id=?').run(id);
   const insert=this.deps.db.prepare('INSERT INTO wheel_gages(id,wheel_type_id,name,description,handler,params_json,weight,sort_order) VALUES(?,?,?,?,?,?,?,?)');
   input.gages.forEach((g,i)=>insert.run(randomUUID(),id,g.name,g.description,g.handler,JSON.stringify(g.params),g.weight,i));
  })();
  this.deps.changed(lobbyId);
  return this.require(lobbyId,id);
 }
 create(lobbyId:string,body:unknown,actor:Account){const w=this.write(lobbyId,null,parseBody(wheelInputSchema,body));this.audit(lobbyId,actor,'wheel.create',`Roue « ${w.name} » créée`);return w;}
 update(lobbyId:string,wheelId:string,body:unknown,actor:Account){this.require(lobbyId,wheelId);const w=this.write(lobbyId,wheelId,parseBody(wheelInputSchema,body));this.audit(lobbyId,actor,'wheel.update',`Roue « ${w.name} » modifiée`);return w;}
 delete(lobbyId:string,wheelId:string,actor:Account){
  const w=this.require(lobbyId,wheelId);
  this.deps.db.prepare('UPDATE wheel_types SET deleted=1,enabled=0,updated_at=? WHERE id=?').run(nowIso(),wheelId);
  this.audit(lobbyId,actor,'wheel.delete',`Roue « ${w.name} » supprimée`);this.deps.changed(lobbyId);
 }
 /**
  * « Lancer à tous » : one spin per player in a Run (the player owns it; for a hostile wheel the player is also its
  * target), spaced so each animation is seen. An immediate gage is applied by the launcher; a gage needing a choice
  * (target, Pokémon, passive) waits in « Derniers tirages » for an admin. `actor` null = the automatic wheel,
  * applied as the lobby creator.
  */
 spinAll(lobbyId:string,wheelId:string,actor:Account|null):{players:number}{
  const wheel=this.require(lobbyId,wheelId);
  if(!wheel.enabled)throw new DomainError('CONFLICT','Cette roue est désactivée');
  const {lobbies,runs,accounts}=this.services.domain;
  const players=lobbies.members(lobbyId).filter(m=>runs.running(lobbyId,m.accountId)).map(m=>m.accountId);
  if(!players.length)throw new DomainError('CONFLICT','Aucun joueur n’a de Run en cours');
  const launcher=actor??accounts.get(lobbies.require(lobbyId).createdBy??'')??lobbies.members(lobbyId).map(m=>accounts.get(m.accountId)).find(a=>a?.admin);
  if(!launcher)throw new DomainError('CONFLICT','Aucun administrateur pour appliquer les gages');
  this.services.domain.audit.record({lobbyId,actorAccountId:actor?.id??null,category:'WHEEL',action:'wheel.spin_all',status:'SUCCESS',
   message:`${wheel.name} lancée pour tous les joueurs en Run (${players.length})${actor?'':' — roue automatique'}`,metadata:{wheelId,players}});
  this.deps.notify(lobbyId,{kind:'info',message:`🎡 ${wheel.name} : une roue pour chaque joueur (${players.length})${actor?'':' — roue automatique'}`});
  // Persisted first: the batch survives a restart, each player gets this wheel once (primary key + unique resolution).
  const batchId=randomUUID(),now=nowIso(),db=this.deps.db;
  db.transaction(()=>{
   db.prepare("INSERT INTO wheel_batches(id,lobby_id,wheel_type_id,created_by,launcher_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'PENDING',?,?)").run(batchId,lobbyId,wheel.id,actor?.id??null,launcher.id,now,now);
   const item=db.prepare("INSERT INTO wheel_batch_items(batch_id,account_id,position,status,updated_at) VALUES(?,?,?,'PENDING',?)");
   players.forEach((player,i)=>item.run(batchId,player,i,now));
  })();
  this.runBatches(lobbyId);
  return {players:players.length};
 }

 /**
  * One loop per lobby (spinAllQueue) runs its unfinished batches in creation order: two « Lancer à tous » (or the
  * automatic wheel) never interleave. The database is the source of truth: after a restart, resumeBatches() starts
  * the loop again and only the items not DONE/FAILED are processed.
  */
 private runBatches(lobbyId:string){
  if(this.spinAllQueue.has(lobbyId))return;
  const spacing=this.deps.spinAllSpacingMs??7000,wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const nextBatch=()=>this.deps.db.prepare("SELECT * FROM wheel_batches WHERE lobby_id=? AND status IN ('PENDING','PROCESSING') ORDER BY created_at,rowid LIMIT 1").get(lobbyId) as BatchRow|undefined;
  const loop=(async()=>{
   for(let batch=nextBatch(),first=true;batch;batch=nextBatch(),first=false){
    if(!first)await wait(spacing);
    await this.processBatch(batch,spacing,wait);
   }
  })();
  this.spinAllQueue.set(lobbyId,loop);
  void loop.catch(error=>console.error('Lancer à tous:',error)).finally(()=>{
   this.spinAllQueue.delete(lobbyId);
   if(nextBatch())this.runBatches(lobbyId);
  });
 }
 private async processBatch(batch:BatchRow,spacing:number,wait:(ms:number)=>Promise<unknown>){
  const db=this.deps.db,lobbyId=batch.lobby_id;
  const mark=(status:string)=>db.prepare('UPDATE wheel_batches SET status=?,updated_at=? WHERE id=?').run(status,nowIso(),batch.id);
  const item=(account:string,status:string,resolutionId:string|null,error:string|null=null)=>
   db.prepare('UPDATE wheel_batch_items SET status=?,resolution_id=COALESCE(?,resolution_id),error_code=?,updated_at=? WHERE batch_id=? AND account_id=?').run(status,resolutionId,error,nowIso(),batch.id,account);
  mark('PROCESSING');
  const items=db.prepare("SELECT account_id AS accountId FROM wheel_batch_items WHERE batch_id=? AND status IN ('PENDING','PROCESSING') ORDER BY position").all(batch.id) as {accountId:string}[];
  const launcher=this.services.domain.accounts.get(batch.launcher_account_id);
  for(const [i,{accountId}] of items.entries()){
   if(i)await wait(spacing);
   item(accountId,'PROCESSING',null);
   try{
    if(!launcher)throw new DomainError('CONFLICT','Lanceur introuvable');
    // Drawn before a restart (the item was not updated yet): never drawn again.
    const drawn=db.prepare('SELECT id FROM wheel_resolutions WHERE batch_id=? AND owner_account_id=?').get(batch.id,accountId) as {id:string}|undefined;
    const tone=this.list(lobbyId).find(w=>w.id===batch.wheel_type_id)?.tone;
    const r=drawn?this.resolution(lobbyId,drawn.id):this.spin(lobbyId,batch.wheel_type_id,{ownerId:accountId,...(tone==='BAD'?{targetId:accountId}:{})},launcher,null,null,batch.id);
    item(accountId,'PROCESSING',r.id);
    // The result is announced after the animation (about 3 s in the browser). apply() claims DRAWN once: never applied twice.
    if(r.status==='DRAWN'){await wait(spacing/2);await this.apply(lobbyId,r.id,{},launcher).catch(()=>{});}
    item(accountId,'DONE',null);
   }catch(error){
    // Audited by spin/apply; the other players still get their wheel.
    item(accountId,'FAILED',null,error instanceof DomainError?error.code:'INTERNAL_ERROR');
   }
  }
  const failed=(db.prepare("SELECT COUNT(*) AS n FROM wheel_batch_items WHERE batch_id=? AND status='FAILED'").get(batch.id) as {n:number}).n;
  mark(failed?'FAILED':'DONE');
 }
 /** After a restart (and at each automatic-wheel tick): lobbies with an unfinished batch and no running loop. */
 resumeBatches(){
  const lobbies=this.deps.db.prepare("SELECT DISTINCT lobby_id AS id FROM wheel_batches WHERE status IN ('PENDING','PROCESSING')").all() as {id:string}[];
  for(const {id} of lobbies)this.runBatches(id);
 }

 autoWheel(lobbyId:string):AutoWheel{
  const row=this.deps.db.prepare('SELECT wheel_type_id AS wheelId,every_minutes AS everyMinutes,last_at AS lastAt FROM auto_wheels WHERE lobby_id=?').get(lobbyId) as {wheelId:string|null;everyMinutes:number;lastAt:string|null}|undefined;
  if(!row)return {wheelId:null,everyMinutes:0,nextAt:null};
  const on=row.wheelId&&row.everyMinutes>0&&row.lastAt;
  return {wheelId:row.wheelId,everyMinutes:row.everyMinutes,nextAt:on?new Date(Date.parse(row.lastAt!)+row.everyMinutes*60000).toISOString():null};
 }
 /** The countdown starts when the setting is saved. */
 setAutoWheel(lobbyId:string,body:unknown,actor:Account):AutoWheel{
  const {wheelId,everyMinutes}=parseBody(autoWheelSchema,body);
  if(wheelId&&!this.require(lobbyId,wheelId).enabled)throw new DomainError('CONFLICT','Cette roue est désactivée');
  const now=nowIso();
  this.deps.db.prepare(`INSERT INTO auto_wheels(lobby_id,wheel_type_id,every_minutes,last_at,updated_at) VALUES(?,?,?,?,?)
   ON CONFLICT(lobby_id) DO UPDATE SET wheel_type_id=excluded.wheel_type_id,every_minutes=excluded.every_minutes,last_at=excluded.last_at,updated_at=excluded.updated_at`).run(lobbyId,wheelId,everyMinutes,now,now);
  const wheel=wheelId?this.require(lobbyId,wheelId).name:null;
  this.audit(lobbyId,actor,'wheel.auto',wheel&&everyMinutes?`Roue automatique : « ${wheel} » toutes les ${everyMinutes} min`:'Roue automatique désactivée');
  this.deps.changed(lobbyId);
  return this.autoWheel(lobbyId);
 }
 /** Called periodically: each lobby whose automatic wheel is due spins it for everyone (once per period, even after a restart). */
 tickAutoWheels(now=Date.now()){
  this.resumeBatches();
  const due=this.deps.db.prepare("SELECT a.lobby_id AS lobbyId,a.wheel_type_id AS wheelId,a.every_minutes AS every,a.last_at AS lastAt FROM auto_wheels a JOIN lobbies l ON l.id=a.lobby_id WHERE a.every_minutes>0 AND a.wheel_type_id IS NOT NULL").all() as {lobbyId:string;wheelId:string;every:number;lastAt:string|null}[];
  for(const a of due){
   if(a.lastAt&&now-Date.parse(a.lastAt)<a.every*60000)continue;
   // Claimed first: a second tick, or a failure below, never spins it twice for the same period.
   this.deps.db.prepare('UPDATE auto_wheels SET last_at=? WHERE lobby_id=?').run(new Date(now).toISOString(),a.lobbyId);
   this.deps.changed(a.lobbyId);
   try{this.spinAll(a.lobbyId,a.wheelId,null);}
   catch(error){this.services.domain.audit.record({lobbyId:a.lobbyId,category:'WHEEL',action:'wheel.auto',status:'FAILED',errorCode:error instanceof DomainError?error.code:'INTERNAL_ERROR',message:`Roue automatique non lancée : ${error instanceof Error?error.message:String(error)}`});}
  }
 }

 private audit(lobbyId:string,actor:Account,action:string,message:string){this.services.domain.audit.record({lobbyId,actorAccountId:actor.id,category:'WHEEL',action,status:'SUCCESS',message});}

 private toResolution(r:ResolutionRow):WheelResolution{
  const wheel=this.deps.db.prepare('SELECT name,tone FROM wheel_types WHERE id=?').get(r.wheel_type_id) as {name:string;tone:WheelTone};
  return {id:r.id,wheelId:r.wheel_type_id,wheelName:wheel.name,tone:wheel.tone,gage:JSON.parse(r.gage_json),ownerId:r.owner_account_id,targetId:r.target_account_id,ticketId:r.ticket_id,
   status:r.status,strip:JSON.parse(r.strip_json),result:r.result,createdAt:r.created_at,appliedAt:r.applied_at,
   options:r.options_json?JSON.parse(r.options_json):null,chooserId:r.options_json?r.chooser_account_id:null};
 }
 resolution(lobbyId:string,id:string){
  const row=this.deps.db.prepare('SELECT * FROM wheel_resolutions WHERE id=? AND lobby_id=?').get(id,lobbyId) as ResolutionRow|undefined;
  if(!row)throw new DomainError('NOT_FOUND','Tirage introuvable');
  return this.toResolution(row);
 }
 snapshot(lobbyId:string):WheelsSnapshot{
  const rows=this.deps.db.prepare('SELECT * FROM wheel_resolutions WHERE lobby_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').all(lobbyId) as ResolutionRow[];
  return {wheels:this.list(lobbyId),resolutions:rows.map(r=>this.toResolution(r)),auto:this.autoWheel(lobbyId)};
 }

 private member(lobbyId:string,accountId:string|undefined,label:string){
  if(!accountId)return null;
  const account=this.services.domain.accounts.get(accountId);
  if(!account||!this.services.domain.lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER',`${label} ne participe pas à ce lobby`);
  return account;
 }

 /** Draws the gage now (weighted), stores it, then every dashboard plays the same animation. */
 spin(lobbyId:string,wheelId:string,body:unknown,actor:Account|null,ticketId:string|null=null,ticketReceivedAt:string|null=null,batchId:string|null=null):WheelResolution{
  const {ownerId,targetId}=parseBody(spinSchema,body);
  const wheel=this.require(lobbyId,wheelId);
  if(!wheel.enabled)throw new DomainError('CONFLICT','Cette roue est désactivée');
  const owner=this.member(lobbyId,ownerId,'Le bénéficiaire')!,target=this.member(lobbyId,targetId,'La cible');
  const blocked=this.beforeSpin({lobbyId,wheel,owner,target,ticketId,ticketReceivedAt});
  // The target's passives may remove gages before the weighted draw (Contre-sort); the animation keeps every name.
  const gages=wheel.tone==='BAD'&&target&&!blocked?this.services.passiveEngine.filterHostileGages(lobbyId,target.id,wheel.gages):wheel.gages;
  // A passive may turn the draw into a choice (Sixième sens for the owner of a kind wheel, Maître du chaos for the
  // target of a hostile one): N different gages drawn by weight, the chooser picks one before anything applies.
  const choice=blocked?null:this.services.passiveEngine.wheelChoice(lobbyId,{tone:wheel.tone,ownerId:owner.id,targetId:target?.id??null,gageCount:gages.length});
  const pool=[...gages],drawn:Gage[]=[],count=choice?Math.min(choice.count,pool.length):1;
  for(let i=0;i<count;i++){
   let roll=randomInt(pool.reduce((n,g)=>n+g.weight,0));const picked=pool.find(g=>(roll-=g.weight)<0)!;
   drawn.push(picked);pool.splice(pool.indexOf(picked),1);
  }
  const gage=drawn[0],options=choice?drawn:null;
  const strip=Array.from({length:STRIP_LENGTH},(_,i)=>i===WINNER_INDEX?(options?options.map(g=>g.name).join(' / '):gage.name):wheel.gages[randomInt(wheel.gages.length)].name);
  const status:ResolutionStatus=blocked?'BLOCKED':options||(gage.requiresTarget&&!target)||PARTY_HANDLERS.includes(gage.handler)?'AWAITING_CHOICE':'DRAWN';
  const id=randomUUID();
  this.deps.db.prepare(`INSERT INTO wheel_resolutions(id,lobby_id,wheel_type_id,gage_json,owner_account_id,target_account_id,ticket_id,status,strip_json,result,created_by,created_at,applied_at,options_json,chooser_account_id,batch_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .run(id,lobbyId,wheel.id,JSON.stringify(gage),owner.id,target?.id??null,ticketId,status,JSON.stringify(strip),blocked,actor?.id??null,nowIso(),blocked?nowIso():null,options?JSON.stringify(options):null,choice?.chooserId??null,batchId);
  this.services.domain.audit.record({lobbyId,actorAccountId:actor?.id??null,targetAccountId:target?.id??owner.id,category:'WHEEL',action:'wheel.spin',status:blocked?'INFO':'SUCCESS',
   message:blocked??`${wheel.name} : « ${gage.name} » tiré pour ${owner.name}${target?` (cible ${target.name})`:''}`,metadata:{resolutionId:id,gage:gage.name,handler:gage.handler}});
  if(target&&!blocked&&!options)this.suffered(lobbyId,id,wheel.tone,gage,target.id);
  const resolution=this.resolution(lobbyId,id);
  this.deps.spun(lobbyId,resolution);this.deps.changed(lobbyId);
  return resolution;
 }
 // Passive event: the target suffered this gage (same id at draw and at apply, processed once).
 private suffered(lobbyId:string,resolutionId:string,tone:WheelTone,gage:Gage,targetId:string){
  this.services.passiveEngine.emit({lobbyId,accountId:targetId,id:`wheel:${resolutionId}`,type:'WHEEL_RESOLVED',data:{resolutionId,tone,gageId:gage.id,gageName:gage.name,role:'target'}});
 }

 /** Applies the drawn gage once. A refusal leaves it pending (retry or abandon); an unknown outcome goes to REVIEW. */
 async apply(lobbyId:string,id:string,body:unknown,actor:Account):Promise<WheelResolution>{
  const choice=parseBody(applySchema,body);
  const before=this.resolution(lobbyId,id);
  // The beneficiary chooses the target of his own draw; party changes (out-of-battle confirmation) stay with an admin.
  if(!actor.admin&&(actor.id!==before.ownerId||PARTY_HANDLERS.includes(before.gage.handler)))throw new DomainError('ADMIN_REQUIRED','Ce gage est appliqué par un administrateur');
  if(before.options)throw new DomainError('CONFLICT',`En attente du choix de ${this.services.domain.accounts.get(before.chooserId??'')?.name??'joueur'} parmi ${before.options.length} gages`);
  const target=choice.targetId?this.member(lobbyId,choice.targetId,'La cible'):before.targetId?this.services.domain.accounts.get(before.targetId)!:null;
  if(before.gage.requiresTarget&&!target)throw new DomainError('VALIDATION_FAILED','Choisissez la cible du gage');
  const claimed=this.deps.db.prepare("UPDATE wheel_resolutions SET status='APPLYING',target_account_id=? WHERE id=? AND status IN ('DRAWN','AWAITING_CHOICE')").run(target?.id??null,id).changes;
  if(!claimed)throw new DomainError('CONFLICT','Ce gage a déjà été appliqué ou est en cours');
  this.deps.changed(lobbyId);
  const owner=this.services.domain.accounts.get(before.ownerId)!;
  const finish=(status:ResolutionStatus,result:string|null)=>{
   this.deps.db.prepare('UPDATE wheel_resolutions SET status=?,result=?,applied_at=? WHERE id=?').run(status,result,['SUCCESS','FAILED','REVIEW'].includes(status)?nowIso():null,id);
   this.deps.changed(lobbyId);
  };
  try{
   // A hostile wheel hits its target: a gage without a target (battle, level ±, items…) applies to the victim, never to the sender.
   const subject=before.tone==='BAD'&&target&&!before.gage.requiresTarget?target:owner;
   const message=await wheelHandlers[before.gage.handler]({lobbyId,resolutionId:id,actorId:actor.id,gage:before.gage,owner:subject,target,choice,services:this.services});
   finish('SUCCESS',message);
   if(target)this.suffered(lobbyId,id,before.tone,before.gage,target.id);
   this.services.domain.audit.record({lobbyId,actorAccountId:actor.id,targetAccountId:target?.id??owner.id,category:'WHEEL',action:'wheel.apply',status:'SUCCESS',message,metadata:{resolutionId:id}});
   this.deps.notify(lobbyId,{kind:'success',message:`✔ ${before.gage.name} — ${message}`});
  }catch(error){
   const domain=error instanceof DomainError?error:new DomainError('INTERNAL_ERROR','Erreur interne pendant le gage');
   if(domain.code==='COMMAND_OUTCOME_UNKNOWN')finish('REVIEW',domain.message);
   else finish(before.status,null);
   this.services.domain.audit.record({lobbyId,actorAccountId:actor.id,targetAccountId:target?.id??owner.id,category:'WHEEL',action:'wheel.apply',status:domain.code==='COMMAND_OUTCOME_UNKNOWN'?'REVIEW':'FAILED',errorCode:domain.code,message:domain.message,metadata:{resolutionId:id}});
   this.deps.notify(lobbyId,{kind:'error',message:`✖ ${before.gage.name} — ${domain.message}`});
   throw domain;
  }
  return this.resolution(lobbyId,id);
 }

 /** The chooser (or an admin) picks the gage that will really apply; the draw then follows its normal course. */
 choose(lobbyId:string,id:string,body:unknown,actor:Account):WheelResolution{
  const {gageId}=parseBody(chooseGageSchema,body);
  const r=this.resolution(lobbyId,id);
  if(!r.options)throw new DomainError('CONFLICT','Ce tirage n’attend aucun choix');
  if(actor.id!==r.chooserId&&!actor.admin)throw new DomainError('FORBIDDEN','Ce choix revient à un autre joueur');
  const gage=r.options.find(g=>g.id===gageId);
  if(!gage)throw new DomainError('VALIDATION_FAILED','Ce gage ne fait pas partie du choix');
  const status:ResolutionStatus=(gage.requiresTarget&&!r.targetId)||PARTY_HANDLERS.includes(gage.handler)?'AWAITING_CHOICE':'DRAWN';
  const changed=this.deps.db.prepare("UPDATE wheel_resolutions SET gage_json=?,options_json=NULL,status=? WHERE id=? AND options_json IS NOT NULL AND status='AWAITING_CHOICE'").run(JSON.stringify(gage),status,id).changes;
  if(!changed)throw new DomainError('CONFLICT','Le choix a déjà été fait');
  this.services.domain.audit.record({lobbyId,actorAccountId:actor.id,targetAccountId:r.chooserId,category:'WHEEL',action:'wheel.choose',status:'SUCCESS',
   message:`${actor.name} choisit « ${gage.name} » parmi ${r.options.map(g=>`« ${g.name} »`).join(', ')}`,metadata:{resolutionId:id}});
  if(r.targetId)this.suffered(lobbyId,id,r.tone,gage,r.targetId);
  this.deps.notify(lobbyId,{kind:'info',message:`🎲 ${this.services.domain.accounts.get(r.chooserId??'')?.name??actor.name} choisit « ${gage.name} »`});
  this.deps.changed(lobbyId);
  return this.resolution(lobbyId,id);
 }

 // Admin closes a pending or REVIEW gage after checking the games (abandon = FAILED, nothing more is attempted).
 close(lobbyId:string,id:string,status:'SUCCESS'|'FAILED',actor:Account,note?:string){
  const r=this.resolution(lobbyId,id);
  if(!['DRAWN','AWAITING_CHOICE','REVIEW'].includes(r.status))throw new DomainError('CONFLICT','Ce gage est déjà terminé');
  this.deps.db.prepare('UPDATE wheel_resolutions SET status=?,result=?,applied_at=? WHERE id=?').run(status,note??(status==='SUCCESS'?'Validé manuellement':'Abandonné'),nowIso(),id);
  this.services.domain.audit.record({lobbyId,actorAccountId:actor.id,category:'WHEEL',action:'wheel.close',status:status==='SUCCESS'?'SUCCESS':'FAILED',message:`Gage « ${r.gage.name} » clôturé manuellement`,metadata:{resolutionId:id}});
  this.deps.changed(lobbyId);
  return this.resolution(lobbyId,id);
 }
}
