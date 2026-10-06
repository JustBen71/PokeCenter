import type Database from 'better-sqlite3';
import {randomInt,randomUUID} from 'node:crypto';
import {applySchema,gageHandlerInfo,spinSchema,wheelInputSchema,type Account,type Gage,type GageHandler,type LobbyNotification,type ResolutionStatus,type WheelInput,type WheelResolution,type WheelTone,type WheelType,type WheelsSnapshot} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import type {Services} from '../services.js';
import {wheelHandlers} from './wheel-handlers.js';

type WheelRow={id:string;name:string;description:string;price:number;icon:WheelType['icon'];tone:WheelTone;enabled:number};
type GageRow={id:string;name:string;description:string;handler:GageHandler;params_json:string;weight:number};
type ResolutionRow={id:string;lobby_id:string;wheel_type_id:string;gage_json:string;owner_account_id:string;target_account_id:string|null;ticket_id:string|null;status:ResolutionStatus;strip_json:string;result:string|null;created_at:string;applied_at:string|null};

// Party changes need an explicit "not in battle" confirmation and a steal needs the passive to take:
// they always wait for the admin form.
const PARTY_HANDLERS:GageHandler[]=['REMOVE_POKEMON','GIVE_LIBRARY_POKEMON','PASSIVE_STEAL'];
const STRIP_LENGTH=30,WINNER_INDEX=26;

