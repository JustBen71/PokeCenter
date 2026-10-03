import {assertKeptPokemon} from './roulette-effects.js';
import {registerNativeClients} from './native-clients.js';
import {registerAccounts} from './accounts.js';
import {accountKey} from '@pokerace/shared';
import {registerRoulette} from "./roulette-routes.js";
import {registerAuctions} from "./auction-routes.js";
import {createHash,timingSafeEqual,randomUUID} from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import {Server as HttpServer} from "node:http";
import {Server as SocketServer} from "socket.io";
import {agentEnvelopeSchema,libraryInputSchema,restorePokemonSchema,removePokemonSchema,MAX_MESSAGE_BYTES,pokemonInjectionSchema,toPublicPlayer} from "@pokerace/shared";
import {Store} from "./store.js";

type Config={accountsRequired?:boolean;corsOrigin:string;offlineAfterMs:number;tokens?:Record<string,string>;roomCode?:string;adminToken:string};
const hash=(s:string)=>createHash("sha256").update(s).digest();
const safeEqual=(a:string,b:string)=>{const aa=hash(a),bb=hash(b);return timingSafeEqual(aa,bb)};
export function createApp(store:Store,config:Config){
 const app=express();app.disable("x-powered-by");app.use(helmet({contentSecurityPolicy:false}));app.use(cors({origin:config.corsOrigin}));app.use(express.json({limit:MAX_MESSAGE_BYTES}));
 const server=new HttpServer(app);const io=new SocketServer(server,{cors:{origin:config.corsOrigin},maxHttpBufferSize:MAX_MESSAGE_BYTES,transports:["websocket","polling"]});
 const agent=io.of("/agent"), dashboard=io.of("/dashboard");const connected=new Map<string,number>();const agentSockets=new Map<string,Set<string>>();
 const actionLocks=new Set<string>();
 const accountsRequired=config.accountsRequired!==false;registerAccounts(app,store,accountsRequired);
 const nativeClients=registerNativeClients(io,config,name=>store.accounts().find(a=>accountKey(a.name)===accountKey(name)),clients=>dashboard.emit("native-clients",clients));
 const publicPlayers=()=>store.all().map(row=>{const account=store.accounts().find(a=>a.id===row.playerId);return {...toPublicPlayer({...row,state:{...row.state,...(account?{playerName:account.name}:{})},connected:(connected.get(row.playerId)??0)>0 && Date.now()-Date.parse(row.lastSeenAt)<config.offlineAfterMs}),account};});
 const broadcast=()=>dashboard.emit("players",publicPlayers());
 registerAuctions(app,store,publicPlayers,async(data,commandId)=>{
  const sockets=agentSockets.get(data.playerId);
  if(sockets?.size!==1)throw Error('Joueur hors ligne ou connecté plusieurs fois');
  const target=agent.sockets.get([...sockets][0]);if(!target)throw Error('Joueur déconnecté');
  const result=await target.timeout(10000).emitWithAck('command',{type:'injectPokemon',commandId,data});
  if(result?.ok!==true)throw Error(String(result?.error??'Achat non confirmé'));
 },actionLocks);
 dashboard.use((socket,next)=>{if(accountsRequired&&!store.accounts().some(a=>a.id===socket.handshake.auth?.accountId))return next(new Error("Choisissez votre compte"));next();});
 dashboard.on("connection",socket=>{socket.emit("players",publicPlayers());socket.emit("native-clients",nativeClients.publicSnapshot());});
 agent.use((socket,next)=>{
  const auth=socket.handshake.auth;
  const playerId=String(auth.playerId??"");
  if(!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(playerId))return next(new Error("invalid player id"));
  const roomCode=String(auth.roomCode??"");
  const token=String(auth.token??"");
  const expected=config.tokens?.[playerId];
  const roomAccepted=!!config.roomCode && !!roomCode && safeEqual(roomCode,config.roomCode);
  const legacyAccepted=!!expected && !!token && safeEqual(token,expected);
  if(!roomAccepted&&!legacyAccepted)return next(new Error("Code de salon incorrect"));
  const playerName=String(auth.playerName??"").trim();
  if(roomAccepted&&(!playerName||playerName.length>32||/[\x00-\x1f\x7f]/.test(playerName)))return next(new Error("Pseudo invalide"));
  const account=accountsRequired?store.accounts().find(a=>accountKey(a.name)===accountKey(String(auth.accountName??playerName))):undefined;
  if(accountsRequired&&!account)return next(new Error("Compte introuvable : créez-le sur le portail puis renseignez ACCOUNT_NAME"));
  if(account&&(agentSockets.get(account.id)?.size??0)>0)return next(new Error("Ce compte est déjà connecté sur un autre client"));
  socket.data.wirePlayerId=playerId;
  socket.data.playerId=account?.id??playerId;
  socket.data.playerName=account?.name??(roomAccepted?playerName:undefined);
  next();
 });
 agent.on("connection",socket=>{const playerId=socket.data.playerId as string;connected.set(playerId,(connected.get(playerId)??0)+1);if(!agentSockets.has(playerId))agentSockets.set(playerId,new Set());agentSockets.get(playerId)!.add(socket.id);broadcast();socket.on("telemetry",(payload,ack)=>{const bytes=Buffer.byteLength(JSON.stringify(payload));if(bytes>MAX_MESSAGE_BYTES)return ack?.({ok:false,error:"message too large"});const parsed=agentEnvelopeSchema.safeParse(payload);if(!parsed.success)return ack?.({ok:false,error:"invalid payload"});const payloadPlayerId=parsed.data.type==="state"?parsed.data.data.playerId:parsed.data.playerId;if(payloadPlayerId!==socket.data.wirePlayerId)return ack?.({ok:false,error:"player mismatch"});const now=new Date().toISOString();if(parsed.data.type==="state")store.save({...parsed.data.data,playerId,...(socket.data.playerName?{playerName:socket.data.playerName}:{})},now);else store.heartbeat(playerId,now);broadcast();void roulette.observe().catch(error=>console.error("Roulette monitor:",error));ack?.({ok:true,receivedAt:now});});socket.on("disconnect",()=>{connected.set(playerId,Math.max(0,(connected.get(playerId)??1)-1));agentSockets.get(playerId)?.delete(socket.id);broadcast();});});
 app.get("/api/native-clients",(_req,res)=>res.json(nativeClients.publicSnapshot()));
 app.get("/health",(_req,res)=>res.json({ok:true}));app.get("/api/players",(_req,res)=>res.json(publicPlayers()));
 app.post("/api/admin/clients",(req,res)=>{const token=String(req.headers.authorization??"").replace(/^Bearer /,"");if(!token||!safeEqual(token,config.adminToken))return res.status(401).json({error:"unauthorized"});return res.status(501).json({error:"Use scripts/manage-client.mjs to update the server token file, then restart the API."});});
 app.get(["/api/library","/api/admin/library"],(_req,res)=>res.json(store.library()));
 app.post(["/api/library","/api/admin/library"],(req,res)=>{
  const parsed=libraryInputSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Copie ou modèle invalide",issues:parsed.error.issues});
  const entry={...parsed.data,id:randomUUID(),createdAt:new Date().toISOString()};
  store.saveLibrary(entry);return res.status(201).json(entry);
 });
 app.delete(["/api/library/:id","/api/admin/library/:id"],(req,res)=>{
  if(!store.deleteLibrary(String(req.params.id)))return res.status(404).json({error:"Pokémon introuvable"});
  return res.json({ok:true});
 });
 const roulette=registerRoulette(app,store,publicPlayers,async data=>{
  const sockets=agentSockets.get(data.playerId);
  if(sockets?.size!==1)throw new Error("Joueur hors ligne ou connecté plusieurs fois");
  const target=agent.sockets.get([...sockets][0]);if(!target)throw new Error("Joueur déconnecté");
  const result=await target.timeout(10000).emitWithAck("command",{type:"injectPokemon",commandId:randomUUID(),data});
  if(result?.ok!==true)throw new Error(String(result?.error??"Commande non confirmée"));
 },actionLocks);
 app.post(["/api/pokemon","/api/admin/pokemon"],async(req,res)=>{
  const parsed=(req.body?.action==="remove"?removePokemonSchema:req.body?.raw!==undefined?restorePokemonSchema:pokemonInjectionSchema).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"invalid pokemon",issues:parsed.error.issues});
  if(actionLocks.has(parsed.data.playerId)||store.unresolvedRuns().some(r=>r.status==="review"&&r.operations.some(o=>o.playerId===parsed.data.playerId)))return res.status(409).json({error:"Une roulette utilise ce joueur ou attend une vérification"});
  try{const data=parsed.data,p=publicPlayers().find(p=>p.playerId===data.playerId);if(p){const after=p.state.party.filter(mon=>!(('action' in data&&data.action==='remove')&&mon.slot===data.slot)).map(mon=>mon.slot===data.slot?('raw' in data?data.raw:''):mon.raw!);assertKeptPokemon(store,data.playerId,after);}}catch(e){return res.status(409).json({error:String(e)});}
  const sockets=agentSockets.get(parsed.data.playerId);
  if(!sockets?.size)return res.status(409).json({error:"player offline"});
  if(sockets.size!==1)return res.status(409).json({error:"multiple sessions for this player"});
  const target=agent.sockets.get([...sockets][0]);
  if(!target)return res.status(409).json({error:"player offline"});
  const commandId=randomUUID();
  actionLocks.add(parsed.data.playerId);
  try {
   const result=await target.timeout(10000).emitWithAck("command",{type:"injectPokemon",commandId,data:parsed.data});
   if(result?.ok!==true)return res.status(502).json({commandId,error:String(result?.error??"Lua rejected command").slice(0,500)});
   return res.json({ok:true,commandId,confirmed:true});
  } catch {return res.status(504).json({commandId,error:"Confirmation timeout; check game before retrying"});} finally {actionLocks.delete(parsed.data.playerId);}
 });
 const timer=setInterval(broadcast,5000);timer.unref();return {app,server,io,nativeClients};
}
