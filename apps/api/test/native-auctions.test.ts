import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {nativeClient} from '../../../packages/shared/test/native-fixture.js';
import {auctionParticipants} from '../src/auction-participants.js';
import {generateLot} from '../src/auction-generator.js';
import {registerAuctions} from '../src/auction-routes.js';
import {registerAccounts} from '../src/accounts.js';
import {Store} from '../src/store.js';
import type {BuiltPokemon,PokemonInjection} from '@pokerace/shared';
import {encodePokemon,nativeDisplayState} from '@pokerace/shared';
import {createApp} from '../src/app.js';
import {io as connect} from 'socket.io-client';

const build=async(form:PokemonInjection):Promise<BuiltPokemon>=>({name:'Bulbizarre',stats:{maxHp:20,attack:10,defense:10,speed:10,spAttack:10,spDefense:10},moves:[{id:33,pp:35},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],experience:100,choices:[]});
test('one native player can bid, receive one purchase command, and save an exact party copy',async()=>{
 const store=new Store(':memory:');const {app,server,io,nativeClients}=createApp(store,{roomCode:'solo',adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000});
 store.putAccount({id:'p-ben',name:'Ben',admin:true,sprite:'red'},'ben');
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const socket=connect(`http://127.0.0.1:${(server.address() as {port:number}).port}/client`,{transports:['websocket'],auth:{protocolVersion:1,playerId:'installation-ben',playerName:'Ben',roomCode:'solo'}});
 try{
  await new Promise<void>((r,j)=>{socket.once('connect',r);socket.once('connect_error',j);});
  const native=nativeClient();native.lastSeenAt=new Date().toISOString();native.accountId='p-ben';
  const lot=await generateLot(auctionParticipants([],[native]),()=>0,build);
  native.gameState!.party[0].artifact={format:'gen3-party-v1',raw:encodePokemon(lot.template)};
  socket.emit('HELLO',{type:'HELLO',protocolVersion:1,clientVersion:'test',playerId:'installation-ben',platform:'windows',bridge:native.bridge,emulator:{name:'BizHawk'},system:'GBA'});
  socket.emit('CLIENT_STATUS',{type:'CLIENT_STATUS',protocolVersion:1,connected:true,allowMemoryWrites:false,canPurchase:true});
  socket.emit('GAME_STATE',{type:'GAME_STATE',protocolVersion:1,gameStateVersion:2,adapter:native.adapter,state:native.gameState});
  for(let i=0;i<100&&!nativeClients.publicSnapshot()[0]?.gameState;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(nativeClients.publicSnapshot()[0]?.gameState);
  store.putAuction({...lot,id:'solo-auction',createdAt:new Date().toISOString(),status:'open',bids:[],log:[],uncertainty:25});
  const post=(path:string,body:unknown)=>request(app).post(path).set('x-account-id','p-ben').send(body);
  assert.equal((await post('/api/auctions/solo-auction/bid',{playerId:'p-ben',amount:100})).status,200);
  const received:any[]=[];
  socket.on('COMMAND',command=>{received.push(command);socket.emit('COMMAND_ACK',{type:'COMMAND_ACK',protocolVersion:1,commandId:command.commandId,ok:true,result:{verified:true}});});
  const accept=()=>post('/api/auctions/solo-auction/accept',{playerId:'p-ben',amount:100});
  assert.equal((await accept()).body.status,'sold');assert.equal((await accept()).body.status,'sold');assert.equal(received.length,1);
  assert.equal(received[0].command,'pokemon.purchase');assert.equal(received[0].payload.price,100);assert.equal(received[0].payload.expectedMoney,12500);
  const pokemon=nativeDisplayState(nativeClients.publicSnapshot()[0].gameState!).party[0];
  const saved=await post('/api/library',{label:'Mon Pokémon',pokemon,source:'Ben',capturedAt:native.gameState!.observedAt});
  assert.equal(saved.status,201);assert.equal(store.library()[0].pokemon!.raw,pokemon.raw);
 }finally{socket.close();await new Promise<void>(r=>io.close(()=>r()));store.close();}
});
test('administrator with only BizHawk can create and cancel an auction, without enabling unsupported purchases',async()=>{
 const store=new Store(':memory:'),app=express();app.use(express.json());registerAccounts(app,store);
 const native=nativeClient();native.lastSeenAt=new Date().toISOString();
 store.putAccount({id:native.accountId,name:'Ben',admin:true,sprite:'red'},'ben');
 store.putAccount({id:'p-other',name:'Other',admin:false,sprite:'may'},'other');
 let sends=0;
 registerAuctions(app,store,()=>[],async()=>{sends++;},new Set(),players=>generateLot(players,()=>0,build),()=>auctionParticipants([],[native]));
 const post=(path:string,id:string,body:unknown={})=>request(app).post(path).set('x-account-id',id).send(body);
 try{
  assert.equal((await post('/api/auctions','p-other')).status,403);
  const created=await post('/api/auctions',native.accountId);assert.equal(created.status,201);
  assert.equal(created.body.level,5);assert.equal(created.body.sampleSize,1);
  assert.equal((await post(`/api/auctions/${created.body.id}/bid`,native.accountId,{playerId:native.accountId,amount:100})).status,409);
  assert.equal((await post(`/api/auctions/${created.body.id}/cancel`,native.accountId)).status,200);
  assert.equal(sends,0);
 }finally{store.close();}
});
test('auction sampling deduplicates accounts and ignores stale or unready native teams',()=>{
 const native=nativeClient();native.lastSeenAt=new Date().toISOString();
 const legacy=auctionParticipants([],[native])[0];legacy.state.party=[{...legacy.state.party[0],level:30}];
 const merged=auctionParticipants([legacy],[native]);assert.equal(merged.length,1);assert.equal(merged[0].state.party[0].level,5);
 native.lastSeenAt='2000-01-01T00:00:00.000Z';assert.deepEqual(auctionParticipants([],[native]),[]);assert.equal(auctionParticipants([legacy],[native])[0],legacy);
 native.lastSeenAt=new Date().toISOString();native.bridge.connected=false;assert.deepEqual(auctionParticipants([],[native]),[]);
});
