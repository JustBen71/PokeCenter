import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import request from 'supertest';
import type {BattleEncounter} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

async function eventually(check:()=>Promise<boolean>,label:string){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw new Error(`Timed out waiting for ${label}`);}
async function start(path:string){
 const store=new Store(path);
 const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:300});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 return {store,portal,base:`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`,
  stop:async()=>{for(const c of portal.running.values())c.io.engine.close();await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}};
}

test('battle resilience: the server restarts during a battle, the reconnected client reports the result once',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'pokerace-battle-restart-'));
 const path=join(folder,'portal.sqlite');
 let game:FakeGameClient|undefined;
 type Server=Awaited<ReturnType<typeof start>>;
 let first:Server|undefined,second:Server|undefined;const stopped:Server[]=[];
 try{
  first=await start(path);
  const as=(app:Server['portal']['app'],id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b)});
  const admin=(await request(first.portal.app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(first.portal.app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const lobby=(await as(first.portal.app,admin.id).post('/api/lobbies',{name:'Course'})).body;
  await as(first.portal.app,ben.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  game=await FakeGameClient.connect({base:first.base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',battles:true});
  await until(()=>!!first!.portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'game');
  await as(first.portal.app,admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  const created=(await as(first.portal.app,admin.id).post(`/api/lobbies/${lobby.id}/battles`,{accountId:ben.id,builder:{type:'CUSTOM',party:[{speciesId:19,level:3,moves:[33],nature:0}]}})).body as BattleEncounter;
  await as(first.portal.app,admin.id).post(`/api/lobbies/${lobby.id}/battles/${created.id}/start`);
  await until(()=>game!.battle.active===created.id,'armed');
  game.battleStarted();
  const status=async(app:Server['portal']['app'])=>((await as(app,admin.id).get(`/api/lobbies/${lobby.id}/battles/${created.id}`)).body as BattleEncounter).status;
  await eventually(async()=>await status(first.portal.app)==='RUNNING','running');

  // The server goes down mid-battle; the battle ends meanwhile; the client comes back to a new server process.
  game.close();await first.stop();stopped.push(first);
  game.endBattle('WIN');
  second=await start(path);
  // Same installation, same battle state (battle-encounters.json), new server address.
  const state=game.battle;
  game=await FakeGameClient.connect({base:second.base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',battles:true});
  game.battle=state;game.publish();
  await eventually(async()=>await status(second.portal.app)==='WON','won after the restart');
  assert.equal(game.received.filter(c=>c.command==='game.battle.start').length,0,'never re-sent by the new server');
  const actions=((await as(second.portal.app,admin.id).get(`/api/lobbies/${lobby.id}/audit?category=BATTLE`)).body as {action:string}[]).map(l=>l.action);
  assert.equal(actions.filter(a=>a==='battle.won').length,1);
 }finally{
  game?.close();
  for(const s of [first,second])if(s&&!stopped.includes(s))await s.stop();
  rmSync(folder,{recursive:true,force:true});
 }
});
