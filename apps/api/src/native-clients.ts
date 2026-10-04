import {gameStateEventSchema,type PublicNativeClient} from '@pokerace/shared';
import {createHash, timingSafeEqual} from 'node:crypto';
import type {Server} from 'socket.io';
import {z} from 'zod';

const VERSION = 1;
const identity = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/);
const system = z.string().min(1).max(64).nullable();
const bridge = z.object({type:z.literal('bizhawk'),connected:z.boolean(),protocolVersion:z.literal(1).nullable(),gameLoaded:z.boolean()}).strict();
const envelope = z.object({type:z.string(),protocolVersion:z.literal(VERSION)});
const hello = envelope.extend({type:z.literal('HELLO'),clientVersion:z.string().max(32),playerId:identity,
 platform:z.string().max(64),bridge,emulator:z.object({name:z.literal('BizHawk')}).strict().nullable(),system}).strict();
const status = envelope.extend({type:z.literal('CLIENT_STATUS'),connected:z.boolean(),allowMemoryWrites:z.boolean(),canPurchase:z.boolean().optional()}).strict();
const bridgeStatus = envelope.extend({type:z.literal('BRIDGE_STATUS'),bridge,system}).strict();
const heartbeat = envelope.extend({type:z.literal('HEARTBEAT'),clientVersion:z.string().max(32),bridgeConnected:z.boolean(),system}).strict();
const ack = envelope.extend({type:z.literal('COMMAND_ACK'),commandId:z.string().uuid(),ok:z.boolean(),result:z.record(z.unknown()).optional(),error:z.object({code:z.string().max(64)}).optional()}).strict();
const command = envelope.extend({type:z.literal('COMMAND'),commandId:z.string().uuid(),command:z.enum([
 'pokemon.purchase','game.money.add','game.money.remove','game.money.set','game.pokemon.insert','game.pokemon.remove','game.pokemon.replace','game.party.snapshot','bridge.ping','bridge.getStatus','bridge.getSystem','bridge.getGameInfo','bridge.listMemoryDomains','bridge.readMemory','bridge.writeMemory'
]),payload:z.record(z.unknown())}).strict();
export type NativeCommand=z.infer<typeof command>;
export type NativeAck=z.infer<typeof ack>;
const safeEqual = (a:string,b:string) => timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());

type Config = {roomCode?:string; accountsRequired?:boolean};
type Account = {id:string; name:string};
type ClientState = {playerId:string; accountId:string; playerName:string; socketId:string; ready:boolean; lastSeenAt:string; hello?:z.infer<typeof hello>; bridge?:z.infer<typeof bridgeStatus>; status?:z.infer<typeof status>; game?:z.infer<typeof gameStateEventSchema>};

