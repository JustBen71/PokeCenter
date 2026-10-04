import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type {BuiltPokemon,LobbyAuction,PokemonInjection} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {generateLot} from '../src/auction-generator.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

const build=async(form:PokemonInjection):Promise<BuiltPokemon>=>({name:'Bulbizarre',stats:{maxHp:24,attack:12,defense:11,speed:10,spAttack:13,spDefense:12},moves:[{id:33,pp:35},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],experience:135,choices:[]});

test('auctions: hidden stats, safe bids, admin closing paid in game with jackpot share, review and library copy',async()=>{
 const store=new Store(':memory:');
 const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:300,auctionGenerator:players=>generateLot(players,()=>3,build)});
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
  await as(admin.id).patch(`/api/lobbies/${lobby.id}/settings`,{auctionJackpotPercent:10});
  const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:5000});closers.push(()=>benGame.close());
  const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',money:800});closers.push(()=>timGame.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money&&!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'games');
  for(const p of [ben,tim])await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:p.id,start:true});
  const auctions=`/api/lobbies/${lobby.id}/auctions`;

  assert.equal((await as(ben.id).post(auctions,{uncertainty:25})).body.error.code,'ADMIN_REQUIRED');
  const lot=(await as(admin.id).post(auctions,{uncertainty:25})).body as LobbyAuction;
  assert.equal(lot.status,'OPEN');assert.equal(lot.level,5);assert.equal(lot.revealed,null);
  // The browser never receives the exact stats while bidding.
  const listed=(await as(ben.id).get(auctions)).body;
  assert.doesNotMatch(JSON.stringify(listed),/"template"|"ivs":\{"hp":\d/);
  assert.ok(lot.hints.stats.attack.min<=12&&lot.hints.stats.attack.max>=12);
  assert.equal((await as(admin.id).post(auctions,{})).body.error.code,'CONFLICT');

  const bid=(id:string,amount:number)=>as(id).post(`${auctions}/${lot.id}/bid`,{amount});
  assert.equal((await as(admin.id).post(`${auctions}/${lot.id}/close`)).body.error.code,'CONFLICT','no bid yet');
  assert.equal((await bid(ben.id,0)).body.error.code,'VALIDATION_FAILED');
  assert.equal((await bid(tim.id,900)).body.error.code,'INSUFFICIENT_FUNDS');
  assert.equal((await bid(tim.id,500)).body.bids.length,1);
  // Two simultaneous bids at the same amount: exactly one wins the slot.
  const [a,b]=await Promise.all([bid(ben.id,700),bid(tim.id,700)]);
  assert.equal([a.status,b.status].filter(s=>s===200).length,1);
  assert.equal((await bid(ben.id,600)).body.error.code,'CONFLICT');
  assert.equal((await bid(ben.id,1000)).status,200);
  assert.equal((await as(ben.id).post(`${auctions}/${lot.id}/close`)).body.error.code,'ADMIN_REQUIRED');

  // Closing: one purchase command (debit + insertion) for the best bid, 10 % to the jackpot.
  const sold=(await as(admin.id).post(`${auctions}/${lot.id}/close`)).body as LobbyAuction;
  assert.equal(sold.status,'SOLD');assert.deepEqual(sold.winner,{accountId:ben.id,name:'Ben',price:1000});
  assert.equal(benGame.money,4000);assert.equal(benGame.party.length,2);
  assert.equal(benGame.received[0].command,'pokemon.purchase');assert.equal(benGame.received[0].payload.expectedCount,1);
  assert.equal(timGame.received.length,0);
  const ledger=store.portal!.ledger.list(lobby.id).filter(t=>t.accountId===ben.id);
  assert.deepEqual(ledger.map(t=>[t.type,t.amount,t.status]).sort(),[['AUCTION_PAYMENT',900,'CONFIRMED'],['JACKPOT_CONTRIBUTION',100,'CONFIRMED']]);
  assert.equal(store.portal!.ledger.jackpotBalance(lobby.id),100);
  assert.equal(sold.revealed?.stats.attack,12,'revealed once sold');
  assert.equal((await as(admin.id).post(`${auctions}/${lot.id}/close`)).body.error.code,'CONFLICT','closed only once');
  const copy=(await as(admin.id).post(`${auctions}/${lot.id}/library`)).body;
  assert.equal(copy.artifact.format,'gen3-template-v1');

  // A lost confirmation leaves the auction in REVIEW until an admin checks the game.
  await until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).game.money===4000,'ben refresh');
  const second=(await as(admin.id).post(auctions,{uncertainty:0})).body as LobbyAuction;
  assert.equal(second.hints.stats.attack.min,second.hints.stats.attack.max);
  await as(ben.id).post(`${auctions}/${second.id}/bid`,{amount:50});
  benGame.mode='timeout';
  assert.equal((await as(admin.id).post(`${auctions}/${second.id}/close`)).body.error.code,'COMMAND_OUTCOME_UNKNOWN');
  const review=(await as(admin.id).get(auctions)).body.auctions[0] as LobbyAuction;
  assert.equal(review.status,'REVIEW');assert.equal(review.revealed,null);
  assert.equal((await as(admin.id).post(auctions,{})).body.error.code,'CONFLICT','blocked while in review');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/game-commands/${review.commandId}/resolve`,{applied:false});
  const reopened=(await as(admin.id).get(auctions)).body.auctions[0] as LobbyAuction;
  assert.equal(reopened.status,'OPEN');assert.equal(reopened.winner,null);
  assert.equal((await as(admin.id).post(`${auctions}/${second.id}/cancel`)).body.status,'CANCELLED');
  assert.ok(store.portal!.audit.list({category:'AUCTION'}).length>=4);
 }finally{closers.forEach(c=>c());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