const defaults:WheelInput[]=[
 {name:'Bonne étoile',description:'Une roue bienveillante.',price:1000,icon:'green-1',tone:'GOOD',enabled:true,gages:[
  {name:'Petit bonus',description:'',handler:'GIVE_MONEY',params:{amount:500},weight:1},
  {name:'Gros lot',description:'',handler:'GIVE_MONEY',params:{amount:2000},weight:1},
  {name:'Part du jackpot',description:'',handler:'JACKPOT_PERCENT',params:{percent:10},weight:1},
  {name:'Pause bien méritée',description:'Rien ne se passe : profites-en pour souffler.',handler:'NOTICE',params:{},weight:1}]},
 {name:'Coup bas',description:'Une roue hostile à lancer sur un adversaire.',price:1500,icon:'purple-1',tone:'BAD',enabled:true,gages:[
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
 // Hook for protections (Sprint 8): may block a hostile wheel before it is drawn.
 beforeSpin:(input:{lobbyId:string;wheel:WheelType;owner:Account;target:Account|null;ticketId:string|null;ticketReceivedAt:string|null})=>string|null=()=>null;
 constructor(private readonly deps:{db:Database.Database;notify:(lobbyId:string,n:LobbyNotification)=>void;changed:(lobbyId:string)=>void;spun:(lobbyId:string,r:WheelResolution)=>void}){}
 attach(services:Services){this.services=services;}

 seed(lobbyId:string){
  if(this.deps.db.prepare('SELECT 1 FROM wheel_types WHERE lobby_id=? LIMIT 1').get(lobbyId))return;
  for(const wheel of defaults)this.write(lobbyId,null,wheel);
 }

 private gages(wheelId:string):Gage[]{
  return (this.deps.db.prepare('SELECT * FROM wheel_gages WHERE wheel_type_id=? ORDER BY sort_order').all(wheelId) as GageRow[])
   .map(g=>({id:g.id,name:g.name,description:g.description,handler:g.handler,params:JSON.parse(g.params_json),weight:g.weight,requiresTarget:gageHandlerInfo[g.handler].target==='required'}));
 }
 list(lobbyId:string,includeDisabled=true):WheelType[]{
  return (this.deps.db.prepare(`SELECT * FROM wheel_types WHERE lobby_id=? AND deleted=0 ${includeDisabled?'':'AND enabled=1'} ORDER BY created_at,rowid`).all(lobbyId) as WheelRow[])
   .map(w=>({id:w.id,name:w.name,description:w.description,price:w.price,icon:w.icon,tone:w.tone,enabled:w.enabled===1,gages:this.gages(w.id)}));
 }
 require(lobbyId:string,wheelId:string){const wheel=this.list(lobbyId).find(w=>w.id===wheelId);if(!wheel)throw new DomainError('NOT_FOUND','Roue introuvable');return wheel;}

 private write(lobbyId:string,wheelId:string|null,input:WheelInput):WheelType{
  const id=wheelId??randomUUID(),now=nowIso();
  this.deps.db.transaction(()=>{
   if(wheelId)this.deps.db.prepare('UPDATE wheel_types SET name=?,description=?,price=?,icon=?,tone=?,enabled=?,updated_at=? WHERE id=?').run(input.name,input.description,input.price,input.icon,input.tone,input.enabled?1:0,now,id);
   else this.deps.db.prepare('INSERT INTO wheel_types(id,lobby_id,name,description,price,icon,tone,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,lobbyId,input.name,input.description,input.price,input.icon,input.tone,input.enabled?1:0,now,now);
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
 private audit(lobbyId:string,actor:Account,action:string,message:string){this.services.domain.audit.record({lobbyId,actorAccountId:actor.id,category:'WHEEL',action,status:'SUCCESS',message});}

 private toResolution(r:ResolutionRow):WheelResolution{
  const wheel=this.deps.db.prepare('SELECT name,tone FROM wheel_types WHERE id=?').get(r.wheel_type_id) as {name:string;tone:WheelTone};
  return {id:r.id,wheelId:r.wheel_type_id,wheelName:wheel.name,tone:wheel.tone,gage:JSON.parse(r.gage_json),ownerId:r.owner_account_id,targetId:r.target_account_id,ticketId:r.ticket_id,
   status:r.status,strip:JSON.parse(r.strip_json),result:r.result,createdAt:r.created_at,appliedAt:r.applied_at};
 }
 resolution(lobbyId:string,id:string){
  const row=this.deps.db.prepare('SELECT * FROM wheel_resolutions WHERE id=? AND lobby_id=?').get(id,lobbyId) as ResolutionRow|undefined;
  if(!row)throw new DomainError('NOT_FOUND','Tirage introuvable');
  return this.toResolution(row);
 }
 snapshot(lobbyId:string):WheelsSnapshot{
  const rows=this.deps.db.prepare('SELECT * FROM wheel_resolutions WHERE lobby_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').all(lobbyId) as ResolutionRow[];
  return {wheels:this.list(lobbyId),resolutions:rows.map(r=>this.toResolution(r))};
 }

 private member(lobbyId:string,accountId:string|undefined,label:string){
  if(!accountId)return null;
  const account=this.services.domain.accounts.get(accountId);
  if(!account||!this.services.domain.lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER',`${label} ne participe pas à ce lobby`);
  return account;
 }

 /** Draws the gage now (weighted), stores it, then every dashboard plays the same animation. */
 spin(lobbyId:string,wheelId:string,body:unknown,actor:Account|null,ticketId:string|null=null,ticketReceivedAt:string|null=null):WheelResolution{
  const {ownerId,targetId}=parseBody(spinSchema,body);
  const wheel=this.require(lobbyId,wheelId);
  if(!wheel.enabled)throw new DomainError('CONFLICT','Cette roue est désactivée');
  const owner=this.member(lobbyId,ownerId,'Le bénéficiaire')!,target=this.member(lobbyId,targetId,'La cible');
  const blocked=this.beforeSpin({lobbyId,wheel,owner,target,ticketId,ticketReceivedAt});
  // The target's passives may remove gages before the weighted draw (Contre-sort); the animation keeps every name.
  const gages=wheel.tone==='BAD'&&target&&!blocked?this.services.passiveEngine.filterHostileGages(lobbyId,target.id,wheel.gages):wheel.gages;
  const total=gages.reduce((n,g)=>n+g.weight,0);
  let roll=randomInt(total);const gage=gages.find(g=>(roll-=g.weight)<0)!;
  const strip=Array.from({length:STRIP_LENGTH},(_,i)=>i===WINNER_INDEX?gage.name:wheel.gages[randomInt(wheel.gages.length)].name);
  const status:ResolutionStatus=blocked?'BLOCKED':(gage.requiresTarget&&!target)||PARTY_HANDLERS.includes(gage.handler)?'AWAITING_CHOICE':'DRAWN';
  const id=randomUUID();
  this.deps.db.prepare(`INSERT INTO wheel_resolutions(id,lobby_id,wheel_type_id,gage_json,owner_account_id,target_account_id,ticket_id,status,strip_json,result,created_by,created_at,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .run(id,lobbyId,wheel.id,JSON.stringify(gage),owner.id,target?.id??null,ticketId,status,JSON.stringify(strip),blocked,actor?.id??null,nowIso(),blocked?nowIso():null);
  this.services.domain.audit.record({lobbyId,actorAccountId:actor?.id??null,targetAccountId:target?.id??owner.id,category:'WHEEL',action:'wheel.spin',status:blocked?'INFO':'SUCCESS',
   message:blocked??`${wheel.name} : « ${gage.name} » tiré pour ${owner.name}${target?` (cible ${target.name})`:''}`,metadata:{resolutionId:id,gage:gage.name,handler:gage.handler}});
  if(target&&!blocked)this.suffered(lobbyId,id,wheel.tone,gage,target.id);
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
   const message=await wheelHandlers[before.gage.handler]({lobbyId,resolutionId:id,actorId:actor.id,gage:before.gage,owner,target,choice,services:this.services});
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
