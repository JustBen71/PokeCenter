import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {passiveCatalog} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import type {PassiveHandler} from '../src/passives/passive-events.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

// Two test behaviours bound to real catalogue ids (no capability needed): order, idempotence, rewards.
const calls:string[]=[];
const handlers:Record<string,PassiveHandler>={
 rivalry:{
  on:{RUN_LOST:async(ctx,event)=>{calls.push(`rivalry:${event.id}`);ctx.set('losses',ctx.get('losses',0)+1);await ctx.reward(`test:${event.id}`,{type:'MONEY',amount:1000,reason:'test'});}},
  observe:ctx=>{ctx.set('seen',ctx.get('seen',0)+1);}
 },
 scout:{on:{RUN_LOST:ctx=>{calls.push('scout');},OBJECTIVE_COMPLETED:(ctx,event)=>{calls.push(`objective:${event.data.objectiveId}:${event.data.initial}`);}}}
};

test('passive engine: deterministic order, events processed once, rewards PENDING → CONFIRMED, REVIEW resolved without replay',async()=>{
 const store=new Store(':memory:');
 const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:300,
  passives:{implemented:new Set(passiveCatalog.map(p=>p.id)),handlers}});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const closers:(()=>void)[]=[];
 try{
  const app=portal.app;
  const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b)});
  const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
  await as(ben.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  const {passives,passiveEngine}=portal.services;
  // Granted out of catalogue order: the engine still evaluates in catalogue order (scout before rivalry).
  passives.grant(lobby.id,ben.id,'rivalry','ADMIN');passives.grant(lobby.id,ben.id,'scout','ADMIN');
  assert.ok(passiveCatalog.findIndex(p=>p.id==='scout')<passiveCatalog.findIndex(p=>p.id==='rivalry'));
  const runs=`/api/lobbies/${lobby.id}/runs`;
  const run1=(await as(admin.id).post(runs,{accountId:ben.id,start:true})).body;

  // Game offline: the event is processed, its reward waits (PENDING) instead of being lost.
  await as(admin.id).post(`${runs}/${run1.id}/status`,{status:'LOST'});
  await until(()=>calls.includes(`rivalry:run-lost:${run1.id}`),'run lost event');
  assert.deepEqual(calls,['scout',`rivalry:run-lost:${run1.id}`]);
  const reward=()=>store.db.prepare('SELECT status,attempts,command_id FROM passive_rewards WHERE account_id=?').get(ben.id) as {status:string;attempts:number;command_id:string|null};
  await until(()=>reward()?.status==='PENDING','pending reward');
  assert.equal(reward().attempts,0,'a missing game is not an attempt');

  // Replaying the same event (reconnection, double request) changes nothing.
  assert.equal(await passiveEngine.publish({lobbyId:lobby.id,accountId:ben.id,id:`run-lost:${run1.id}`,type:'RUN_LOST',data:{runId:run1.id}}),false);
  assert.equal(passives.progress(lobby.id,ben.id,'rivalry','losses',0),1);
  assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM passive_rewards').get() as {n:number}).n,1);

  // The game connects with a running Run: one controlled attempt, confirmed by the game.
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:2000});closers.push(()=>game.close());
  await as(admin.id).post(runs,{accountId:ben.id,start:true});
  await until(()=>reward().status==='CONFIRMED','reward paid');
  assert.equal(game.money,3000);
  assert.ok(passives.progress(lobby.id,ben.id,'rivalry','seen',0)>0,'game observation reaches the handler');
  const ledger=store.db.prepare("SELECT type,status,metadata_json FROM money_transactions WHERE account_id=? AND type='PASSIVE_REWARD'").all(ben.id) as {type:string;status:string;metadata_json:string}[];
  assert.equal(ledger.length,1);assert.equal(ledger[0].status,'CONFIRMED');
  assert.deepEqual(Object.keys(JSON.parse(ledger[0].metadata_json)).sort(),['eventId','passiveId','reason']);
  game.publish();await new Promise(r=>setTimeout(r,100));
  assert.equal(game.money,3000,'never paid twice');

  // Lost confirmation: REVIEW, no automatic retry; the admin resolution confirms it.
  game.mode='ack-lost';
  const run2=(await as(admin.id).get(runs)).body.find((r:{status:string;accountId:string})=>r.status==='RUNNING'&&r.accountId===ben.id);
  await as(admin.id).post(`${runs}/${run2.id}/status`,{status:'LOST'});
  const second=()=>store.db.prepare("SELECT status,command_id FROM passive_rewards WHERE event_id=?").get(`test:run-lost:${run2.id}`) as {status:string;command_id:string}|undefined;
  await until(()=>second()?.status==='PENDING','second reward pending (no Run)');
  // No running Run anymore: the reward waits; the next Run lets it through, with a lost ACK.
  await as(admin.id).post(runs,{accountId:ben.id,start:true});
  await until(()=>second()?.status==='REVIEW','review');
  const money=game.money;game.mode='apply';game.publish();await new Promise(r=>setTimeout(r,150));
  assert.equal(second()!.status,'REVIEW','never retried automatically');assert.equal(game.money,money);
  assert.equal((await as(admin.id).post(`/api/lobbies/${lobby.id}/game-commands/${second()!.command_id}/resolve`,{applied:true})).status,200);
  assert.equal(second()!.status,'CONFIRMED');

  // Objective events: the first completions of a player are a catch-up (initial), later ones are race moves.
  await until(()=>calls.includes('objective:starter:true'),'initial objective');
  game.completed=['starter','rival103'];game.publish();
  await until(()=>calls.includes('objective:rival103:false'),'new objective');
  const logs=(await as(admin.id).get(`/api/lobbies/${lobby.id}/audit?category=PASSIVE`)).body as {action:string}[];
  assert.ok(logs.some(l=>l.action==='passive.reward'));
 }finally{for(const c of closers)c();await new Promise<void>(r=>portal.server.close(()=>r()));}
});
