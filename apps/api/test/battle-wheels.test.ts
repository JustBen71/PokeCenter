import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePokemon,type BattleEncounter,type WheelResolution,type WheelType} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,template,until} from './support/fake-game-client.js';

async function eventually(check:()=>Promise<boolean>,label:string){for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw new Error(`Timed out waiting for ${label}`);}

test('wheel gage START_BATTLE: mirror for the beneficiary, chosen player, hostile wheel on the target; result followed by the battle',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,tim,lobby,base,portal}=p;
  const wheels=`/api/lobbies/${lobby.id}/wheels`,battles=`/api/lobbies/${lobby.id}/battles`;
  const make=async(name:string,params:object,tone='GOOD')=>(await as(admin.id).post(wheels,{name,price:0,icon:tone==='BAD'?'purple-2':'green-2',tone,gages:[{name,handler:'START_BATTLE',params}]})).body as WheelType;
  const spin=async(w:WheelType,body:object)=>(await as(admin.id).post(`${wheels}/${w.id}/spin`,body)).body as WheelResolution;
  const apply=async(r:WheelResolution,body:object={})=>(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${r.id}/apply`,body)).body as WheelResolution&{error?:{code:string}};
  const latest=async(accountId:string)=>((await as(admin.id).get(battles)).body.encounters as BattleEncounter[]).find(e=>e.accountId===accountId)!;
  assert.equal((await as(admin.id).post(wheels,{name:'X',price:0,icon:'green-2',tone:'GOOD',gages:[{name:'X',handler:'START_BATTLE',params:{builder:'RIVAL'}}]})).body.error.code,'VALIDATION_FAILED');
  const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',battles:true,party:[encodePokemon(template(258,12,'GOBOU'))]});closers.push(()=>benGame.close());
  const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',battles:true,party:[encodePokemon(template(255,30,'POUSSIFEU')),encodePokemon(template(280,28,'TARSAL'))]});closers.push(()=>timGame.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money&&!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'games');
  for(const id of [ben.id,tim.id])await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:id,start:true});

  // Miroir: applied after the animation, the battle is created and sent; the gage is a success once queued.
  const mirror=await make('Miroir',{builder:'MIRROR',scaling:{mode:'DELTA_LEVEL',delta:2}});
  const r=await spin(mirror,{ownerId:ben.id});assert.equal(r.status,'DRAWN');assert.equal(r.gage.requiresTarget,false);
  const applied=await apply(r);
  assert.equal(applied.status,'SUCCESS');assert.match(applied.result!,/Combat lancé : Ben VS BEN \(1 Pokémon, niv\. 14\)/);
  await until(()=>benGame.battle.active!==null,'battle armed in Ben’s game');
  assert.deepEqual(benGame.battle.spec!.party.map((m:{speciesId:number;level:number})=>[m.speciesId,m.level]),[[258,14]]);
  benGame.battleStarted();benGame.endBattle('WIN');
  await eventually(async()=>(await latest(ben.id)).status==='WON','won');

  // Choisis un joueur : the target is chosen after the draw and the beneficiary faces the target's team.
  const rival=await make('Rival',{builder:'OTHER_PLAYER',scaling:{mode:'MATCH_PLAYER_AVERAGE',delta:0}});
  const r2=await spin(rival,{ownerId:ben.id});
  assert.equal(r2.status,'AWAITING_CHOICE');assert.equal(r2.gage.requiresTarget,true);
  assert.equal((await apply(r2)).error!.code,'VALIDATION_FAILED','target required');
  assert.equal((await apply(r2,{targetId:tim.id})).status,'SUCCESS');
  await until(()=>benGame.battle.active!==null,'second battle armed');
  assert.deepEqual(benGame.battle.spec!.party.map((m:{speciesId:number;level:number})=>[m.speciesId,m.level]),[[255,13],[280,11]],'Tim’s team at Ben’s average (12), gap kept');
  assert.equal(benGame.battle.spec!.trainer.name,'TIM');
  benGame.battleStarted();benGame.endBattle('LOSS');
  await eventually(async()=>(await latest(ben.id)).status==='LOST','lost');

  // Hostile wheel where the target fights its own mirror.
  const hostile=await make('Reflet',{builder:'MIRROR',fighter:'TARGET',spriteId:'lass'},'BAD');
  const r3=await spin(hostile,{ownerId:ben.id,targetId:tim.id});
  assert.equal((await apply(r3)).status,'SUCCESS');
  await until(()=>timGame.battle.active!==null,'battle armed in Tim’s game');
  assert.equal(timGame.battle.spec!.trainer.spriteId,'lass');
  assert.equal((await latest(tim.id)).status,'STARTING');
  // A second battle for the same player while one is pending: the gage is refused, nothing is created.
  const r4=await spin(hostile,{ownerId:ben.id,targetId:tim.id});
  const count=((await as(admin.id).get(battles)).body.encounters as BattleEncounter[]).length;
  assert.equal((await apply(r4)).error!.code,'BATTLE_ALREADY_PENDING');
  assert.equal(((await as(admin.id).get(battles)).body.encounters as BattleEncounter[]).length,count,'no orphan battle');
 }finally{for(const c of closers)c();await p.close();}
});
