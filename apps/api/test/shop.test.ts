import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import type {ShopSnapshot,WheelResolution,WheelTicket,WheelType} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

const pause=()=>new Promise(r=>setTimeout(r,5));

test('shop: tickets paid in game, persistent queue, protections only block attacks received after their purchase',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:300});
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
  await as(admin.id).patch(`/api/lobbies/${lobby.id}/settings`,{shopJackpotPercent:10,protectionPrice:1000});
  const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:10000});closers.push(()=>benGame.close());
  const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',money:10000});closers.push(()=>timGame.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money&&!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'games');
  for(const p of [ben,tim])await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:p.id,start:true});
  const shop=`/api/lobbies/${lobby.id}/shop`;
  const synced=(id:string,money:number)=>until(()=>portal.services.currentGame.resolve(lobby.id,id).game.money===money,`money ${money}`);
  const catalog=(await as(tim.id).get(shop)).body as ShopSnapshot;
  const [good,bad]=catalog.wheels as WheelType[];
  assert.equal(good.tone,'GOOD');assert.equal(bad.tone,'BAD');assert.equal(catalog.protectionPrice,1000);
  const buy=(id:string,body:object)=>as(id).post(`${shop}/tickets`,{requestId:randomUUID(),...body});

  assert.equal((await buy(tim.id,{wheelId:bad.id})).body.error.code,'VALIDATION_FAILED','hostile wheel needs a target');
  assert.equal((await buy(tim.id,{wheelId:bad.id,targetId:tim.id})).body.error.code,'VALIDATION_FAILED','not yourself');

  // Ben protects himself first, then Tim attacks him: the protection predates the attack.
  assert.equal((await as(ben.id).post(`${shop}/protections`,{requestId:randomUUID()})).body.status,'ACTIVE');
  assert.equal(benGame.money,9000);await pause();
  const requestId=randomUUID();
  const attack=(await as(tim.id).post(`${shop}/tickets`,{wheelId:bad.id,targetId:ben.id,requestId})).body as WheelTicket;
  assert.equal(attack.status,'QUEUED');assert.equal(attack.recipientId,ben.id);assert.equal(timGame.money,10000-bad.price);
  // Replaying the purchase returns the same ticket without paying twice.
  assert.equal((await as(tim.id).post(`${shop}/tickets`,{wheelId:bad.id,targetId:ben.id,requestId})).body.id,attack.id);
  assert.equal(timGame.received.length,1);
  assert.equal(store.portal!.ledger.jackpotBalance(lobby.id),100+bad.price/10,'10 % of each purchase');

  assert.equal((await as(tim.id).post(`${shop}/tickets/${attack.id}/resolve`)).body.error.code,'ADMIN_REQUIRED');
  const blocked=(await as(admin.id).post(`${shop}/tickets/${attack.id}/resolve`)).body as WheelResolution;
  assert.equal(blocked.status,'BLOCKED');assert.match(blocked.result!,/protégé/);
  let benShop=(await as(ben.id).get(shop)).body as ShopSnapshot;
  assert.equal(benShop.protections[0].status,'USED');assert.equal(benShop.tickets.find(t=>t.id===attack.id)?.status,'BLOCKED');
  assert.equal(benGame.received.length,1,'nothing happened in Ben’s game');

  // Attack received first, protection bought afterwards: this wheel is not blocked, the next one is.
  await synced(tim.id,10000-bad.price);
  const second=(await buy(tim.id,{wheelId:bad.id,targetId:ben.id})).body as WheelTicket;await pause();
  await synced(ben.id,9000);
  await as(ben.id).post(`${shop}/protections`,{requestId:randomUUID()});await pause();
  await synced(tim.id,10000-2*bad.price);
  const third=(await buy(tim.id,{wheelId:bad.id,targetId:ben.id})).body as WheelTicket;
  const queue=((await as(admin.id).get(shop)).body as ShopSnapshot).queue.map(t=>t.id);
  assert.deepEqual(queue,[second.id,third.id],'queue in reception order');
  const notBlocked=(await as(admin.id).post(`${shop}/tickets/${second.id}/resolve`)).body as WheelResolution;
  assert.notEqual(notBlocked.status,'BLOCKED');
  assert.equal((await as(admin.id).post(`${shop}/tickets/${second.id}/resolve`)).body.error.code,'CONFLICT','resolved once');
  assert.equal(((await as(admin.id).post(`${shop}/tickets/${third.id}/resolve`)).body as WheelResolution).status,'BLOCKED');

  // A kind wheel waits in the buyer's own queue.
  await synced(ben.id,8000);
  const gift=(await buy(ben.id,{wheelId:good.id})).body as WheelTicket;
  assert.equal(gift.recipientId,ben.id);assert.equal(gift.targetId,null);

  // Not enough money: refused before any game command and cancelled.
  await synced(ben.id,8000-good.price);
  const poor=await buy(ben.id,{wheelId:bad.id,targetId:tim.id});
  assert.equal(poor.status,201);
  await synced(ben.id,8000-good.price-bad.price);
  benGame.money=10;benGame.publish();await synced(ben.id,10);
  const refused=await buy(ben.id,{wheelId:bad.id,targetId:tim.id});
  assert.equal(refused.body.error.code,'INSUFFICIENT_FUNDS');
  benShop=(await as(ben.id).get(shop)).body as ShopSnapshot;
  assert.equal(benShop.tickets.filter(t=>t.status==='CANCELLED').length,1);

  // Uncertain payment: the ticket waits for the admin check, then joins the queue.
  timGame.mode='timeout';
  const uncertainId=randomUUID();
  assert.equal((await as(tim.id).post(`${shop}/tickets`,{wheelId:good.id,requestId:uncertainId})).body.error.code,'COMMAND_OUTCOME_UNKNOWN');
  let timShop=(await as(tim.id).get(shop)).body as ShopSnapshot;
  const pending=timShop.tickets.find(t=>t.id===uncertainId)!;assert.equal(pending.status,'PAYMENT_REVIEW');
  const review=store.portal!.ledger.list(lobby.id,{status:'REVIEW'})[0];
  await as(admin.id).post(`/api/lobbies/${lobby.id}/game-commands/${review.commandId}/resolve`,{applied:true});
  timShop=(await as(tim.id).get(shop)).body as ShopSnapshot;
  assert.equal(timShop.tickets.find(t=>t.id===uncertainId)!.status,'QUEUED');
  assert.ok(store.portal!.audit.list({category:'PROTECTION'}).length>=2);
 }finally{closers.forEach(c=>c());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
