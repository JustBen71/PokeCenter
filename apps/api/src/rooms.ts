import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {registerAccounts} from './accounts.js';
import {accountKey,type Lobby} from '@pokerace/shared';
import {Server} from 'node:http';
import {createApp,type Config} from './app.js';
import {Store} from './store.js';
import {createServices} from './services.js';
import {registerGameRoutes} from './game/game-routes.js';
import {registerObjectiveRoutes} from './objectives/objective-routes.js';
import {registerBankRoutes} from './money/bank-routes.js';
import {registerAuctionRoutes} from './auctions/auction-routes.js';
import {registerWheelRoutes} from './wheels/wheel-routes.js';
import {registerShopRoutes} from './shop/shop-routes.js';
import {registerAuditRoutes} from './audit/audit-routes.js';
import {setErrorAuditor} from './errors.js';
import {registerLobbyRoutes,lobbySummary} from './lobbies/lobby-routes.js';
import {registerRunRoutes} from './runs/run-routes.js';
import {registerPassiveRoutes} from './passives/passive-routes.js';
import {registerBattleRoutes} from './battles/battle-routes.js';
import {LobbyEvents} from './realtime/lobby-events.js';
import type {DomainEvent} from './passives/passive-events.js';

const LEGACY='legacy';
const socketPath=(lobby:Lobby)=>lobby.id===LEGACY?'/socket.io':`/rooms/${lobby.id}/socket.io`;

