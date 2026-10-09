import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePokemonCopy} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,rawPokemon,until} from './support/fake-game-client.js';

// Party writes need the client's Safe State, whatever the browser says (confirmOutOfBattle is only the user's confirmation).
test('party: writes only in the Safe State reported by the client; a refusal is never REVIEW, a lost ACK is never replayed',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,lobby,base,portal}=p;
  const options={base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',party:[rawPokemon(255,12,'POUSSIFEU')]};
  let game=await FakeGameClient.connect(options);closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'game');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  const rename=(nickname:string)=>as(ben.id).post(`/api/lobbies/${lobby.id}/my-pokemon/rename`,{slot:1,nickname,confirmOutOfBattle:true});
  const nickname=()=>decodePokemonCopy(game.party[0]!).nickname;
  const reviews=()=>p.store.portal!.audit.list({category:'GAME_COMMAND',status:'REVIEW'}).length;
  const observed=(safe:boolean)=>until(()=>{try{return portal.services.currentGame.requireState(lobby.id,ben.id,{requireRun:false}).state.battle?.safe===safe;}catch{return false;}},`safe=${safe}`);

  // Overworld, free: accepted.
  assert.equal((await rename('Libre')).body.status,'COMPLETED');assert.equal(nickname(),'Libre');
  // Battle, dialogue/script, map change, dangerous menu: the client reports safe=false (Gen3 field: callback, script, lock), refused before sending.
  for(const state of ['combat','dialogue','changement de zone','menu']){
   game.setSafe(false);await observed(false);
   const sent=game.received.length;
   const refused=await rename('Non');
   assert.equal(refused.body.error.code,'SAFE_STATE_REQUIRED',state);
   assert.equal(game.received.length,sent,`${state}: nothing sent`);
   game.setSafe(true);await observed(true);
  }
  // A commanded battle in progress is not safe either.
  game.battle={...game.battle,active:'00000000-0000-4000-8000-000000000001',state:'RUNNING'};game.publish();await observed(false);
  assert.equal((await rename('Non')).body.error.code,'SAFE_STATE_REQUIRED','commanded battle');
  game.battle={...game.battle,active:null,state:null};game.publish();await observed(true);
  // The server saw it free but the game moved: the client refuses before writing, FAILED and never REVIEW.
  game.safe=false;
  assert.equal((await rename('Non')).body.error.code,'SAFE_STATE_REQUIRED','checked again by the client');
  assert.equal(nickname(),'Libre');game.setSafe(true);
  // Reconnection without a fresh state: refused; fresh and safe again: a new attempt is accepted.
  game.close();game=await FakeGameClient.connect({...options,party:[...game.party],silent:true});closers.push(()=>game.close());
  const silent=await rename('Non');
  assert.match(silent.body.error.code,/^(GAME_ADAPTER_NOT_READY|SAFE_STATE_REQUIRED|GAME_NOT_CONNECTED)$/,'no fresh state');
  assert.equal(game.received.length,0,'nothing sent without a fresh state');
  game.publish();await observed(true);
  assert.equal((await rename('Revenu')).body.status,'COMPLETED');assert.equal(nickname(),'Revenu');
  assert.equal(reviews(),0,'no refusal became REVIEW');
  // ACK lost after the write: REVIEW, as before, and never sent again.
  game.mode='timeout';
  assert.equal((await rename('Perdu')).body.error.code,'COMMAND_OUTCOME_UNKNOWN');
  const sent=game.received.length;
  await new Promise(r=>setTimeout(r,500));
  assert.equal(game.received.length,sent,'never replayed');
  assert.ok(reviews()>=1);
 }finally{for(const c of closers)c();await p.close();}
});
