import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {io as client} from 'socket.io-client';
import type {LobbyNotification,WheelResolution,WheelType} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,rawPokemon,until} from './support/fake-game-client.js';

const wheel=(name:string,handler:string,params:object,tone='NEUTRAL')=>({name,price:100,icon:'green-2',tone,gages:[{name,handler,params}]});

test('wheels: server-side draw, tested handlers, choices, retries, review and live notifications',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:300});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const closers:(()=>void)[]=[];
 try{
  const app=portal.app;
  const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const tim=(await request(app).post('/api/accounts').send({name:'Tim',sprite:'may',admin:false})).body;
  const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b),patch:(p:string,b:object)=>request(app).patch(p).set('x-account-id',id).send(b),put:(p:string,b:object)=>request(app).put(p).set('x-account-id',id).send(b),del:(p:string)=>request(app).delete(p).set('x-account-id',id)});
  const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
  for(const p of [ben,tim])await as(p.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  await as(admin.id).patch(`/api/lobbies/${lobby.id}/settings`,{wheelJackpotPercent:20});
  const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:5000,party:[rawPokemon(1,5),rawPokemon(4,30)]});closers.push(()=>benGame.close());
  const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',money:3000});closers.push(()=>timGame.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money&&!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'games');
  for(const p of [ben,tim])await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:p.id,start:true});
  const dashboard=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:tim.id},transports:['websocket'],reconnection:false});closers.push(()=>dashboard.close());
  const notifications:LobbyNotification[]=[],spins:WheelResolution[]=[];
  dashboard.on('notification',(n:LobbyNotification)=>notifications.push(n));dashboard.on('wheel-spin',(r:WheelResolution)=>spins.push(r));
  await until(()=>dashboard.connected,'dashboard');
  const wheels=`/api/lobbies/${lobby.id}/wheels`,resolutions=`/api/lobbies/${lobby.id}/wheel-resolutions`;

  // Defaults seeded with the lobby; CRUD is admin only and parameters are validated per handler.
  const seeded=(await as(ben.id).get(wheels)).body.wheels as WheelType[];
  assert.deepEqual(seeded.map(w=>w.tone),['GOOD','BAD']);
  assert.equal((await as(ben.id).post(wheels,wheel('X','NOTICE',{}))).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await as(admin.id).post(wheels,wheel('X','GIVE_MONEY',{amount:-5}))).body.error.code,'VALIDATION_FAILED');
  assert.equal((await as(admin.id).post(wheels,{...wheel('X','NOTICE',{}),gages:[{name:'X',handler:'RUN_SCRIPT',params:{}}]})).body.error.code,'VALIDATION_FAILED');
  const make=async(name:string,handler:string,params:object,tone='NEUTRAL')=>(await as(admin.id).post(wheels,wheel(name,handler,params,tone))).body as WheelType;
  const spin=async(w:WheelType,body:object)=>(await as(admin.id).post(`${wheels}/${w.id}/spin`,body)).body as WheelResolution;
  const apply=(r:WheelResolution,body:object={})=>as(admin.id).post(`${resolutions}/${r.id}/apply`,body);

  // The result is chosen before the animation and every dashboard receives the same strip.
  const gift=await make('Cadeau','GIVE_MONEY',{amount:700},'GOOD');
  const drawn=await spin(gift,{ownerId:ben.id});
  assert.equal(drawn.status,'DRAWN');assert.equal(drawn.strip.length,30);assert.equal(drawn.strip[26],'Cadeau');
  await until(()=>spins.some(s=>s.id===drawn.id),'spin event');
  assert.equal((await apply(drawn)).body.status,'SUCCESS');assert.equal(benGame.money,5700);
  assert.equal((await apply(drawn)).body.error.code,'CONFLICT','applied once');
  await until(()=>notifications.some(n=>n.kind==='success'&&n.message.includes('Cadeau')),'success notification');

  // Penalty with jackpot share, target required.
  const fine=await make('Amende','TAKE_MONEY',{amount:1000},'BAD');
  const noTarget=await spin(fine,{ownerId:ben.id});assert.equal(noTarget.status,'AWAITING_CHOICE');
  assert.equal((await apply(noTarget)).body.error.code,'VALIDATION_FAILED');
  assert.equal((await apply(noTarget,{targetId:tim.id})).body.status,'SUCCESS');
  assert.equal(timGame.money,2000);assert.equal(store.portal!.ledger.jackpotBalance(lobby.id),200);

  // Theft: two games, two verified commands.
  await until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).game.money===5700,'ben sync');
  await until(()=>portal.services.currentGame.resolve(lobby.id,tim.id).game.money===2000,'tim sync');
  const heist=await make('Braquage','STEAL_MONEY',{amount:500},'BAD');
  assert.equal((await apply(await spin(heist,{ownerId:ben.id,targetId:tim.id}))).body.status,'SUCCESS');
  assert.equal(timGame.money,1500);assert.equal(benGame.money,6200);

  // Party change: waits for the admin, needs the battle confirmation, removes the requested choice.
  const exile=await make('Exil','REMOVE_POKEMON',{selector:'highest'},'BAD');
  const pending=await spin(exile,{ownerId:tim.id,targetId:ben.id});
  assert.equal(pending.status,'AWAITING_CHOICE');
  assert.equal((await apply(pending,{})).body.error.code,'SAFE_STATE_REQUIRED');
  assert.equal(portal.services.wheels.resolution(lobby.id,pending.id).status,'AWAITING_CHOICE','refusal keeps it pending');
  assert.equal((await apply(pending,{confirmOutOfBattle:true})).body.status,'SUCCESS');
  assert.deepEqual(benGame.party,[rawPokemon(1,5)],'highest level removed');
  await until(()=>notifications.some(n=>n.kind==='error'),'failure notification');

  // Notice: no game effect. Jackpot: paid from the pot under the jackpot lock.
  const notice=await make('Chanter','NOTICE',{});
  assert.match((await apply(await spin(notice,{ownerId:tim.id}))).body.result,/Chanter/);
  await until(()=>portal.services.currentGame.resolve(lobby.id,tim.id).game.money===1500,'tim sync 2');
  const pot=await make('Pot','JACKPOT_EMPTY',{},'GOOD');
  assert.equal((await apply(await spin(pot,{ownerId:tim.id}))).body.status,'SUCCESS');
  assert.equal(timGame.money,1700);assert.equal(store.portal!.ledger.jackpotBalance(lobby.id),0);
  assert.match((await apply(await spin(pot,{ownerId:tim.id}))).body.result,/vide/);

  // Unknown outcome: REVIEW, then closed by an admin.
  benGame.mode='timeout';
  const lost=await spin(gift,{ownerId:ben.id});
  assert.equal((await apply(lost)).body.error.code,'COMMAND_OUTCOME_UNKNOWN');
  assert.equal(portal.services.wheels.resolution(lobby.id,lost.id).status,'REVIEW');
  assert.equal((await as(admin.id).post(`${resolutions}/${lost.id}/close`,{status:'FAILED',note:'Rien reçu'})).body.status,'FAILED');

  // Editing or deleting a wheel never changes past results.
  await as(admin.id).put(`${wheels}/${gift.id}`,{...wheel('Cadeau v2','GIVE_MONEY',{amount:1}),tone:'GOOD'});
  assert.equal(portal.services.wheels.resolution(lobby.id,drawn.id).gage.name,'Cadeau');
  assert.equal((await as(admin.id).del(`${wheels}/${gift.id}`)).body.ok,true);
  assert.ok(!(await as(admin.id).get(wheels)).body.wheels.some((w:WheelType)=>w.id===gift.id));
  assert.ok(store.portal!.audit.list({category:'WHEEL'}).length>=10);
 }finally{closers.forEach(c=>c());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
