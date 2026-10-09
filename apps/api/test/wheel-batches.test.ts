import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {WheelType} from '@pokerace/shared';
import {passivePortal,startPortal} from './support/passive-portal.js';
import {until} from './support/fake-game-client.js';

// « Lancer à tous » is persisted (wheel_batches / wheel_batch_items): resumed after a restart, never twice for a player.
async function setup(file?:string){
 const p=await passivePortal({file});
 const {as,admin,lobby}=p,path=`/api/lobbies/${lobby.id}`;
 const wheel=async(name:string,tone:'GOOD'|'BAD',handler='NOTICE',params={})=>(await as(admin.id).post(`${path}/wheels`,{name,price:0,icon:tone==='BAD'?'purple-1':'green-1',tone,
  gages:[{name:'Gage',handler,params}]})).body as WheelType;
 for(const id of [admin.id,p.ben.id,p.tim.id])await as(admin.id).post(`${path}/runs`,{accountId:id,start:true});
 return {...p,path,wheel};
}
const rows=(db:import('better-sqlite3').Database,sql:string,...args:unknown[])=>db.prepare(sql).all(...args) as Record<string,any>[];
const resolutions=(db:import('better-sqlite3').Database)=>rows(db,'SELECT owner_account_id AS owner,target_account_id AS target,status,wheel_type_id AS wheel,batch_id AS batch FROM wheel_resolutions ORDER BY rowid');

test('wheel batch: three players processed once, hostile wheel on each owner, an error does not stop the next players',async()=>{
 const t=await setup();
 try{
  const bad=await t.wheel('Malus','BAD');
  assert.deepEqual((await t.as(t.admin.id).post(`${t.path}/wheels/${bad.id}/spin-all`)).body,{players:3});
  await until(()=>rows(t.store.db,"SELECT * FROM wheel_batches WHERE status='DONE'").length===1,'batch done');
  const r=resolutions(t.store.db);
  assert.equal(r.length,3);assert.ok(r.every(x=>x.status==='SUCCESS'&&x.target===x.owner&&x.batch));
  assert.deepEqual(rows(t.store.db,'SELECT status FROM wheel_batch_items ORDER BY position').map(i=>i.status),['DONE','DONE','DONE']);
  // A player who left the lobby between launch and draw: FAILED for him only.
  const good=await t.wheel('Bonus','GOOD');
  const batch=randomUUID(),now=new Date().toISOString();
  t.store.db.prepare("INSERT INTO wheel_batches(id,lobby_id,wheel_type_id,created_by,launcher_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'PENDING',?,?)").run(batch,t.lobby.id,good.id,t.admin.id,t.admin.id,now,now);
  for(const [i,id] of [t.ben.id,'not-a-member',t.tim.id].entries())t.store.db.prepare("INSERT INTO wheel_batch_items(batch_id,account_id,position,status,updated_at) VALUES(?,?,?,'PENDING',?)").run(batch,id,i,now);
  t.portal.services.wheels.resumeBatches();
  await until(()=>rows(t.store.db,"SELECT * FROM wheel_batches WHERE id=? AND status='FAILED'",batch).length===1,'batch finished');
  assert.deepEqual(rows(t.store.db,'SELECT status FROM wheel_batch_items WHERE batch_id=? ORDER BY position',batch).map(i=>i.status),['DONE','FAILED','DONE']);
  assert.equal(resolutions(t.store.db).filter(x=>x.batch===batch).length,2);
 }finally{await t.close();}
});

test('wheel batch: two launches and the automatic wheel never interleave',async()=>{
 const t=await setup();
 try{
  const good=await t.wheel('Bonus','GOOD'),bad=await t.wheel('Malus','BAD'),auto=await t.wheel('Horloge','GOOD');
  await t.as(t.admin.id).put(`${t.path}/wheels-auto`,{wheelId:auto.id,everyMinutes:1});
  const w=t.portal.services.wheels;
  w.tickAutoWheels(Date.now()+2*60000);w.spinAll(t.lobby.id,good.id,t.admin);w.spinAll(t.lobby.id,bad.id,t.admin);
  await until(()=>resolutions(t.store.db).length===9,'three launches');
  assert.deepEqual(resolutions(t.store.db).map(r=>r.wheel),[auto.id,auto.id,auto.id,good.id,good.id,good.id,bad.id,bad.id,bad.id]);
  // A second resolution for the same player of the same batch is refused by the database itself.
  const first=resolutions(t.store.db)[0]!;
  assert.throws(()=>t.store.db.prepare("UPDATE wheel_resolutions SET owner_account_id=? WHERE rowid=2").run(first.owner),/UNIQUE/);
 }finally{await t.close();}
});

