import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,rawPokemon,template,until} from './support/fake-game-client.js';

// FAKE_GAME_VERIFIED: the whole chain API → GameCommandService → /client protocol, with a simulated game.
test('admins edit parties and in-game money through verified game commands',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:150});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const clients:FakeGameClient[]=[];
 try{
  const app=portal.app;
  const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b)});
  const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
  await as(ben.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben'});clients.push(game);
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'native state');

  // Library: admins only, versioned artifacts.
  assert.equal((await as(ben.id).get('/api/library')).body.error.code,'ADMIN_REQUIRED');
  const entry=(await as(admin.id).post('/api/library',{label:'Modèle',template:template(4,7,'SALA')})).body;
  assert.equal(entry.artifact.format,'gen3-template-v1');assert.equal(entry.artifact.generation,3);
  const copy=(await as(admin.id).post('/api/library',{label:'Copie',pokemon:{raw:rawPokemon(7),slot:1,speciesId:7,speciesName:'Carapuce',nickname:null,level:5,currentHp:20,maxHp:20,shiny:false}})).body;
  assert.equal(copy.artifact.format,'gen3-party-v1');

  const pokemon=`/api/lobbies/${lobby.id}/players/${ben.id}/pokemon`,money=`/api/lobbies/${lobby.id}/players/${ben.id}/money`;
  assert.equal((await as(ben.id).post(pokemon,{action:'insert',artifactId:entry.id,confirmOutOfBattle:true})).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await as(admin.id).post(pokemon,{action:'insert',artifactId:entry.id,confirmOutOfBattle:false})).body.error.code,'SAFE_STATE_REQUIRED');
  assert.equal((await as(admin.id).post(pokemon,{action:'insert',artifactId:entry.id,confirmOutOfBattle:true})).body.error.code,'RUN_NOT_RUNNING');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});

  const inserted=await as(admin.id).post(pokemon,{action:'insert',artifactId:entry.id,confirmOutOfBattle:true});
  assert.equal(inserted.body.status,'COMPLETED');assert.equal(game.party.length,2);
  assert.equal(game.received[0].command,'game.pokemon.insert');assert.equal(game.received[0].payload.expectedCount,1);
  await until(()=>portal.services.currentGame.requireState(lobby.id,ben.id).state.party.length===2,'party refresh');
  assert.equal((await as(admin.id).post(pokemon,{action:'replace',slot:2,artifactId:copy.id,confirmOutOfBattle:true})).body.status,'COMPLETED');
  assert.equal(game.party[1],rawPokemon(7));assert.equal(game.received[1].payload.expectedRaw,rawPokemon(4,7,'SALA'));
  await until(()=>portal.services.currentGame.requireState(lobby.id,ben.id).state.party[1].raw===rawPokemon(7),'replace refresh');
  assert.equal((await as(admin.id).post(pokemon,{action:'remove',slot:1,confirmOutOfBattle:true})).body.status,'COMPLETED');
  await until(()=>portal.services.currentGame.requireState(lobby.id,ben.id).state.party.length===1,'remove refresh');
  const before=game.received.length;
  assert.equal((await as(admin.id).post(pokemon,{action:'remove',slot:1,confirmOutOfBattle:true})).body.error.code,'LAST_POKEMON');
  assert.equal(game.received.length,before,'refused before sending anything');

  // Money: ledger rows follow the game confirmation.
  const added=(await as(admin.id).post(money,{operation:'add',amount:500,reason:'test'})).body;
  assert.equal(added.status,'CONFIRMED');assert.equal(game.money,13000);assert.equal(added.transactions[0].status,'CONFIRMED');
  await until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).game.money===13000,'money refresh');
  assert.equal((await as(admin.id).post(money,{operation:'remove',amount:20000})).body.error.code,'INSUFFICIENT_FUNDS');

  // A refusal changes nothing and is recorded as FAILED.
  game.mode={refuse:'state_changed'};
  const refused=await as(admin.id).post(money,{operation:'remove',amount:100});
  assert.equal(refused.status,409);assert.equal(refused.body.error.code,'GAME_STATE_CHANGED');
  assert.equal(store.portal!.ledger.list(lobby.id)[0].status,'FAILED');assert.equal(game.money,13000);

  // A lost acknowledgement: REVIEW, the player stays locked meanwhile, and an admin resolves it.
  game.mode='timeout';
  // supertest only sends on then(): start the request now and keep its promise.
  const pending=as(admin.id).post(money,{operation:'remove',amount:100}).then(r=>r);
  await until(()=>game.received.at(-1)?.command==='game.money.remove'&&game.received.length===before+3,'timeout command');
  assert.equal((await as(admin.id).post(money,{operation:'add',amount:1})).body.error.code,'PLAYER_BUSY');
  const unknown=await pending;
  assert.equal(unknown.status,504);assert.equal(unknown.body.error.code,'COMMAND_OUTCOME_UNKNOWN');
  const commandId=unknown.body.error.details.commandId;
  assert.equal(store.portal!.ledger.byCommand(commandId)[0].status,'REVIEW');
  const reviews=(await as(admin.id).get(`/api/lobbies/${lobby.id}/game-commands?status=REVIEW`)).body;
  assert.deepEqual(reviews.map((c:{id:string})=>c.id),[commandId]);
  assert.equal((await as(admin.id).post(`/api/lobbies/${lobby.id}/game-commands/${commandId}/resolve`,{applied:true})).body.status,'RESOLVED_APPLIED');
  assert.equal(store.portal!.ledger.byCommand(commandId)[0].status,'CONFIRMED');
  assert.equal((await as(admin.id).post(`/api/lobbies/${lobby.id}/game-commands/${commandId}/resolve`,{applied:false})).body.error.code,'CONFLICT');
  assert.ok(store.portal!.audit.list({category:'GAME_COMMAND',status:'REVIEW'}).length>=1);

  // Without write capabilities the API refuses before sending anything.
  game.close();
  const readOnly=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',playerId:'fake-ben-2',writes:false});clients.push(readOnly);
  await until(()=>portal.services.currentGame.resolve(lobby.id,ben.id).client.playerId==='fake-ben-2','read-only client');
  assert.equal((await as(admin.id).post(money,{operation:'add',amount:1})).body.error.code,'CAPABILITY_MISSING');
  assert.equal(readOnly.received.length,0);
 }finally{clients.forEach(c=>c.close());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
