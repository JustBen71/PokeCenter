import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import type {JackpotSnapshot,WheelResolution,WheelType} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

test('jackpot: automatic contributions with sources, admin adjustments and one payout at a time',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:400});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const closers:(()=>void)[]=[];
 try{
  const app=portal.app;
  const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const tim=(await request(app).post('/api/accounts').send({name:'Tim',sprite:'may',admin:false})).body;
  const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b),patch:(p:string,b:object)=>request(app).patch(p).set('x-account-id',id).send(b)});
  const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
  for(const p of [ben,tim])await as(p.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  await as(admin.id).patch(`/api/lobbies/${lobby.id}/settings`,{bankDepositTaxPercent:10,shopJackpotPercent:50});
  const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:20000});closers.push(()=>benGame.close());
  const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',money:20000});closers.push(()=>timGame.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money&&!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'games');
  for(const p of [ben,tim])await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:p.id,start:true});
  const jackpot=`/api/lobbies/${lobby.id}/jackpot`;

  // Contributions: bank tax (10 % of 10 000) and shop (50 % of a 1 000 ticket).
  await as(ben.id).post(`/api/lobbies/${lobby.id}/bank/deposit`,{amount:10000,requestId:randomUUID()});
  const wheels=(await as(tim.id).get(`/api/lobbies/${lobby.id}/shop`)).body.wheels as WheelType[];
  await as(tim.id).post(`/api/lobbies/${lobby.id}/shop/tickets`,{wheelId:wheels[0].id,requestId:randomUUID()});
  let snapshot=(await as(ben.id).get(jackpot)).body as JackpotSnapshot;
  assert.equal(snapshot.balance,1000+wheels[0].price/2);
  assert.deepEqual(snapshot.sources.map(s=>s.reason).sort(),['bank_deposit_tax','shop']);
  assert.equal(snapshot.totalIn,snapshot.balance);assert.equal(snapshot.totalOut,0);

  // Admin adjustments: recorded, admin only, never below zero.
  assert.equal((await as(ben.id).post(`${jackpot}/adjust`,{operation:'add',amount:500,reason:'cadeau'})).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await as(admin.id).post(`${jackpot}/adjust`,{operation:'add',amount:500,reason:'Bonus de lancement'})).body.status,'CONFIRMED');
  assert.equal((await as(admin.id).post(`${jackpot}/adjust`,{operation:'remove',amount:99999,reason:'trop'})).body.error.code,'INSUFFICIENT_FUNDS');
  snapshot=(await as(ben.id).get(jackpot)).body;
  const total=snapshot.balance;assert.equal(total,2000);
  assert.ok(snapshot.sources.some(s=>s.reason==='admin'&&s.amount===500));

  // Two "empty the jackpot" gages at once: the jackpot lock lets only one pay; the other stays pending.
  const pot=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,{name:'Pot',price:0,icon:'green-3',tone:'GOOD',gages:[{name:'Pot',handler:'JACKPOT_EMPTY',params:{}}]})).body as WheelType;
  const spin=async(owner:string)=>(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels/${pot.id}/spin`,{ownerId:owner})).body as WheelResolution;
  const first=await spin(ben.id),second=await spin(tim.id);
  await until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).game.money===10000,'ben sync');
  benGame.mode='timeout';
  const slow=as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${first.id}/apply`).then(r=>r);
  await until(()=>benGame.received.some(c=>c.command==='game.money.add'),'first payout in flight');
  const busy=await as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${second.id}/apply`);
  assert.equal(busy.body.error.code,'PLAYER_BUSY');
  assert.equal((await slow).body.error.code,'COMMAND_OUTCOME_UNKNOWN');
  // The uncertain payout does not empty the server balance until it is checked.
  assert.equal((await as(ben.id).get(jackpot)).body.balance,total);
  const review=store.portal!.ledger.list(lobby.id,{status:'REVIEW'})[0];
  assert.equal(review.type,'JACKPOT_REWARD');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/game-commands/${review.commandId}/resolve`,{applied:true});
  snapshot=(await as(ben.id).get(jackpot)).body;
  assert.equal(snapshot.balance,0);assert.equal(snapshot.totalOut,total);
  assert.equal(snapshot.recent[0].type,'JACKPOT_REWARD');
  // Tim's gage, retried later, finds an empty pot and pays nothing.
  assert.match((await as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${second.id}/apply`)).body.result,/vide/);
  assert.equal(timGame.received.filter(c=>c.command==='game.money.add').length,0);
  assert.ok(store.portal!.audit.list({category:'JACKPOT'}).length>=2);
 }finally{closers.forEach(c=>c());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
