import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {depositSplit} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

test('deposit splits taxes into the jackpot, withdrawal pays back, bank survives Runs, replays and races are safe',async()=>{
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
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:20000});closers.push(()=>game.close());
  await until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).game.money===20000,'game state');
  const run=(await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true})).body;
  const bank=`/api/lobbies/${lobby.id}/bank`;
  const synced=(money:number)=>until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).game.money===money,`money ${money}`);

  // Settings: 10 % by default, admin only.
  assert.equal((await as(ben.id).get(`/api/lobbies/${lobby.id}/settings`)).body.bankDepositTaxPercent,10);
  assert.equal((await as(ben.id).patch(`/api/lobbies/${lobby.id}/settings`,{bankDepositTaxPercent:0})).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await as(admin.id).patch(`/api/lobbies/${lobby.id}/settings`,{bankDepositTaxPercent:101})).body.error.code,'VALIDATION_FAILED');
  assert.deepEqual(depositSplit(10000,10),{bank:9000,tax:1000});assert.deepEqual(depositSplit(15,10),{bank:14,tax:1});

  const requestId=randomUUID();
  const deposit=(await as(ben.id).post(`${bank}/deposit`,{amount:10000,requestId})).body;
  assert.equal(deposit.status,'CONFIRMED');assert.equal(game.money,10000);
  let snapshot=(await as(ben.id).get(bank)).body;
  assert.equal(snapshot.balance,9000);assert.equal(snapshot.jackpot,1000);
  assert.deepEqual(snapshot.history.map((t:{type:string})=>t.type).sort(),['BANK_DEPOSIT','JACKPOT_CONTRIBUTION']);
  // The same click replayed: no second game command, same result.
  assert.equal((await as(ben.id).post(`${bank}/deposit`,{amount:10000,requestId})).body.status,'CONFIRMED');
  assert.equal(game.received.length,1);assert.equal((await as(ben.id).get(bank)).body.balance,9000);
  await synced(10000);

  assert.equal((await as(ben.id).post(`${bank}/withdraw`,{amount:9001,requestId:randomUUID()})).body.error.code,'INSUFFICIENT_FUNDS');
  assert.equal((await as(ben.id).post(`${bank}/deposit`,{amount:10001,requestId:randomUUID()})).body.error.code,'INSUFFICIENT_FUNDS');
  assert.equal(game.received.length,1,'refused before any game command');

  // The bank belongs to lobby + account: a lost Run does not touch it.
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs/${run.id}/status`,{status:'LOST'});
  assert.equal((await as(ben.id).post(`${bank}/withdraw`,{amount:5000,requestId:randomUUID()})).body.error.code,'RUN_NOT_RUNNING');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  const withdraw=(await as(ben.id).post(`${bank}/withdraw`,{amount:5000,requestId:randomUUID()})).body;
  assert.equal(withdraw.status,'CONFIRMED');assert.equal(game.money,15000);
  snapshot=(await as(ben.id).get(bank)).body;assert.equal(snapshot.balance,4000);assert.equal(snapshot.jackpot,1000);
  await synced(15000);

  // Two simultaneous withdrawals of the whole bank: one passes, the other is refused (player lock).
  game.mode='timeout';
  const first=as(ben.id).post(`${bank}/withdraw`,{amount:4000,requestId:randomUUID()}).then(r=>r);
  await until(()=>game.received.length===3,'first withdraw sent');
  const second=await as(ben.id).post(`${bank}/withdraw`,{amount:4000,requestId:randomUUID()});
  assert.equal(second.body.error.code,'PLAYER_BUSY');
  assert.equal((await first).body.error.code,'COMMAND_OUTCOME_UNKNOWN');
  // Unknown outcome: the bank is not debited until an admin confirms.
  assert.equal((await as(ben.id).get(bank)).body.balance,4000);
  const review=store.portal!.ledger.list(lobby.id,{status:'REVIEW'});
  assert.equal(review.length,1);assert.equal(review[0].type,'BANK_WITHDRAW');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/game-commands/${review[0].commandId}/resolve`,{applied:false});
  assert.equal((await as(ben.id).get(bank)).body.balance,4000);
  assert.equal(store.portal!.audit.list({category:'BANK',status:'SUCCESS'}).length,2);
  // Jackpot is public to members.
  assert.equal((await as(ben.id).get(`/api/lobbies/${lobby.id}/jackpot`)).body.balance,1000);
 }finally{closers.forEach(c=>c());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
