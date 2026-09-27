import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {io as client, type Socket} from "socket.io-client";
import {Store} from "../src/store.js";
import {createApp} from "../src/app.js";

test("room code joins without registration, keeps distinct IDs, and preserves authenticated nickname",{timeout:10000},async(t)=>{
 const store=new Store(join(mkdtempSync(join(tmpdir(),"pokerace-room-")),"test.sqlite"));
 const {server,io}=createApp(store,{accountsRequired:false,roomCode:"123",adminToken:"admin-only",corsOrigin:"http://localhost",offlineAfterMs:15000});
 const sockets:Socket[]=[];
 t.after(async()=>{sockets.forEach(s=>s.close());await new Promise<void>(r=>io.close(()=>r()));store.close()});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const address=server.address();if(!address||typeof address==="string")throw Error("no address");
 const base=`http://127.0.0.1:${address.port}`;
 function open(auth:object){const socket=client(base+"/agent",{auth,transports:["websocket"],reconnection:false});sockets.push(socket);return socket}
 for(const auth of [{playerId:"p-1",playerName:"Ben",roomCode:"wrong"},{playerId:"p-1",playerName:"Ben"},{playerId:"bad id",playerName:"Ben",roomCode:"123"},{playerId:"p-1",playerName:"",roomCode:"123"}]){
  const socket=open(auth);await new Promise<void>((r,j)=>{socket.once("connect_error",()=>{socket.close();r()});socket.once("connect",()=>j(Error("unexpected authentication")))});
 }
 for(const id of ["p-1","p-2"]){
  const socket=open({playerId:id,playerName:"Bén",roomCode:"123"});
  await new Promise<void>((r,j)=>{socket.once("connect",r);socket.once("connect_error",j)});
  const state={protocolVersion:1,playerId:id,playerName:"spoofed name",game:{name:"pokemon-emerald",language:null,profileId:null,romStatus:"unknown"},trainer:null,location:null,party:[],observedAt:new Date().toISOString()};
  assert.equal((await socket.emitWithAck("telemetry",{type:"state",data:state})).ok,true);
  assert.equal((await socket.emitWithAck("telemetry",{type:"state",data:{...state,playerId:"someone-else"}})).ok,false);
 }
 const players=await (await fetch(base+"/api/players")).json();
 assert.equal(players.length,2);assert.ok(players.every((p:any)=>p.state.playerName==="Bén"));
 assert.ok(players.every((p:any)=>!("roomCode" in p.state)));
 const admin=await fetch(base+"/api/admin/pokemon",{method:"POST",headers:{authorization:"Bearer 123","content-type":"application/json"},body:"{}"});
 assert.equal(admin.status,400); // Shared actions still validate the payload.
});
