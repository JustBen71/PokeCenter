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
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',party:[rawPokemon(255,12,'POUSSIFEU'),traded,rawPokemon(252,8,'ARCKO')]});closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'game');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  const adopt=(slot:number,who=admin.id)=>as(who).post(`/api/lobbies/${lobby.id}/players/${ben.id}/pokemon`,{action:'adopt',slot,confirmOutOfBattle:true});

  assert.equal((await adopt(2,ben.id)).body.error.code,'ADMIN_REQUIRED');
  const done=await adopt(2);
  assert.equal(done.body.status,'COMPLETED',JSON.stringify(done.body));
  const before=decodePokemonCopy(traded),after=decodePokemonCopy(game.party[1]!);
  assert.deepEqual([after.trainerId,after.secretId,after.otName],[1,2,'FAKE'],'the trainer of Ben’s own Pokémon');
  assert.deepEqual({...after,trainerId:0,secretId:0,otName:''},{...before,trainerId:0,secretId:0,otName:'',shiny:after.shiny},'nothing else changes');
  const seen=()=>{try{return portal.services.currentGame.requireState(lobby.id,ben.id,{requireRun:false}).state.party[1]!;}catch{return null;}};
  game.publish();await until(()=>{const s=seen();return !!s&&decodePokemonCopy(gen3PartyRaw(s)!).trainerId===1;},'observed');
  assert.equal((await adopt(2)).body.error.code,'CONFLICT','already his');
 }finally{for(const c of closers)c();await p.close();}
});
