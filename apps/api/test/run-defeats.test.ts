import test from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import type {LobbyNotification,Run} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,rawPokemon,until} from './support/fake-game-client.js';

async function eventually(check:()=>Promise<boolean>,label:string){for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw new Error(`Timed out waiting for ${label}`);}

test('end of Run in the game: fainted Pokémon boxed, defeat = Run lost + new Run + game reset, once per event',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,lobby,base,portal}=p;
  portal.services.passives.grant(lobby.id,ben.id,'second-wind','ADMIN');
  const runs=async()=>((await as(admin.id).get(`/api/lobbies/${lobby.id}/runs`)).body as Run[]).filter(r=>r.accountId===ben.id).sort((a,b)=>a.number-b.number);
  const audit=async()=>((await as(admin.id).get(`/api/lobbies/${lobby.id}/audit?category=RUN`)).body as {action:string;message:string}[]).reverse();
  const watch=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:ben.id},transports:['websocket'],reconnection:false});closers.push(()=>watch.close());
  const notes:string[]=[];watch.on('notification',(n:LobbyNotification)=>notes.push(n.message));
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',defeats:true,party:[rawPokemon(1,5,'ALPHA'),rawPokemon(1,5,'BETA')]});
  closers.push(()=>game.close());
  const boxCommands=()=>game.received.filter(c=>c.command==='game.party.box_fainted').length;

  // No Run: a fainted Pokémon stays in the party.
  game.faint(2);await new Promise(r=>setTimeout(r,200));
  assert.equal(boxCommands(),0);
  // During a Run it goes to the PC box, once, with the party count observed by the server.
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  await until(()=>game.box.length===1,'boxed');
  assert.deepEqual(game.received.find(c=>c.command==='game.party.box_fainted')!.payload,{expectedCount:2});
  assert.equal(game.party.length,1);
  await until(()=>notes.some(n=>n.includes('BETA (Bulbizarre, niv. 5) de Ben est tombé')),'boxed notification');
  // Not free on the overworld (battle, script): it waits for the next safe observation.
  game.setSafe(false);game.party.push(rawPokemon(1,5,'GAMMA'));game.faint(2);
  await new Promise(r=>setTimeout(r,200));
  assert.equal(boxCommands(),1);
  game.setSafe(true);
  await until(()=>game.box.length===2,'boxed when safe');
  // PC full: refused by the game, said once, not sent again while the party does not change.
  game.mode={refuse:'box_full'};game.party.push(rawPokemon(1,5,'DELTA'));game.faint(game.party.length);
  await until(()=>notes.some(n=>n.includes('PC de Ben plein')),'PC full notification');
  const refusedCount=boxCommands();
  for(let i=0;i<5;i++){game.publish();await new Promise(r=>setTimeout(r,40));}
  assert.equal(boxCommands(),refusedCount,'not sent again for the same party');
  game.mode='apply';game.party.pop();game.publish();
  // The whole party down is a defeat, never a box move.
  const before=boxCommands();game.faint(1);await new Promise(r=>setTimeout(r,200));
  assert.equal(boxCommands(),before);

  // In-game defeat: Run #1 lost, Run #2 started, the game is reset without its save. Reported while the game is
  // unreadable (end of a battle): it waits for the next readable state instead of being refused.
  const eventId='6f1c0d6e-3a52-4c55-9d43-0d1c51f0a0aa';
  game.unreadable();
  const pending=game.defeated('WHITE_OUT',eventId);
  await new Promise(r=>setTimeout(r,150));
  assert.equal(game.resets,0,'not processed while unreadable');
  game.publish();
  assert.equal((await pending)?.ok,true);
  await until(()=>game.resets===1,'reset');
  assert.deepEqual((await runs()).map(r=>[r.number,r.status]),[[1,'LOST'],[2,'RUNNING']]);
  await eventually(async()=>(await audit()).some(l=>l.action==='run.reset'),'reset audited');
  const log=await audit();
  assert.deepEqual(log.map(l=>l.action).filter(a=>['run.lost','run.create','run.reset'].includes(a)),['run.create','run.lost','run.create','run.reset']);
  assert.match(log.find(l=>l.action==='run.lost')!.message,/Run #1 de Ben perdue dans le jeu \(équipe K.O., renvoyé au Centre Pokémon\)/);
  assert.match(log.find(l=>l.action==='run.reset')!.message,/lost-1/);
  await until(()=>notes.some(n=>n.includes('Ben a perdu sa Run #1')),'defeat notification');
  // « Deuxième souffle » pays the new Run in the new game, never in the game about to be erased.
  await until(()=>game.received.some(c=>c.command==='game.money.add'),'second wind paid');
  const order=game.received.map(c=>c.command).filter(c=>c==='game.reset'||c==='game.money.add');
  assert.deepEqual(order,['game.reset','game.money.add']);
  // The player's journal (readable by members): defeat, fallen Pokémon, reset.
  const journal=(await as(p.tim.id).get(`/api/lobbies/${lobby.id}/runs/journal?accountId=${ben.id}`)).body as {action:string}[];
  assert.deepEqual(journal.map(j=>j.action).sort(),['pokemon.boxed','pokemon.boxed','run.lost','run.reset']);
  // A re-sent event (lost ACK) never ends the new Run nor resets twice.
  assert.equal((await game.defeated('WHITE_OUT',eventId))?.ok,true);
  await new Promise(r=>setTimeout(r,200));
  assert.equal(game.resets,1);
  assert.deepEqual((await runs()).map(r=>r.status),['LOST','RUNNING']);

  // A defeat outside a running Run is only logged.
  const current=(await runs())[1]!;
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs/${current.id}/status`,{status:'ABORTED'});
  await game.defeated('PARTY_FAINTED');
  await eventually(async()=>(await audit()).some(l=>l.action==='run.defeat_ignored'),'ignored defeat');
  assert.equal((await runs()).length,2);
  assert.equal(game.resets,1);
 }finally{for(const c of closers)c();await p.close();}
});

test('end of Run without the reset capability: Run lost and new Run, manual restart asked',async()=>{
 const p=await passivePortal();
 try{
  const {as,admin,ben,lobby,base}=p;
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',events:['events.player_defeated']});
  try{
   await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
   game.faint(1);// a lost battle leaves the whole team fainted (no blackout)
   assert.equal((await game.defeated('BATTLE_LOST'))?.ok,true);
   await eventually(async()=>((await as(admin.id).get(`/api/lobbies/${lobby.id}/audit?category=RUN`)).body as {action:string}[]).some(l=>l.action==='run.reset_failed'),'manual restart asked');
   assert.equal(game.received.filter(c=>c.command==='game.reset').length,0);
   const statuses=async()=>((await as(admin.id).get(`/api/lobbies/${lobby.id}/runs`)).body as Run[]).filter(r=>r.accountId===ben.id).map(r=>r.status).sort();
   assert.deepEqual(await statuses(),['LOST','RUNNING']);
   // Not reset: the same fainted team reported again (client restarted) never ends the new Run.
   assert.equal((await game.defeated('PARTY_FAINTED'))?.ok,true);
   const audit=async()=>((await as(admin.id).get(`/api/lobbies/${lobby.id}/audit?category=RUN`)).body as {action:string}[]).map(l=>l.action);
   await eventually(async()=>(await audit()).includes('run.defeat_ignored'),'old game ignored');
   assert.deepEqual(await statuses(),['LOST','RUNNING']);
   // A new game (a team standing again): defeats count again.
   game.party=[rawPokemon()];game.publish();
   await eventually(async()=>(await audit()).includes('run.new_game'),'new game seen');
   assert.equal((await game.defeated('WHITE_OUT'))?.ok,true);
   await eventually(async()=>(await statuses()).join()==='LOST,LOST,RUNNING','next defeat counted');
  }finally{game.close();}
 }finally{await p.close();}
});
