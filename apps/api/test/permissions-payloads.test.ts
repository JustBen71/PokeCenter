import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {io as client} from 'socket.io-client';
import type {LobbyAuction,WheelType} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,template,until} from './support/fake-game-client.js';

const ADMIN_TOKEN='admin-token-never-sent-to-browsers';
const lot=async()=>({speciesId:1,name:'Bulbizarre',level:5,sampleSize:1,template:{...template(1,5,'SECRET'),ivs:{hp:31,attack:30,defense:29,speed:28,spAttack:27,spDefense:26}}});

async function portalWithPlayers(){
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:ADMIN_TOKEN,corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:500,auctionGenerator:lot});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const app=portal.app;
 const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
 const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
 const tim=(await request(app).post('/api/accounts').send({name:'Tim',sprite:'leaf',admin:false})).body;
 // Production mode (server password): the admin role is the session « Se connecter en admin » gives.
 const sessions=new Map<string,string>();
 const auth=(r:request.Test,id:string)=>r.set('x-account-id',id).set('x-admin-token',sessions.get(id)??'');
 const as=(id:string)=>({get:(p:string)=>auth(request(app).get(p),id),post:(p:string,b:object={})=>auth(request(app).post(p),id).send(b),
  patch:(p:string,b:object)=>auth(request(app).patch(p),id).send(b),delete:(p:string)=>auth(request(app).delete(p),id)});
 sessions.set(admin.id,(await as(admin.id).post('/api/admin/session',{password:ADMIN_TOKEN})).body.token);
 const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
 for(const p of [ben,tim])await as(p.id).post('/api/lobbies/join',{code:lobby.inviteCode});
 const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:20000});
 const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',money:20000});
 for(const p of [ben,tim]){
  await until(()=>portal.services.currentGame.resolve(lobby.id,p.id).game.money===20000,`${p.name} state`);
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:p.id,start:true});
 }
 const close=async()=>{benGame.close();timGame.close();for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();};
 return {portal,store,base,admin,ben,tim,as,lobby,benGame,timGame,close,path:`/api/lobbies/${lobby.id}`};
}

test('server permissions: players cannot do admin actions nor act for another player',async()=>{
 const {admin,ben,tim,as,path,benGame,timGame,close}=await portalWithPlayers();
 try{
  const wheel=(await as(admin.id).post(`${path}/wheels`,{name:'Roue',description:'',price:1000,icon:'green-1',tone:'GOOD',enabled:true,gages:[{name:'Rien',description:'',handler:'NOTICE',params:{},weight:1}]})).body as WheelType;
  const auction=(await as(admin.id).post(`${path}/auctions`,{uncertainty:25})).body as LobbyAuction;
  const denied=async(label:string,response:request.Response)=>{assert.ok([401,403].includes(response.status),`${label}: ${response.status} ${JSON.stringify(response.body)}`);};
  await denied('create lobby',await as(ben.id).post('/api/lobbies',{name:'Pirate'}));
  await denied('change settings',await as(ben.id).patch(`${path}/settings`,{bankDepositTaxPercent:0}));
  await denied('read logs',await as(ben.id).get(`${path}/audit`));
  await denied('edit library',await as(ben.id).post('/api/library',{label:'x',template:template()}));
  await denied('spin admin wheel',await as(ben.id).post(`${path}/wheels/${wheel.id}/spin`,{ownerId:ben.id}));
  await denied('create wheel',await as(ben.id).post(`${path}/wheels`,{name:'x'}));
  await denied('close auction',await as(ben.id).post(`${path}/auctions/${auction.id}/close`));
  await denied('cancel auction',await as(ben.id).post(`${path}/auctions/${auction.id}/cancel`));
  await denied('resolve command',await as(ben.id).post(`${path}/game-commands/${randomUUID()}/resolve`,{applied:true}));
  await denied('edit another player money',await as(ben.id).post(`${path}/players/${tim.id}/money`,{operation:'add',amount:1000}));
  assert.equal(timGame.received.length,0,'no admin command reached a game');

  // Bank and bids always act for the caller: naming another account is rejected, never applied to it.
  const foreignDeposit=await as(ben.id).post(`${path}/bank/deposit`,{amount:1000,requestId:randomUUID(),accountId:tim.id});
  assert.equal(foreignDeposit.status,400);
  assert.equal((await as(tim.id).get(`${path}/bank`)).body.balance,0);
  assert.equal(timGame.money,20000);assert.equal(benGame.money,20000);
  const foreignBid=await as(ben.id).post(`${path}/auctions/${auction.id}/bid`,{amount:10,accountId:tim.id});
  assert.equal(foreignBid.status,400);
  assert.equal((await as(ben.id).post(`${path}/auctions/${auction.id}/bid`,{amount:10})).status,200);
  const bids=((await as(tim.id).get(`${path}/auctions`)).body.auctions as LobbyAuction[]).find(a=>a.id===auction.id)!.bids;
  assert.deepEqual(bids.map(b=>b.accountId),[ben.id]);
 }finally{await close();}
});

test('browser payloads never carry secrets, memory addresses or the hidden stats of an open auction',async()=>{
 const {admin,ben,as,path,base,lobby,benGame,close}=await portalWithPlayers();
 const events:unknown[]=[];
 const dashboard=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:ben.id},transports:['websocket'],reconnection:false});
 dashboard.onAny((_event,payload)=>events.push(payload));
 try{
  await new Promise<void>((resolve,reject)=>{dashboard.once('connect',resolve);dashboard.once('connect_error',reject);});
  const auction=(await as(admin.id).post(`${path}/auctions`,{uncertainty:25})).body as LobbyAuction;
  await as(ben.id).post(`${path}/bank/deposit`,{amount:1000,requestId:randomUUID()});
  benGame.publish();await new Promise(r=>setTimeout(r,200));
  const responses=[
   (await as(ben.id).get(`/rooms/${lobby.id}/api/native-clients`)).body,
   (await as(ben.id).get(`${path}/auctions`)).body,
   (await as(ben.id).get(`${path}/bank`)).body,
   (await as(admin.id).get(`${path}/audit`)).body,
   (await as(ben.id).get(`${path}`)).body,
   events
  ];
  assert.equal((responses[0] as unknown[]).length,2,'both native clients are in the audited payload');
  assert.ok(events.length>0,'dashboard events are audited too');
  const serialized=JSON.stringify(responses);
  for(const forbidden of [ADMIN_TOKEN,'sessionToken','POKERACE_BRIDGE_TOKEN','romSha256','romPath','savePath','"address"','memoryDump'])
   assert.equal(serialized.includes(forbidden),false,forbidden);
  // While OPEN, only ranges are public: no template, no nickname of the generated Pokémon, no exact IV block.
  const open=JSON.stringify(responses[1]);
  assert.equal(auction.status,'OPEN');
  assert.doesNotMatch(open,/"template"|SECRET|"ivs":\{"hp":31/);
  assert.equal(((responses[1] as {auctions:LobbyAuction[]}).auctions[0]).revealed,null);
  // Once cancelled, the exact values may be revealed (current behaviour).
  await as(admin.id).post(`${path}/auctions/${auction.id}/cancel`);
  const cancelled=((await as(ben.id).get(`${path}/auctions`)).body.auctions as LobbyAuction[]).find(a=>a.id===auction.id)!;
  assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.revealed?.ivs.hp,31);
 }finally{dashboard.close();await close();}
});
