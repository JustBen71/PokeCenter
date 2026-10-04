import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {io as client,type Socket} from 'socket.io-client';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import type {Auction} from '@pokerace/shared';

test('room membership and isolated auctions survive a server restart',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'pokerace-rooms-')),path=join(folder,'portal.sqlite');
 let store=new Store(path);let portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000});
 const stop=async()=>{for(const course of portal.running.values())course.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();};
 try{
  await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
  const admin=(await request(portal.app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const create=async(name:string)=>(await request(portal.app).post('/api/rooms').set('x-account-id',admin.id).send({name})).body;
  const a=await create('A'),b=await create('B');
  const data=new Store(`${path}.${a.id}.sqlite`);data.auctions();data.putAuction({id:'auction-a',status:'open',bids:[],log:[],template:{}} as unknown as Auction);data.close();
  const get=(room:string)=>request(portal.app).get(`/rooms/${room}/api/auctions`).set('x-account-id',admin.id);
  assert.equal((await get(a.id)).body.auctions[0].id,'auction-a');assert.deepEqual((await get(b.id)).body.auctions,[]);
  assert.equal((await request(portal.app).post(`/rooms/${b.id}/api/auctions/auction-a/cancel`).set('x-account-id',admin.id).send({})).status,409);
  assert.equal((await get(a.id)).body.auctions[0].status,'open');
  await stop();store=new Store(path);portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000});
  await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
  assert.equal((await get(a.id)).body.auctions[0].id,'auction-a');assert.deepEqual((await get(b.id)).body.auctions,[]);
  const rooms=(await request(portal.app).get('/api/rooms').set('x-account-id',admin.id)).body;
  assert.equal(rooms.length,2);assert.equal(rooms[0].joined,true);assert.equal(rooms[0].code,a.code);
 }finally{await stop();assert.equal(dirname(resolve(folder)),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});}
});

test('rooms restrict creation and membership, isolate teams, auctions, progression and sockets',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000});const sockets:Socket[]=[];
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const post=(path:string,id:string,body:unknown)=>request(portal.app).post(path).set('x-account-id',id).send(body);
 const get=(path:string,id:string)=>request(portal.app).get(path).set('x-account-id',id);
 try{
  const admin=(await post('/api/accounts','',{name:'Admin',sprite:'red',admin:true})).body;
  const player=(await post('/api/accounts','',{name:'Player',sprite:'may',admin:false})).body;
  assert.equal((await post('/api/rooms',player.id,{name:'No'})).status,403);
  const a=(await post('/api/rooms',admin.id,{name:'Course A'})).body;
  const b=(await post('/api/rooms',admin.id,{name:'Course B'})).body;
  assert.ok(a.code);assert.notEqual(a.code,b.code);
  assert.equal((await get('/api/rooms',player.id)).body[0].code,undefined);
  assert.equal((await post(`/api/rooms/${a.id}/join`,player.id,{code:'bad'})).status,403);
  assert.equal((await post(`/api/rooms/${a.id}/join`,player.id,{code:a.code})).status,200);
  assert.equal((await get(`/rooms/${b.id}/api/players`,player.id)).status,401);
  assert.equal((await post('/api/rooms/resolve','',{roomCode:b.code,playerName:'Player'})).status,403);
  const resolved=await post('/api/rooms/resolve','',{roomCode:a.code,playerName:'Player'});
  assert.equal(resolved.body.socketPath,`/rooms/${a.id}/socket.io`);
  const open=(room:any,namespace:string,auth:object)=>{const s=client(base+namespace,{path:`/rooms/${room.id}/socket.io`,auth,transports:['websocket'],reconnection:false,timeout:3000});sockets.push(s);return s;};
  const connected=(s:Socket)=>new Promise<void>((r,j)=>{s.once('connect',r);s.once('connect_error',j);});
  const dashA=open(a,'/dashboard',{accountId:admin.id});let rowsA:any[]=[];dashA.on('players',v=>rowsA=v);await connected(dashA);
  const dashB=open(b,'/dashboard',{accountId:admin.id});let rowsB:any[]=[];dashB.on('players',v=>rowsB=v);await connected(dashB);
  const agent=open(a,'/agent',{playerId:'installation-1',playerName:'Player',roomCode:a.code});await connected(agent);
  const state={protocolVersion:1,playerId:'installation-1',playerName:'Player',game:{name:'pokemon-emerald',language:'fr',profileId:'test',romStatus:'recognized'},trainer:{name:'PLAYER',partyCount:0,money:3000},location:null,party:[],progression:{version:1,completed:['starter']},observedAt:new Date().toISOString()};
  assert.equal((await agent.timeout(3000).emitWithAck('telemetry',{type:'state',data:state})).ok,true);
  const teams=(await get(`/rooms/${a.id}/api/players`,admin.id)).body;
  assert.equal(teams.length,1);assert.deepEqual(teams[0].state.progression.completed,['starter']);
  assert.deepEqual((await get(`/rooms/${b.id}/api/players`,admin.id)).body,[]);
  assert.equal(rowsA.length,1);assert.deepEqual(rowsB,[]);
  const wrong=open(b,'/agent',{playerId:'installation-2',playerName:'Player',roomCode:a.code});
  await new Promise<void>((r,j)=>{wrong.once('connect_error',()=>r());wrong.once('connect',()=>j(Error('cross-room connection accepted')));});
  // Exercise the same persistence used by the auction handlers without external Pokémon requests.
  assert.deepEqual((await get(`/rooms/${a.id}/api/auctions`,admin.id)).body.auctions,[]);
  assert.deepEqual((await get(`/rooms/${b.id}/api/auctions`,admin.id)).body.auctions,[]);
  const native=open(a,'/client',{protocolVersion:1,playerId:'native-1',playerName:'Player',roomCode:a.code});await connected(native);
  assert.equal((await get(`/rooms/${a.id}/api/native-clients`,admin.id)).body.length,1);
  assert.deepEqual((await get(`/rooms/${b.id}/api/native-clients`,admin.id)).body,[]);
 }finally{
  sockets.forEach(s=>s.close());
  for(const course of portal.running.values())course.io.disconnectSockets(true);
  await new Promise<void>(r=>portal.server.close(()=>r()));store.close();
 }
});
