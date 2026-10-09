import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePokemonCopy,encodePokemon,gen3PartyRaw} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,rawPokemon,template,until} from './support/fake-game-client.js';

test('party: a traded Pokémon takes the player’s trainer (it obeys), everything else kept',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,lobby,base,portal}=p;
  const traded=encodePokemon({...template(258,30,'GOBOU'),otName:'TIM',trainerId:4242,secretId:777});
  // Ben's save: trainer ID 0x00020001 (ID 1, secret ID 2) and the name FAKE, as on his own Pokémon (rawPokemon).
  const own=rawPokemon(255,12,'POUSSIFEU'),ot=own.slice(8,16)+own.slice(40,54);
  // Older client (no trainer ID): refused rather than guessed. Alone in the team: allowed.
  const old=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',party:[traded]});
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'old game');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  assert.match((await as(admin.id).post(`/api/lobbies/${lobby.id}/players/${ben.id}/pokemon`,{action:'adopt',slot:1,confirmOutOfBattle:true})).body.error.message,/0\.2\.2/);
  old.close();
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',ot,party:[traded]});closers.push(()=>game.close());
  await until(()=>{try{return portal.services.currentGame.requireState(lobby.id,ben.id,{requireRun:false}).state.trainer.ot===ot;}catch{return false;}},'new game');
  const adopt=(slot:number,who=admin.id)=>as(who).post(`/api/lobbies/${lobby.id}/players/${ben.id}/pokemon`,{action:'adopt',slot,confirmOutOfBattle:true});

  assert.equal((await adopt(1,ben.id)).body.error.code,'ADMIN_REQUIRED');
  const done=await adopt(1);
  assert.equal(done.body.status,'COMPLETED',JSON.stringify(done.body));
  const before=decodePokemonCopy(traded),after=decodePokemonCopy(game.party[0]!);
  assert.deepEqual([after.trainerId,after.secretId,after.otName],[1,2,'FAKE'],'the trainer of Ben’s own Pokémon');
  assert.deepEqual({...after,trainerId:0,secretId:0,otName:''},{...before,trainerId:0,secretId:0,otName:'',shiny:after.shiny},'nothing else changes');
  const seen=()=>{try{return portal.services.currentGame.requireState(lobby.id,ben.id,{requireRun:false}).state.party[0]!;}catch{return null;}};
  game.publish();await until(()=>{const s=seen();return !!s&&decodePokemonCopy(gen3PartyRaw(s)!).trainerId===1;},'observed');
  assert.equal((await adopt(1)).body.error.code,'CONFLICT','already his');
 }finally{for(const c of closers)c();await p.close();}
});

test('party: a player renames a Pokémon of his own team, nothing else changes',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,tim,lobby,base,portal}=p;
  const mon=rawPokemon(255,12,'POUSSIFEU');
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',party:[mon]});closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'game');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  const rename=(who:string,nickname:string)=>as(who).post(`/api/lobbies/${lobby.id}/my-pokemon/rename`,{slot:1,nickname,confirmOutOfBattle:true});
  assert.equal((await rename(ben.id,'Zizi™')).body.error.code,'VALIDATION_FAILED','not a game character');
  assert.equal((await rename(tim.id,'Zizi')).body.error.code,'GAME_NOT_CONNECTED','Tim renames his own (absent) game, never Ben’s');
  const done=await rename(ben.id,'Flammèche');
  assert.equal(done.body.status,'COMPLETED',JSON.stringify(done.body));
  const before=decodePokemonCopy(mon),after=decodePokemonCopy(game.party[0]!);
  assert.equal(after.nickname,'Flammèche');
  assert.deepEqual({...after,nickname:''},{...before,nickname:''});
 }finally{for(const c of closers)c();await p.close();}
});
