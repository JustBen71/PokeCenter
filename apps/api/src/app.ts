import {createHash,timingSafeEqual} from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import {Server as HttpServer} from "node:http";
import {Server as SocketServer} from "socket.io";
import {agentEnvelopeSchema,MAX_MESSAGE_BYTES,pokemonInjectionSchema,toPublicPlayer} from "@pokerace/shared";
import {Store} from "./store.js";

type Config={corsOrigin:string;offlineAfterMs:number;tokens:Record<string,string>;adminToken:string};
const hash=(s:string)=>createHash("sha256").update(s).digest();
const safeEqual=(a:string,b:string)=>{const aa=hash(a),bb=hash(b);return timingSafeEqual(aa,bb)};
export function createApp(store:Store,config:Config){
 const app=express();app.disable("x-powered-by");app.use(helmet({contentSecurityPolicy:false}));app.use(cors({origin:config.corsOrigin}));app.use(express.json({limit:MAX_MESSAGE_BYTES}));
 const server=new HttpServer(app);const io=new SocketServer(server,{cors:{origin:config.corsOrigin},maxHttpBufferSize:MAX_MESSAGE_BYTES,transports:["websocket","polling"]});
 const agent=io.of("/agent"), dashboard=io.of("/dashboard");const connected=new Map<string,number>();const agentSockets=new Map<string,Set<string>>();
 const publicPlayers=()=>store.all().map(row=>toPublicPlayer({...row,connected:(connected.get(row.playerId)??0)>0 && Date.now()-Date.parse(row.lastSeenAt)<config.offlineAfterMs}));
 const broadcast=()=>dashboard.emit("players",publicPlayers());
 dashboard.on("connection",socket=>socket.emit("players",publicPlayers()));
 agent.use((socket,next)=>{const playerId=String(socket.handshake.auth.playerId??"");const token=String(socket.handshake.auth.token??"");const expected=config.tokens[playerId];if(!expected||!token||!safeEqual(token,expected))return next(new Error("unauthorized"));socket.data.playerId=playerId;next();});
 agent.on("connection",socket=>{const playerId=socket.data.playerId as string;connected.set(playerId,(connected.get(playerId)??0)+1);if(!agentSockets.has(playerId))agentSockets.set(playerId,new Set());agentSockets.get(playerId)!.add(socket.id);broadcast();socket.on("telemetry",(payload,ack)=>{const bytes=Buffer.byteLength(JSON.stringify(payload));if(bytes>MAX_MESSAGE_BYTES)return ack?.({ok:false,error:"message too large"});const parsed=agentEnvelopeSchema.safeParse(payload);if(!parsed.success)return ack?.({ok:false,error:"invalid payload"});const payloadPlayerId=parsed.data.type==="state"?parsed.data.data.playerId:parsed.data.playerId;if(payloadPlayerId!==playerId)return ack?.({ok:false,error:"player mismatch"});const now=new Date().toISOString();if(parsed.data.type==="state")store.save(parsed.data.data,now);else store.heartbeat(playerId,now);broadcast();ack?.({ok:true,receivedAt:now});});socket.on("disconnect",()=>{connected.set(playerId,Math.max(0,(connected.get(playerId)??1)-1));agentSockets.get(playerId)?.delete(socket.id);broadcast();});});
 app.get("/health",(_req,res)=>res.json({ok:true}));app.get("/api/players",(_req,res)=>res.json(publicPlayers()));
 app.post("/api/admin/clients",(req,res)=>{const token=String(req.headers.authorization??"").replace(/^Bearer /,"");if(!token||!safeEqual(token,config.adminToken))return res.status(401).json({error:"unauthorized"});return res.status(501).json({error:"Use scripts/manage-client.mjs to update the server token file, then restart the API."});});
 app.post("/api/admin/pokemon",(req,res)=>{const token=String(req.headers.authorization??"").replace(/^Bearer /,"");if(!token||!safeEqual(token,config.adminToken))return res.status(401).json({error:"unauthorized"});const parsed=pokemonInjectionSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"invalid pokemon",issues:parsed.error.issues});const sockets=agentSockets.get(parsed.data.playerId);if(!sockets?.size)return res.status(409).json({error:"player offline"});for(const socketId of sockets)agent.to(socketId).emit("command",{type:"injectPokemon",data:parsed.data});return res.status(202).json({ok:true,deliveredTo:sockets.size});});
 const timer=setInterval(broadcast,5000);timer.unref();return {app,server,io};
}
