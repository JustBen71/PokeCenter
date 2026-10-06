import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePokemon,type BattlePokemonSpec,type BattlePreview,type BattleEncounter} from '@pokerace/shared';
import {scaleParty} from '../src/battles/battle-scaling-service.js';
import {trainerName} from '../src/battles/battle-builders.js';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,template,until} from './support/fake-game-client.js';
import {DomainError} from '../src/errors.js';

const mon=(level:number):BattlePokemonSpec=>({speciesId:257,level,moves:[53,339],heldItem:0,nature:3,ev:20});
const levels=(p:BattlePokemonSpec[])=>p.map(m=>m.level);
const avg=(l:number[])=>l.reduce((a,b)=>a+b,0)/l.length;
const code=(fn:()=>unknown)=>{try{fn();}catch(e){return e instanceof DomainError?e.code:String(e);}return 'OK';};

test('scaling: copy, delta, player average or highest (block shift), custom levels, caps 1..100, moves kept',()=>{
 const source=[mon(50),mon(48),mon(52)];
 assert.deepEqual(levels(scaleParty(source,{mode:'COPY_EXACT',delta:0},null)),[50,48,52]);
 const avgParty=scaleParty(source,{mode:'MATCH_PLAYER_AVERAGE',delta:0},[34,36,35]);
 assert.equal(avg(levels(avgParty)),35);assert.deepEqual(levels(avgParty),[35,33,37]);
 assert.deepEqual(levels(scaleParty(source,{mode:'MATCH_PLAYER_AVERAGE',delta:2},[34,36,35])),[37,35,39],'average + 2');
 assert.deepEqual(levels(scaleParty(source,{mode:'MATCH_PLAYER_HIGHEST',delta:5},[10,20])),[23,21,25],'highest of the source = player highest + 5');
 assert.deepEqual(levels(scaleParty(source,{mode:'DELTA_LEVEL',delta:-60},null)),[1,1,1],'never below 1');
 assert.deepEqual(levels(scaleParty(source,{mode:'DELTA_LEVEL',delta:60},null)),[100,100,100],'never above 100');
 assert.deepEqual(levels(scaleParty(source,{mode:'CUSTOM_LEVELS',delta:0,levels:[5,6,7]},null)),[5,6,7]);
 assert.equal(code(()=>scaleParty(source,{mode:'CUSTOM_LEVELS',delta:0,levels:[5]},null)),'VALIDATION_FAILED');
 assert.equal(code(()=>scaleParty(source,{mode:'MATCH_PLAYER_AVERAGE',delta:0},null)),'BATTLE_SOURCE_UNAVAILABLE');
 assert.ok(avgParty.every(m=>m.moves.join()==='53,339'&&m.nature===3&&m.ev===20),'only the level changes');
 assert.equal(trainerName('Timéo-Dupont'),'TIMÉO-D');assert.equal(trainerName('😀'),'RIVAL');
});

test('battle builders through the API: mirror, other player, leader, custom; frozen snapshot; admin only',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,tim,lobby,base,portal}=p;
  const preview=(body:object,who=admin.id)=>as(who).post(`/api/lobbies/${lobby.id}/battles/preview`,body);
  // Ben: Braségali-like copy with known moves/nature/EVs; Tim: two higher Pokémon.
  const benMon=encodePokemon({...template(257,30,'BLAZE'),moves:[{id:53,pp:15},{id:339,pp:5},{id:0,pp:0},{id:0,pp:0}],nature:3,heldItem:13,
   evs:{hp:60,attack:120,defense:0,speed:80,spAttack:0,spDefense:0}});
  const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',party:[benMon]});closers.push(()=>benGame.close());
  const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',party:[encodePokemon(template(25,48,'PIKA')),encodePokemon(template(1,46,'BULBI'))]});closers.push(()=>timGame.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money&&!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'games');

  assert.equal((await preview({accountId:ben.id,builder:{type:'MIRROR'}},ben.id)).body.error.code,'ADMIN_REQUIRED');
  const mirror=(await preview({accountId:ben.id,builder:{type:'MIRROR'}})).body as BattlePreview;
  assert.equal(mirror.sourceType,'CURRENT_PLAYER_PARTY');assert.equal(mirror.spec.trainer.name,'BEN');
  assert.deepEqual(mirror.spec.party,[{speciesId:257,level:30,moves:[53,339],heldItem:13,nature:3,ev:43,personality:mirror.spec.party[0].personality}]);
  assert.equal(mirror.spec.party[0].personality!%25,3,'exact personality kept');

  const rival=(await preview({accountId:ben.id,builder:{type:'OTHER_PLAYER',opponentId:tim.id},scaling:{mode:'MATCH_PLAYER_AVERAGE',delta:2},trainer:{spriteId:'lass'}})).body as BattlePreview;
  assert.deepEqual(rival.sourceLevels,[48,46]);assert.deepEqual(rival.spec.party.map(m=>m.level),[33,31],'Ben average 30 + 2, relative gap kept');
  assert.deepEqual(rival.playerLevels,{average:30,highest:30});assert.equal(rival.spec.trainer.spriteId,'lass');assert.equal(rival.spec.trainer.name,'TIM');
  assert.equal((await preview({accountId:ben.id,builder:{type:'OTHER_PLAYER',opponentId:ben.id}})).body.error.code,'VALIDATION_FAILED');

  // Leader: Tim is #1 once he has more objectives.
  await portal.services.objectives.observe(lobby.id,tim.id,['starter','rival103']);
  await portal.services.objectives.observe(lobby.id,ben.id,['starter']);
  const leader=(await preview({accountId:ben.id,builder:{type:'LEADER'}})).body as BattlePreview;
  assert.equal(leader.sourceType,'LEADER_PARTY');assert.equal(leader.sourceRefId,tim.id);

  const custom=(await preview({accountId:ben.id,builder:{type:'CUSTOM',party:[{speciesId:19,level:3,moves:[33],nature:0}]},trainer:{name:'Éloïse',spriteId:'picnicker'}})).body as BattlePreview;
  assert.equal(custom.spec.trainer.name,'Éloïse');assert.equal(custom.spec.party[0].ev,0);

  // Created battles keep their snapshot, even if the source team changes before the start.
  const created=(await as(admin.id).post(`/api/lobbies/${lobby.id}/battles`,{accountId:ben.id,builder:{type:'OTHER_PLAYER',opponentId:tim.id}})).body as BattleEncounter;
  assert.equal(created.status,'CREATED');assert.deepEqual(created.party.map(m=>m.level),[48,46]);
  timGame.party=[encodePokemon(template(25,60,'PIKA'))];timGame.publish();await new Promise(r=>setTimeout(r,100));
  assert.deepEqual((await as(ben.id).get(`/api/lobbies/${lobby.id}/battles/${created.id}`)).body.party.map((m:BattlePokemonSpec)=>m.level),[48,46]);
  assert.equal((await as(admin.id).post(`/api/lobbies/${lobby.id}/battles/${created.id}/start`)).body.status,'WAITING_SAFE_STATE');
  assert.equal((await as(ben.id).post(`/api/lobbies/${lobby.id}/battles/${created.id}/cancel`)).body.error.code,'ADMIN_REQUIRED');

  // An offline source cannot be read: no guessed team.
  timGame.close();await new Promise(r=>setTimeout(r,150));
  assert.equal((await preview({accountId:ben.id,builder:{type:'OTHER_PLAYER',opponentId:tim.id}})).body.error.code,'BATTLE_SOURCE_UNAVAILABLE');
 }finally{for(const c of closers)c();await p.close();}
});
