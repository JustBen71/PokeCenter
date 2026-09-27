import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {io as client,type Socket} from 'socket.io-client';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
import {auctionHints} from '../src/auction-hints.js';
import type {PokemonInjection} from '@pokerace/shared';

test('account selection, declared roles, own bids and agent-name binding',async()=>{
 const store=new Store(':memory:');const {app,server,io}=createApp(store,{roomCode:'123',adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000});const sockets:Socket[]=[];
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  assert.equal((await request(app).get('/api/players')).status,401);
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'brendan',admin:true})).body;
  const timeo=(await request(app).post('/api/accounts').send({name:'Timéo',sprite:'pokemon-255',admin:false})).body;
  assert.equal((await request(app).post('/api/accounts').send({name:' timeo ',sprite:'red',admin:false})).status,409);
  assert.equal((await request(app).post('/api/accounts').send({name:'Bad',sprite:'../../file',admin:false})).status,400);
  assert.equal((await request(app).post('/api/accounts').send({name:'Hors jeu',sprite:'pokemon-387',admin:false})).status,400);
  const post=(path:string,actor:string,body:unknown={})=>request(app).post(path).set('x-account-id',actor).send(body);
  assert.equal((await post('/api/auctions',timeo.id)).status,403);
  assert.equal((await post('/api/auctions/fake/accept',timeo.id)).status,403);
  const gag={name:'Chanter',weight:1,enabled:true,action:'gag.notice',blocks:{text:'Chanter'}};
  assert.equal((await post('/api/roulette/gags',timeo.id,gag)).status,403);
  assert.equal((await post('/api/roulette/gags',ben.id,gag)).status,201);
  assert.equal((await post('/api/auctions/fake/bid',timeo.id,{playerId:ben.id,amount:1})).status,403);
  assert.equal((await post('/api/roulette/draw',timeo.id,{spinnerId:ben.id})).status,403);
  const open=(accountName:string,wireId:string)=>{const s=client(base+'/agent',{auth:{playerId:wireId,playerName:accountName,accountName,roomCode:'123'},transports:['websocket'],reconnection:false});sockets.push(s);return s;};
  const agent=open('TIMEO','installation-1');await new Promise<void>((r,j)=>{agent.once('connect',r);agent.once('connect_error',j);});
  const state={protocolVersion:1,playerId:'installation-1',playerName:'spoofed',game:{name:'pokemon-emerald',language:'fr',profileId:'test',romStatus:'recognized'},trainer:{name:'TEST',partyCount:0,money:3000},location:null,party:[],observedAt:new Date().toISOString()};
  assert.equal((await agent.emitWithAck('telemetry',{type:'state',data:state})).ok,true);
  const rows=(await request(app).get('/api/players').set('x-account-id',timeo.id)).body;
  assert.equal(rows[0].playerId,timeo.id);assert.equal(rows[0].state.playerName,'Timéo');assert.equal(rows[0].account.sprite,'pokemon-255');assert.equal(rows[0].connected,true);
  assert.equal((await agent.emitWithAck('telemetry',{type:'heartbeat',protocolVersion:1,playerId:ben.id,observedAt:new Date().toISOString()})).ok,false);
  const duplicate=open('Timéo','installation-2');await new Promise<void>((r,j)=>{duplicate.once('connect_error',()=>r());duplicate.once('connect',()=>j(Error('duplicate account')));});
  const missing=open('Inconnu','installation-3');await new Promise<void>((r,j)=>{missing.once('connect_error',()=>r());missing.once('connect',()=>j(Error('unknown account')));});
  assert.equal((await request(app).patch(`/api/accounts/${timeo.id}`).set('x-account-id',timeo.id).send({name:'Timéo',sprite:'may',admin:false})).status,200);
  assert.equal((await request(app).get('/api/players').set('x-account-id',timeo.id)).body[0].account.sprite,'may');
 }finally{sockets.forEach(s=>s.close());await new Promise<void>(r=>io.close(()=>r()));store.close();}
});

test('uncertainty intervals contain true values, respect limits and permit exact disclosure',()=>{
 const p={ivs:{hp:0,attack:31,defense:15},evs:{hp:0,attack:255,defense:100},stats:{maxHp:1,attack:999,defense:80}} as PokemonInjection;
 for(const percent of [0,5,25,100])for(const random of [()=>0,(max:number)=>max-1]){
  const hints=auctionHints(p,percent,random);
  for(const group of ['ivs','evs','stats'] as const)for(const [key,value] of Object.entries(p[group])){
   const range=hints[group][key];assert.ok(range.min<=value&&range.max>=value);assert.ok(range.min>=(group==='stats'?1:0));assert.ok(range.max<=({ivs:31,evs:255,stats:999}[group]));
   if(percent===0)assert.deepEqual(range,{min:value,max:value});
  }
 }
});
