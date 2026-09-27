import {readFileSync} from "node:fs";
import {Store} from "./store.js";
import {createApp} from "./app.js";
const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error(`${name} is required`);return v};
const tokens=process.env.PLAYER_TOKENS_FILE?JSON.parse(readFileSync(process.env.PLAYER_TOKENS_FILE,"utf8")):{};
const roomCode=process.env.ROOM_CODE;
if(!roomCode&&!Object.keys(tokens).length)throw new Error("ROOM_CODE is required");
const store=new Store(process.env.DATABASE_PATH??"/data/pokerace.sqlite");
const {server}=createApp(store,{corsOrigin:process.env.CORS_ORIGIN??"http://localhost:8080",offlineAfterMs:Number(process.env.OFFLINE_AFTER_MS??15000),tokens,roomCode,adminToken:process.env.ADMIN_TOKEN??""});
const port=Number(process.env.PORT??3000);server.listen(port,"0.0.0.0",()=>console.log(`Pokérace API listening on ${port}`));
for(const signal of ["SIGINT","SIGTERM"]){process.on(signal,()=>server.close(()=>{store.close();process.exit(0)}));}
