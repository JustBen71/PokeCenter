import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {io as client} from 'socket.io-client';
import type {ObjectivesSnapshot} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

test('lobby objectives are seeded, completed once and rewarded exactly once through the game',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:300});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const closers:(()=>void)[]=[];
 try{
  const app=portal.app;
  const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b),patch:(p:string,b:object)=>request(app).patch(p).set('x-account-id',id).send(b)});
  const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
  await as(ben.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  const objectives=`/api/lobbies/${lobby.id}/objectives`;

  const seeded=(await as(ben.id).get(objectives)).body as ObjectivesSnapshot;
  assert.ok(seeded.objectives.length>10);assert.equal(seeded.objectives[0].id,'starter');
  assert.deepEqual(seeded.objectives[0].gameCondition,{type:'progression',objectiveId:'starter'});
  assert.equal((await as(ben.id).patch(`${objectives}/badge1`,{rewardMoney:1000})).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await as(admin.id).patch(`${objectives}/badge1`,{rewardMoney:1000})).body.rewardMoney,1000);
  assert.equal((await as(admin.id).patch(`${objectives}/nope`,{rewardMoney:1})).body.error.code,'NOT_FOUND');

  const dashboard=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:ben.id},transports:['websocket'],reconnection:false});closers.push(()=>dashboard.close());
  let live:ObjectivesSnapshot|null=null;dashboard.on('objectives',(s:ObjectivesSnapshot)=>{live=s;});

  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben'});closers.push(()=>game.close());
  const completion=(id:string)=>portal.services.objectives.completions(lobby.id).find(c=>c.objectiveId===id&&c.accountId===ben.id);
  await until(()=>completion('starter')?.rewardStatus==='NONE','starter completion');

  // Reached without a running Run: recorded, reward kept pending.
  game.completed=['starter','badge1'];game.publish();
  await until(()=>completion('badge1')?.rewardStatus==='PENDING','pending reward');
  assert.equal(game.money,12500);assert.equal(game.received.length,0);

  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  game.publish();
  await until(()=>completion('badge1')?.rewardStatus==='PAID','paid reward');
  assert.equal(game.money,13500);
  assert.equal(game.received.filter(c=>c.command==='game.money.add').length,1);
  // New observations (same flags) never pay again.
  for(let i=0;i<3;i++){game.publish();await new Promise(r=>setTimeout(r,30));}
  assert.equal(game.received.length,1);assert.equal(game.money,13500);
  const rewards=store.portal!.ledger.list(lobby.id).filter(t=>t.type==='OBJECTIVE_REWARD');
  assert.equal(rewards.length,1);assert.equal(rewards[0].status,'CONFIRMED');
  await until(()=>!!live&&live.completions.some(c=>c.objectiveId==='badge1'&&c.rewardStatus==='PAID'),'live snapshot');
  assert.equal(store.portal!.audit.list({category:'MONEY'}).filter(l=>l.action==='objective.reward').length,1);
 }finally{closers.forEach(c=>c());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
