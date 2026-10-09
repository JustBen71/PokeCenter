import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PassiveHandler} from '../src/passives/passive-events.js';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

// A test handler stands in for future passives (Prime de dresseur, Marathonien): no real adapter emits events yet.
const seen:string[]=[];
const handlers:Record<string,PassiveHandler>={scout:{on:{
 TRAINER_VICTORY:async(ctx,e)=>{seen.push(`victory:${e.data.baseReward}`);await ctx.reward(`payday:${e.id}`,{type:'MONEY',amount:Math.floor(e.data.baseReward*5/100),reason:'test'});},
 STEPS_CHANGED:(ctx,e)=>{seen.push(`steps:+${e.data.delta}=${e.data.total}`);},
 POKEMON_FAINTED:(ctx,e)=>{seen.push(`fainted:${e.data.slot}`);},
 BATTLE_ENDED:(ctx,e)=>{seen.push(`battle:${e.data.outcome}`);}
}}};

test('GAME_EVENT: capability required, ACK, same eventId after reconnection processed once, race steps across Runs',async()=>{
 const p=await passivePortal({handlers});
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,lobby,base,store,portal}=p;
  portal.services.passives.grant(lobby.id,ben.id,'scout','ADMIN');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  // Without the capability (real Gen III adapter today), events are refused and nothing happens.
  const plain=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:1000});
  const refusedId=randomUUID();
  assert.deepEqual(await plain.gameEvent('TRAINER_VICTORY',{moneyBefore:1000,moneyAfter:2200,baseReward:1200},refusedId),
   {type:'GAME_EVENT_ACK',protocolVersion:1,eventId:refusedId,ok:false,error:{code:'capability_missing'}});
  // An invalid event (garbage step counter) is refused for good instead of disconnecting: otherwise the client re-sends it forever.
  const invalidId=randomUUID();
  assert.deepEqual(await plain.gameEvent('STEPS_CHANGED',{absolute:4294967295},invalidId),
   {type:'GAME_EVENT_ACK',protocolVersion:1,eventId:invalidId,ok:false,error:{code:'invalid_event'}});
  assert.deepEqual(seen,[]);plain.close();
  await new Promise(r=>setTimeout(r,100));

  const events=['events.trainer_victory','steps.read','events.pokemon_fainted','events.battle_ended'];
  let game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:1000,events});closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'game');
  const victory=randomUUID();
  const ack=await game.trainerVictory(1200,victory);
  assert.equal(ack?.ok,true);
  await until(()=>game.money===2260,'5 % bonus paid once');
  // The client re-sends the same event after a reconnection (lost ACK): ACK again, no second effect.
  game=await game.reconnect();closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'reconnected');
  assert.equal((await game.gameEvent('TRAINER_VICTORY',{moneyBefore:1000,moneyAfter:2200,baseReward:1200},victory))?.ok,true);
  await new Promise(r=>setTimeout(r,150));
  assert.equal(game.money,2260);assert.deepEqual(seen,['victory:1200']);
  assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM money_transactions WHERE type='PASSIVE_REWARD'").get() as {n:number}).n,1);

  // Steps: absolute counter → deltas; a reset (new Run) is a new baseline; the total spans the race.
  for(const n of [0,12000,12000])await game.setSteps(n);
  await game.setSteps(0);await game.setSteps(9000);await game.setSteps(4000);await game.setSteps(9000);
  assert.deepEqual(seen.filter(s=>s.startsWith('steps')),['steps:+0=0','steps:+12000=12000','steps:+0=12000','steps:+0=12000','steps:+9000=21000','steps:+4000=25000','steps:+5000=30000']);
  assert.equal(portal.services.passiveEngine.raceSteps(lobby.id,ben.id),30000);
  assert.equal((await game.pokemonFainted(2,4))?.ok,true);assert.equal((await game.battleEnded('WIN',1))?.ok,true);
  assert.deepEqual(seen.slice(-2),['fainted:2','battle:WIN']);
 }finally{for(const c of closers)c();await p.close();}
});