test('wheel batch: an API restart resumes the remaining players only, and a draw made before the restart is never drawn again',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pokerace-batches-')),file=join(dir,'portal.sqlite');
 try{
  const t=await setup(file);
  const good=await t.wheel('Bonus','GOOD');
  const players=[t.admin.id,t.ben.id,t.tim.id],wheels=t.portal.services.wheels;
  // State left by a crash: player 1 done; player 2 drawn but the item not updated yet; player 3 pending.
  const batch=randomUUID(),now=new Date().toISOString();
  t.store.db.prepare("INSERT INTO wheel_batches(id,lobby_id,wheel_type_id,created_by,launcher_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'PROCESSING',?,?)").run(batch,t.lobby.id,good.id,t.admin.id,t.admin.id,now,now);
  for(const [i,id] of players.entries())t.store.db.prepare("INSERT INTO wheel_batch_items(batch_id,account_id,position,status,updated_at) VALUES(?,?,?,?,?)").run(batch,id,i,i===0?'DONE':i===1?'PROCESSING':'PENDING',now);
  const done=wheels.spin(t.lobby.id,good.id,{ownerId:players[0]},t.admin,null,null,batch);await wheels.apply(t.lobby.id,done.id,{},t.admin);
  t.store.db.prepare('UPDATE wheel_batch_items SET resolution_id=? WHERE batch_id=? AND position=0').run(done.id,batch);
  const drawn=wheels.spin(t.lobby.id,good.id,{ownerId:players[1]},t.admin,null,null,batch);
  await t.close();t.store.close();
  // Restart: same SQLite file, new portal; resumed at startup.
  const again=await startPortal({file});
  try{
   await until(()=>rows(again.store.db,"SELECT * FROM wheel_batches WHERE id=? AND status='DONE'",batch).length===1,'resumed');
   const r=resolutions(again.store.db).filter(x=>x.batch===batch);
   assert.deepEqual(r.map(x=>x.owner),players,'exactly one per player, in order');
   assert.ok(r.every(x=>x.status==='SUCCESS'),'the draw made before the restart is applied, not drawn again');
   assert.equal(rows(again.store.db,'SELECT resolution_id AS id FROM wheel_batch_items WHERE batch_id=? AND position=1',batch)[0]!.id,drawn.id);
   // Nothing left to resume: a later tick does nothing.
   again.portal.services.wheels.resumeBatches();await new Promise(res=>setTimeout(res,100));
   assert.equal(resolutions(again.store.db).filter(x=>x.batch===batch).length,3);
  }finally{await new Promise<void>(res=>again.portal.server.close(()=>res()));again.store.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('wheel batch: a player without a connected game still gets his draw; the gage waits for an admin',async()=>{
 const t=await setup();
 try{
  const money=await t.wheel('Argent','GOOD','GIVE_MONEY',{amount:100});
  await t.as(t.admin.id).post(`${t.path}/wheels/${money.id}/spin-all`);
  await until(()=>rows(t.store.db,"SELECT * FROM wheel_batches WHERE status IN ('DONE','FAILED')").length===1,'batch finished');
  const r=resolutions(t.store.db);
  assert.equal(r.length,3,'one draw per player, nobody skipped');
  assert.ok(r.every(x=>x.status==='DRAWN'),'not applied without a game: kept DRAWN for an admin, never re-drawn');
  assert.deepEqual(rows(t.store.db,'SELECT status FROM wheel_batch_items').map(i=>i.status),['DONE','DONE','DONE']);
 }finally{await t.close();}
});