// Native observations are additive; business commands still belong to /agent.
export function registerNativeClients(io:Server, config:Config, findAccount:(name:string)=>Account|undefined, onChange:(clients:PublicNativeClient[])=>void=()=>{}) {
 const namespace=io.of('/client');
 const clients=new Map<string,ClientState>();
 const publicSnapshot=():PublicNativeClient[]=>[...clients.values()].map(s=>({
  accountId:s.accountId,playerId:s.playerId,playerName:s.playerName,ready:s.ready,lastSeenAt:s.lastSeenAt,
  clientVersion:s.hello?.clientVersion??null,platform:s.hello?.platform??null,
  emulator:s.hello?.emulator?{name:'BizHawk'}:null,
  bridge:{type:'bizhawk',connected:(s.bridge??s.hello)?.bridge.connected??false,gameLoaded:(s.bridge??s.hello)?.bridge.gameLoaded??false,protocolVersion:(s.bridge??s.hello)?.bridge.protocolVersion??null},
  canPurchase:s.status?.canPurchase===true,system:(s.bridge??s.hello)?.system??null,allowMemoryWrites:s.status?.allowMemoryWrites??false,
  adapter:s.game?structuredClone(s.game.adapter):{id:null,status:'no_game',profileId:null,capabilities:[]},gameState:s.game?.state?structuredClone(s.game.state):null
 }));
 let lastPublic='';
 const changed=()=>{const rows=publicSnapshot();const key=JSON.stringify(rows.map(({lastSeenAt,...row})=>({...row,gameState:row.gameState?{...row.gameState,observedAt:null}:null})));if(key!==lastPublic){lastPublic=key;onChange(rows);}};
 const pending=new Map<string,{socketId:string; fingerprint:string; resolve:(result:z.infer<typeof ack>)=>void; reject:(error:Error)=>void; timer:ReturnType<typeof setTimeout>; promise:Promise<z.infer<typeof ack>>}>();
 namespace.use((socket,next)=>{
  const parsed=z.object({protocolVersion:z.literal(VERSION),playerId:identity,playerName:z.string().trim().min(1).max(32).refine(v=>!/[\x00-\x1f\x7f]/.test(v)),roomCode:z.string().min(1).max(128)}).safeParse(socket.handshake.auth);
  if(!parsed.success)return next(new Error('Invalid client identity or protocol'));
  const auth=parsed.data;
  if(!config.roomCode||!safeEqual(auth.roomCode,config.roomCode))return next(new Error('Authentication rejected'));
  const account=config.accountsRequired!==false?findAccount(auth.playerName):undefined;
  if(config.accountsRequired!==false&&!account)return next(new Error('Account not found'));
  const accountId=account?.id??auth.playerId;
  if(clients.has(auth.playerId)||[...clients.values()].some(c=>c.accountId===accountId))return next(new Error('Client already connected'));
  socket.data.nativeIdentity={playerId:auth.playerId,playerName:account?.name??auth.playerName,accountId};
  next();
 });
 namespace.on('connection',socket=>{
  const state:ClientState={...socket.data.nativeIdentity,socketId:socket.id,ready:false,lastSeenAt:new Date().toISOString()};
  clients.set(state.playerId,state);changed();
  const emitStatus=(ready:boolean)=>socket.emit('SERVER_STATUS',{type:'SERVER_STATUS',protocolVersion:VERSION,connected:true,ready});
  emitStatus(false);
  const deadline=setTimeout(()=>{if(!state.ready)socket.disconnect(true)},10000);deadline.unref();
  socket.on('HELLO',(value:unknown)=>{
   const parsed=hello.safeParse(value);
   if(!parsed.success||parsed.data.playerId!==state.playerId){socket.disconnect(true);return;}
   state.hello=parsed.data;state.ready=true;state.lastSeenAt=new Date().toISOString();clearTimeout(deadline);emitStatus(true);changed();
  });
  for(const [name,schema] of [['CLIENT_STATUS',status],['BRIDGE_STATUS',bridgeStatus],['HEARTBEAT',heartbeat]] as const){
   socket.on(name,(value:unknown)=>{
    const parsed=schema.safeParse(value);
    if(!state.ready||!parsed.success){socket.disconnect(true);return;}
    state.lastSeenAt=new Date().toISOString();
    if(parsed.data.type==='CLIENT_STATUS')state.status=parsed.data;
    if(parsed.data.type==='BRIDGE_STATUS'){const previous=state.bridge??state.hello;if(JSON.stringify(previous?.bridge)!==JSON.stringify(parsed.data.bridge)||previous?.system!==parsed.data.system)state.game=undefined;state.bridge=parsed.data;}
    changed();
   });
  }
  socket.on('GAME_STATE',(value:unknown)=>{
   if(!state.ready||Buffer.byteLength(JSON.stringify(value)??'')>32768){socket.disconnect(true);return;}
   const parsed=gameStateEventSchema.safeParse(value);
   if(!parsed.success){socket.disconnect(true);return;}
   if(parsed.data.state&&(!(state.bridge??state.hello)?.bridge.connected||!(state.bridge??state.hello)?.bridge.gameLoaded||(state.bridge??state.hello)?.system!=='GBA')){socket.disconnect(true);return;}
   state.game=parsed.data;state.lastSeenAt=new Date().toISOString();changed();
  });
  socket.on('COMMAND_ACK',(value:unknown)=>{
   const parsed=ack.safeParse(value);if(!state.ready||!parsed.success)return;
   const key=state.playerId+':'+parsed.data.commandId.toLowerCase();const item=pending.get(key);
   if(!item||item.socketId!==socket.id)return;
   clearTimeout(item.timer);pending.delete(key);item.resolve(parsed.data);
  });
  socket.on('disconnect',()=>{
   clearTimeout(deadline);if(clients.get(state.playerId)?.socketId===socket.id)clients.delete(state.playerId);
   changed();
   for(const [key,item] of pending){if(item.socketId===socket.id){clearTimeout(item.timer);pending.delete(key);item.reject(new Error('Client disconnected; command outcome may be unknown'));}}
  });
 });
 return {
  publicSnapshot,
  // No raw memory or secrets are retained in the status registry.
  snapshot:()=>[...clients.values()].map(({socketId,...state})=>structuredClone(state)),
  sendCommand(playerId:string, value:z.infer<typeof command>, timeoutMs=15000):Promise<z.infer<typeof ack>> {
   const request=command.parse(value);
   const state=clients.get(playerId);const socket=state&&namespace.sockets.get(state.socketId);
   if(!state?.ready||!socket)return Promise.reject(new Error('Native client is not ready'));
   if(Buffer.byteLength(JSON.stringify(request))>32768)return Promise.reject(new Error('Command too large'));
   const key=playerId+':'+request.commandId.toLowerCase();const fingerprint=JSON.stringify(request);const previous=pending.get(key);
   if(previous)return previous.fingerprint===fingerprint?previous.promise:Promise.reject(new Error('Command ID already in use'));
   let resolve!:(value:z.infer<typeof ack>)=>void,reject!:(error:Error)=>void;
   const promise=new Promise<z.infer<typeof ack>>((yes,no)=>{resolve=yes;reject=no});
   const timer=setTimeout(()=>{pending.delete(key);reject(new Error('Command ACK timeout; outcome may be unknown'));},timeoutMs);timer.unref();
   pending.set(key,{socketId:socket.id,fingerprint,resolve,reject,timer,promise});
   socket.emit('COMMAND',request);return promise;
  }
 };
}
