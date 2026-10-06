import test from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import type {BattleEncounter,LobbyNotification} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

// Waits for an asynchronous condition (API reads), unlike `until` which only takes synchronous checks.
async function eventually(check:()=>Promise<boolean>,label:string){for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw new Error(`Timed out waiting for ${label}`);}

const custom={type:'CUSTOM',party:[{speciesId:19,level:3,moves:[33,39],nature:4}]};

test('battle dispatch: queued until safe, exact spec sent once, started, won; unsafe race re-queued; audit and live notifications',async()=>{
 const p=await passivePortal({commandTimeoutMs:400});
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,lobby,base,portal}=p;
  const path=`/api/lobbies/${lobby.id}/battles`;
  const get=async(id:string)=>(await as(admin.id).get(`${path}/${id}`)).body as BattleEncounter;
  const create=async()=>{const e=(await as(admin.id).post(path,{accountId:ben.id,builder:custom,trainer:{name:'TIMÉO',spriteId:'cooltrainer_m'}})).body as BattleEncounter;
   assert.equal((await as(admin.id).post(`${path}/${e.id}/start`)).body.status,'WAITING_SAFE_STATE');return e;};
  const watch=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:ben.id},transports:['websocket'],reconnection:false});closers.push(()=>watch.close());
  const notes:string[]=[];watch.on('notification',(n:LobbyNotification)=>notes.push(n.message));
  // No game yet: the battle simply waits.
  const e=await create();
  let game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',battles:true});closers.push(()=>game.close());
  game.safe=false;game.publish();
  await new Promise(r=>setTimeout(r,200));
  assert.equal((await get(e.id)).status,'WAITING_SAFE_STATE','no Run, unsafe: nothing sent');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  await new Promise(r=>setTimeout(r,200));
  assert.equal(game.received.filter(c=>c.command==='game.battle.start').length,0,'unsafe: never sent');
  // The player comes back to the overworld: sent with the exact frozen spec.
  game.setSafe(true);
  await until(()=>game.battle.active===e.id,'battle armed');
  const sent=game.received.find(c=>c.command==='game.battle.start')!;
  assert.deepEqual(sent.payload,{encounterId:e.id,trainer:{name:'TIMÉO',spriteId:'cooltrainer_m'},party:[{speciesId:19,level:3,moves:[33,39],heldItem:0,nature:4,ev:0}],options:{rewardMode:'GAME_DEFAULT'}});
  await eventually(async()=>(await get(e.id)).status==='STARTING','starting');
  game.battleStarted();await eventually(async()=>(await get(e.id)).status==='RUNNING','running');
  game.endBattle('WIN');
  await eventually(async()=>(await get(e.id)).status==='WON','won');
  assert.equal((await get(e.id)).result!.outcome,'WIN');
  assert.equal(game.received.filter(c=>c.command==='game.battle.start').length,1,'sent once');
  await until(()=>notes.some(n=>n.includes('Victoire de Ben contre TIMÉO')),'victory notification');
  const actions=((await as(admin.id).get(`/api/lobbies/${lobby.id}/audit?category=BATTLE`)).body as {action:string}[]).map(l=>l.action).reverse();
  assert.deepEqual(actions,['battle.created','battle.start_requested','battle.sent','battle.started','battle.won']);

  // The player moved between the observation and the write: the client refuses, the battle waits again.
  game.safe=false;// the player just moved: the last published state still says safe
  const second=await create();// sent at once with that state, refused by the game
  await until(()=>game.received.filter(c=>c.command==='game.battle.start').length===2,'second attempt');
  await eventually(async()=>(await get(second.id)).status==='WAITING_SAFE_STATE','back in the queue');
  game.setSafe(false);game.setSafe(true);// back on the overworld
  await until(()=>game.battle.active===second.id,'armed on the next safe moment');
  const attempts=game.received.filter(c=>c.command==='game.battle.start');
  assert.equal(new Set(attempts.map(c=>c.commandId)).size,attempts.length,'a fresh command id per attempt');
  game.battleStarted();game.endBattle('LOSS');
  await eventually(async()=>(await get(second.id)).status==='LOST','lost');
  await until(()=>notes.some(n=>n.includes('Défaite de Ben contre TIMÉO')),'defeat notification');

  // Lost ACK: REVIEW, never re-sent; the reconnected client reports the battle, then its result.
  game.mode='ack-lost';
  const third=await create();
  await eventually(async()=>(await get(third.id)).status==='REVIEW','review');
  const before=game.received.length;
  game.publish();await new Promise(r=>setTimeout(r,150));
  assert.equal(game.received.length,before,'never re-sent automatically');
  game.mode='apply';game.battle={...game.battle,state:'RUNNING'};
  game=await game.reconnect();closers.push(()=>game.close());
  await eventually(async()=>(await get(third.id)).status==='RUNNING','reconciled RUNNING');
  game.endBattle('DRAW');
  await eventually(async()=>(await get(third.id)).status==='LOST','draw counts as a defeat');
  assert.equal((await get(third.id)).result!.outcome,'DRAW');

  // An uncertain start the client never saw: an admin cancels it.
  game.mode='timeout';
  const fourth=await create();
  await eventually(async()=>(await get(fourth.id)).status==='REVIEW','review again');
  game.battle={active:null,state:null,last:game.battle.last,spec:null};game.mode='apply';game.publish();
  await new Promise(r=>setTimeout(r,150));
  assert.equal((await get(fourth.id)).status,'REVIEW','unknown to the client: still for an admin');
  assert.equal((await as(admin.id).post(`${path}/${fourth.id}/cancel`)).body.status,'CANCELLED');
  assert.equal(portal.services.battles.active(lobby.id,ben.id),undefined);
 }finally{for(const c of closers)c();await p.close();}
});