// Each lobby owns its course database and Socket.IO transport; accounts, lobbies, runs and money live in the portal database.
export function createPortal(store:Store,config:Config){
 if(!store.portal)throw new Error('The portal requires the main database');
 const {lobbies,audit}=store.portal;
 const app=express();app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:false}));app.use(cors({origin:config.corsOrigin}));app.use(express.json({limit:32768}));const server=new Server(app);
 const accounts=express();registerAccounts(accounts,store,true);
 const running=new Map<string,ReturnType<typeof createApp>>();
 const members=(lobbyId:string)=>new Set(lobbies.members(lobbyId).map(m=>m.accountId));
 const events=new LobbyEvents();
 // Each new game observation may complete objectives, move passive progressions and pay pending rewards;
 // a Run change retries them.
 const observe=(lobbyId:string,clients=running.get(lobbyId)?.nativeClients.publicSnapshot()??[])=>{
  for(const c of clients)if(c.gameState&&c.adapter.status==='ready'&&lobbies.isMember(lobbyId,c.accountId)){
   void services.objectives.observe(lobbyId,c.accountId,c.gameState.progression.completed).catch(error=>console.error('Objectives:',error));
   void services.passiveEngine.observe(lobbyId,c.accountId,c.gameState).catch(error=>console.error('Passives:',error));
   void services.battles.observe(lobbyId,c.accountId,c.gameState).catch(error=>console.error('Battles:',error));
  }
 };
 const services=createServices(store.portal,running,{staleAfterMs:config.offlineAfterMs,commandTimeoutMs:config.commandTimeoutMs,generateLot:config.auctionGenerator,implementedPassives:config.passives?.implemented,passiveHandlers:config.passives?.handlers,random:config.passives?.random,
  emit:(lobbyId,event,payload)=>events.emit(lobbyId,event,payload),emitTo:(lobbyId,accountId,event,payload)=>events.emitTo(lobbyId,accountId,event,payload),changed:(lobbyId,topic)=>{void events.refresh(lobbyId,topic);if(['objectives','auctions','wheels','shop'].includes(topic))refreshMoney(lobbyId);if(topic==='wheels')void events.refresh(lobbyId,'shop');if(topic==='passives')void events.refresh(lobbyId,'lobby');}});
 events.provide('objectives',lobbyId=>services.objectives.snapshot(lobbyId));
 // Money topics: each viewer receives their own bank; jackpot and settings are shared by the lobby.
 events.provide('bank',(lobbyId,accountId)=>lobbies.isMember(lobbyId,accountId)?services.bank.snapshot(lobbyId,accountId):null);
 events.provide('jackpot',lobbyId=>services.jackpot.snapshot(lobbyId));
 events.provide('settings',lobbyId=>lobbies.settings(lobbyId));
 events.provide('auctions',lobbyId=>services.auctions.snapshot(lobbyId));
 events.provide('wheels',lobbyId=>services.wheels.snapshot(lobbyId));
 // Owned passives are public; each viewer only receives their own pending offer.
 events.provide('passives',(lobbyId,accountId)=>lobbies.isMember(lobbyId,accountId)||store.portal!.accounts.get(accountId)?.admin?services.passives.snapshot(lobbyId,accountId):null);
 // Commanded battles of the lobby (teams are normalised data, no memory address).
 events.provide('battles',(lobbyId,accountId)=>lobbies.isMember(lobbyId,accountId)||store.portal!.accounts.get(accountId)?.admin?services.battles.snapshot(lobbyId):null);
 events.provide('shop',(lobbyId,accountId)=>lobbies.isMember(lobbyId,accountId)?services.shop.snapshot(lobbyId,accountId):null);
 const refreshMoney=(lobbyId:string)=>{for(const topic of ['bank','jackpot','settings'])void events.refresh(lobbyId,topic);};
 const domain=store.portal;
 events.provide('lobby',(lobbyId,accountId)=>{const viewer=domain.accounts.get(accountId);return viewer?lobbySummary(domain,lobbies.require(lobbyId),viewer):null;});
 events.provide('runs',lobbyId=>domain.runs.listForLobby(lobbyId));
 const start=(lobby:Lobby)=>{
  const legacy=lobby.id===LEGACY;
  const data=new Store(legacy?store.path:store.path===':memory:'?':memory:':`${store.path}.${lobby.id}.sqlite`,'course');
  data.accounts=()=>{const ids=members(lobby.id);return store.accounts().filter(a=>ids.has(a.id));};
  // Legacy agent installations become portal accounts, as before the lobby model.
  // A name already used by another portal account is skipped instead of breaking the start-up on the unique name.
 if(legacy)data.putAccount=(account,key)=>{const same=store.portal!.accounts.findByName(account.name);if(!same||same.id===account.id)store.putAccount(account,key);};
  services.objectives.seed(lobby.id);services.wheels.seed(lobby.id);
  // Each new game observation may complete objectives (and pay their rewards).
  const course=createApp(data,{...config,roomCode:lobby.inviteCode,tokens:legacy?config.tokens:undefined},{server,path:socketPath(lobby)},{nativeClientsChanged:clients=>observe(lobby.id,clients),
   gameEvent:async(accountId,event)=>{await services.passiveEngine.publish({lobbyId:lobby.id,accountId,id:`game:${event.eventId}`,type:event.kind,data:event.data} as DomainEvent);}});
  running.set(lobby.id,course);events.attach(lobby.id,course.io.of('/dashboard'));
  // The Pokémon library is global now: former lobby libraries are copied once.
  services.library.importOnce(lobby.id,data.library());
  app.use(`/rooms/${lobby.id}`,(req,res,next)=>{
   if(req.path.startsWith('/api/accounts'))return res.status(404).json({error:'Gérez votre compte depuis le portail'});
   next();
  },course.app);
  server.once('close',()=>data.close());
 };
 if(config.roomCode&&!lobbies.get(LEGACY)){
  lobbies.create({id:LEGACY,name:'Salon historique',inviteCode:config.roomCode,createdBy:null});
  for(const account of store.accounts())lobbies.addMember(LEGACY,account.id);
 }
 registerLobbyRoutes(app,domain,{created:start,changed:lobbyId=>void events.refresh(lobbyId,'lobby')});
 registerRunRoutes(app,domain,lobbyId=>{void events.refresh(lobbyId,'runs');observe(lobbyId);},(lobbyId,run)=>{
  // Run events for the passives; a new Run right after a lost one is flagged for « Deuxième souffle ».
  if(run.status==='LOST')services.passiveEngine.emit({lobbyId,accountId:run.accountId,id:`run-lost:${run.id}`,type:'RUN_LOST',data:{runId:run.id}});
  if(run.status==='RUNNING'){const previous=domain.runs.history(lobbyId,run.accountId).find(r=>r.number<run.number);
   services.passiveEngine.emit({lobbyId,accountId:run.accountId,id:`run-started:${run.id}`,type:'RUN_STARTED',data:{runId:run.id,number:run.number,afterLoss:previous?.status==='LOST'}});}
 });
 registerGameRoutes(app,services,(lobbyId,topic)=>topic==='money'?refreshMoney(lobbyId):void events.refresh(lobbyId,topic));
 registerBankRoutes(app,services,refreshMoney);
 registerAuctionRoutes(app,services);
 registerWheelRoutes(app,services);
 registerShopRoutes(app,services);
 registerPassiveRoutes(app,services);
 registerBattleRoutes(app,services);
 registerAuditRoutes(app,services);
 setErrorAuditor((error,context)=>{
  const lobbyId=context.path.match(/^\/api\/lobbies\/([^/?]+)/)?.[1];
  domain.audit.record({lobbyId:lobbyId&&lobbies.get(lobbyId)?lobbyId:null,category:'ERROR',action:'internal_error',status:'FAILED',errorCode:'INTERNAL_ERROR',
   message:`Erreur interne sur ${context.method} ${context.path.split('?')[0]}`,metadata:{error:error instanceof Error?error.message:String(error)}});
 });
 registerObjectiveRoutes(app,services);
 // Resolution is authenticated with the same code and account name as the client handshake.
 app.post('/api/rooms/resolve',(req,res)=>{
  const lobby=typeof req.body?.roomCode==='string'?lobbies.getByInviteCode(req.body.roomCode):undefined;
  const account=store.accounts().find(a=>accountKey(a.name)===accountKey(String(req.body?.playerName??'')));
  if(!lobby||!account||!lobbies.isMember(lobby.id,account.id))return res.status(403).json({error:'Rejoignez ce salon sur le portail avec votre compte avant de connecter le client'});
  return res.json({socketPath:socketPath(lobby)});
 });
 app.use('/api/rooms',(req,res,next)=>{
  const account=store.accounts().find(a=>a.id===req.header('x-account-id'));
  if(!account)return res.status(401).json({error:'Choisissez votre compte'});
  res.locals.account=account;next();
 });
 app.get('/api/rooms',(_req,res)=>{
  const all=store.accounts();
  res.json(lobbies.list().map(l=>{const ids=members(l.id),joined=ids.has(res.locals.account.id);return {id:l.id,name:l.name,status:l.status,createdAt:l.createdAt,joined,players:all.filter(a=>ids.has(a.id)),...(joined||res.locals.account.admin?{code:l.inviteCode}:{})};}));
 });
 app.post('/api/rooms',(req,res)=>{
  if(!res.locals.account.admin)return res.status(403).json({error:'Seul un administrateur peut créer un salon'});
  const name=typeof req.body?.name==='string'?req.body.name.trim():'';
  if(!name||name.length>64||/[\x00-\x1f\x7f]/.test(name))return res.status(400).json({error:'Nom du salon invalide (1 à 64 caractères)'});
  const lobby=lobbies.create({name,createdBy:res.locals.account.id});start(lobby);
  audit.record({lobbyId:lobby.id,actorAccountId:res.locals.account.id,category:'LOBBY',action:'lobby.create',status:'SUCCESS',message:`Lobby « ${lobby.name} » créé`});
  return res.status(201).json({id:lobby.id,name:lobby.name,code:lobby.inviteCode,ownerId:lobby.createdBy,memberIds:[...members(lobby.id)],status:lobby.status,createdAt:lobby.createdAt});
 });
 app.post('/api/rooms/:id/join',(req,res)=>{
  const lobby=lobbies.get(req.params.id);
  if(!lobby)return res.status(404).json({error:'Salon introuvable'});
  if(!lobbies.isMember(lobby.id,res.locals.account.id)){
   if(!res.locals.account.admin&&req.body?.code!==lobby.inviteCode)return res.status(403).json({error:'Code du salon incorrect'});
   lobbies.addMember(lobby.id,res.locals.account.id);
   audit.record({lobbyId:lobby.id,actorAccountId:res.locals.account.id,category:'LOBBY',action:'lobby.join',status:'SUCCESS',message:`${res.locals.account.name} a rejoint le lobby`});
  }
  return res.json({id:lobby.id,name:lobby.name,code:lobby.inviteCode});
 });
 for(const lobby of lobbies.list())start(lobby);
 // Keep original endpoints for existing installations and global account management.
 app.use(accounts);
 const legacy=running.get(LEGACY);if(legacy)app.use(legacy.app);
 app.get('/health',(_req,res)=>res.json({ok:true}));
 return {app,server,running,services,currentGame:services.currentGame,events};
}
