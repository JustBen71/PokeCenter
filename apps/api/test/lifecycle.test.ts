import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {io as client, type Socket} from "socket.io-client";
import {Store} from "../src/store.js";
import {createApp} from "../src/app.js";

test("FR/EN coexist, identity cannot be spoofed, reconnect and SQLite reopen preserve states", {timeout:10000}, async(t)=>{
 const path=join(mkdtempSync(join(tmpdir(),"pokerace-lifecycle-")),"state.sqlite");
 const store=new Store(path);
 const {server,io}=createApp(store,{accountsRequired:false,corsOrigin:"http://localhost",offlineAfterMs:20,tokens:{"player-fr":"fr","player-en":"en"},adminToken:"test"});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const address=server.address();if(!address||typeof address==="string")throw Error("no address");
 const base=`http://127.0.0.1:${address.port}`;
 const sockets:Socket[]=[];
 t.after(async()=>{sockets.forEach(s=>s.close());await new Promise<void>(r=>io.close(()=>r()));store.close()});
 async function connect(language:string){const socket=client(base+"/agent",{auth:{playerId:"player-"+language,token:language},transports:["websocket"]});sockets.push(socket);await new Promise<void>((r,j)=>{socket.once("connect",r);socket.once("connect_error",j)});return socket}
 const fr=await connect("fr"),en=await connect("en");
 const state=(language:"fr"|"en")=>({protocolVersion:1,playerId:"player-"+language,game:{name:"pokemon-emerald",language,profileId:`emerald-${language}-fixture`,romStatus:"recognized"},trainer:{name:language==="fr"?"ÉLISE":"ASH"},location:{mapGroup:0,mapNumber:9,label:"Test"},party:[],observedAt:new Date().toISOString()});
 assert.equal((await fr.emitWithAck("telemetry",{type:"state",data:state("en")})).ok,false);
 assert.equal((await fr.emitWithAck("telemetry",{type:"state",data:state("fr")})).ok,true);
 assert.equal((await en.emitWithAck("telemetry",{type:"state",data:state("en")})).ok,true);
 assert.equal(store.all().length,2);
 await new Promise(r=>setTimeout(r,40));
 let players:any=await (await fetch(base+"/api/players")).json();assert.ok(players.every((p:any)=>!p.connected));
 fr.disconnect();fr.connect();await new Promise<void>(r=>fr.once("connect",r));
 await fr.emitWithAck("telemetry",{type:"state",data:state("fr")});
 players=await (await fetch(base+"/api/players")).json();assert.equal(players.find((p:any)=>p.playerId==="player-fr").state.trainer.name,"ÉLISE");
 const reopened=new Store(path);assert.equal(reopened.all().length,2);reopened.close();
});
