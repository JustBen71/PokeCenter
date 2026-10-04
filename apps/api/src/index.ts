import {readFileSync} from "node:fs";
import {Store} from "./store.js";
import {createPortal} from "./rooms.js";
const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error(`${name} is required`);return v};
const tokens=process.env.PLAYER_TOKENS_FILE?JSON.parse(readFileSync(process.env.PLAYER_TOKENS_FILE,"utf8")):{};
const roomCode=process.env.ROOM_CODE;

const store=new Store(process.env.DATABASE_PATH??"/data/pokerace.sqlite");
const {server,running}=createPortal(store,{corsOrigin:process.env.CORS_ORIGIN??"http://localhost:8080",offlineAfterMs:Number(process.env.OFFLINE_AFTER_MS??15000),tokens,roomCode,adminToken:process.env.ADMIN_TOKEN??""});
const port=Number(process.env.PORT??3000);server.listen(port,"0.0.0.0",()=>console.log(`Pokérace API listening on ${port}`));
for(const signal of ["SIGINT","SIGTERM"]){process.on(signal,()=>{for(const course of running.values())course.io.disconnectSockets(true);server.close(()=>{store.close();process.exit(0)});});}
