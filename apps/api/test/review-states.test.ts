import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import type {LobbyAuction,ObjectivesSnapshot,ShopSnapshot,WheelType} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));

// The game applied the write but its acknowledgement is lost: every business flow must stop in REVIEW,
// never retry by itself, list the command for the admin, and end consistent after the admin's decision.
test('lost ACK after a real write: REVIEW, no automatic retry, admin decides, final state consistent (bank, shop, auction, objective)',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:300,
  auctionGenerator:async()=>({speciesId:1,name:'Bulbizarre',level:5,sampleSize:1,template:{playerId:'fake',slot:1,speciesId:1,nickname:'BULBI',level:5,experience:135,currentHp:20,
   stats:{maxHp:20,attack:10,defense:10,speed:10,spAttack:10,spDefense:10},moves:[{id:33,pp:35},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],heldItem:0,abilitySlot:0,nature:3,friendship:70,
   otName:'FAKE',trainerId:1,secretId:2,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},shiny:false}})});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 let game:FakeGameClient|undefined;
 try{
  const app=portal.app;
  const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b),patch:(p:string,b:object)=>request(app).patch(p).set('x-account-id',id).send(b)});
  const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
  const path=`/api/lobbies/${lobby.id}`;
  await as(ben.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:50000});
  await until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).game.money===50000,'game state');
  await as(admin.id).post(`${path}/runs`,{accountId:ben.id,start:true});
  const synced=(money:number)=>until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).game.money===money,`money ${money}`);
  const reviews=async()=>(await as(admin.id).get(`${path}/game-commands?status=REVIEW`)).body as {id:string;command:string;moneyTypes:string[]}[];
  // Common checks for one lost acknowledgement, then the admin's decision.
  const expectReview=async(label:string,applied:boolean)=>{
   const [command]=await reviews();
   assert.ok(command,`${label}: command listed for the admin`);
   assert.ok(store.portal!.ledger.byCommand(command.id).some(t=>t.status==='REVIEW'),`${label}: money transaction in REVIEW`);
   const sent=game!.received.length;
   await pause(700);
   assert.equal(game!.received.length,sent,`${label}: no automatic retry`);
   const resolved=(await as(admin.id).post(`${path}/game-commands/${command.id}/resolve`,{applied})).body;
   assert.equal(resolved.status,applied?'RESOLVED_APPLIED':'RESOLVED_NOT_APPLIED',label);
   assert.ok(store.portal!.ledger.byCommand(command.id).every(t=>t.status===(applied?'CONFIRMED':'FAILED')),`${label}: ledger follows the decision`);
   assert.deepEqual(await reviews(),[],`${label}: nothing left to review`);
   return command;
  };
  game.mode='ack-lost';

  // Bank: the deposit was written in the game; the admin confirms it, the bank is credited once.
  let response=await as(ben.id).post(`${path}/bank/deposit`,{amount:10000,requestId:randomUUID()});
  assert.equal(response.body.error.code,'COMMAND_OUTCOME_UNKNOWN');assert.equal(game.money,40000);
  assert.deepEqual((await reviews())[0].moneyTypes,['BANK_DEPOSIT','JACKPOT_CONTRIBUTION'],'the review names the bank deposit, not only the game write');
  await expectReview('bank',true);
  assert.equal((await as(ben.id).get(`${path}/bank`)).body.balance,9000);
  await synced(40000);

  // Shop: the ticket waits in PAYMENT_REVIEW, then joins the queue once the payment is confirmed.
  const wheel=(await as(admin.id).post(`${path}/wheels`,{name:'Roue',description:'',price:1000,icon:'green-1',tone:'GOOD',enabled:true,
   gages:[{name:'Rien',description:'',handler:'NOTICE',params:{},weight:1}]})).body as WheelType;
  const ticketId=randomUUID();
  response=await as(ben.id).post(`${path}/shop/tickets`,{wheelId:wheel.id,requestId:ticketId});
  assert.equal(response.body.error.code,'COMMAND_OUTCOME_UNKNOWN');assert.equal(game.money,39000);
  assert.equal(((await as(ben.id).get(`${path}/shop`)).body as ShopSnapshot).tickets.find(t=>t.id===ticketId)?.status,'PAYMENT_REVIEW');
  await expectReview('shop',true);
  assert.equal(((await as(ben.id).get(`${path}/shop`)).body as ShopSnapshot).tickets.find(t=>t.id===ticketId)?.status,'QUEUED');
  await synced(39000);

  // Auction: purchase written (money and Pokémon) but unconfirmed; stats stay hidden until the decision.
  const lot=(await as(admin.id).post(`${path}/auctions`,{uncertainty:0})).body as LobbyAuction;
  assert.equal((await as(ben.id).post(`${path}/auctions/${lot.id}/bid`,{amount:500})).status,200);
  response=await as(admin.id).post(`${path}/auctions/${lot.id}/close`);
  assert.equal(response.body.error.code,'COMMAND_OUTCOME_UNKNOWN');
  assert.equal(game.money,38500);assert.equal(game.party.length,2);
  let auction=((await as(ben.id).get(`${path}/auctions`)).body.auctions as LobbyAuction[]).find(a=>a.id===lot.id)!;
  assert.equal(auction.status,'REVIEW');assert.equal(auction.revealed,null);
  await expectReview('auction',true);
  auction=((await as(ben.id).get(`${path}/auctions`)).body.auctions as LobbyAuction[]).find(a=>a.id===lot.id)!;
  assert.equal(auction.status,'SOLD');assert.equal(auction.winner?.price,500);
  await synced(38500);

  // Objective reward: the admin states it was NOT applied (e.g. the save was reloaded): nothing is paid twice.
  assert.equal((await as(admin.id).patch(`${path}/objectives/badge1`,{rewardMoney:1000})).body.rewardMoney,1000);
  game.completed=['starter','badge1'];game.publish();
  const completion=()=>((portal.services.objectives.completions(lobby.id)) as ObjectivesSnapshot['completions']).find(c=>c.objectiveId==='badge1'&&c.accountId===ben.id);
  await until(()=>(game!.received.at(-1)?.command==='game.money.add'),'reward command');
  await until(()=>completion()?.rewardStatus==='REVIEW','reward in review');
  game.money-=1000;game.publish(); // the admin reloaded the save: the reward is gone from the game
  await expectReview('objective',false);
  assert.notEqual(completion()?.rewardStatus,'PAID');
  assert.equal(store.portal!.ledger.list(lobby.id).filter(t=>t.type==='OBJECTIVE_REWARD'&&t.status==='CONFIRMED').length,0);
 }finally{game?.close();for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
