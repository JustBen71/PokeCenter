import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {io as client} from 'socket.io-client';
import {passiveCatalog,type PassivesSnapshot} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {until} from './support/fake-game-client.js';

export async function passivePortal(options:{implemented?:ReadonlySet<string>;random?:(n:number)=>number;commandTimeoutMs?:number}={}){
 const store=new Store(':memory:');
 const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:options.commandTimeoutMs??300,
  passives:{implemented:options.implemented??new Set(passiveCatalog.map(p=>p.id)),random:options.random}});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const app=portal.app;
 const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b),patch:(p:string,b:object)=>request(app).patch(p).set('x-account-id',id).send(b)});
 const account=async(name:string,admin=false)=>(await request(app).post('/api/accounts').send({name,sprite:'may',admin})).body as {id:string;name:string};
 const admin=await account('Admin',true),ben=await account('Ben'),tim=await account('Tim');
 const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body as {id:string;inviteCode:string};
 for(const p of [ben,tim])await as(p.id).post('/api/lobbies/join',{code:lobby.inviteCode});
 const passives=`/api/lobbies/${lobby.id}/passives`;
 const snapshot=async(id:string)=>(await as(id).get(passives)).body as PassivesSnapshot;
 return {store,portal,base,app,as,admin,ben,tim,lobby,passives,snapshot,close:()=>new Promise<void>(r=>portal.server.close(()=>r()))};
}

test('passive selection: private offers, one persistent choice, admin reset and race start',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,tim,lobby,passives,snapshot}=p;
  assert.equal((await snapshot(ben.id)).phase,'NONE');
  assert.equal((await as(ben.id).post(`${passives}/selection/start`)).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await as(ben.id).post(`${passives}/choose`,{passiveId:'scout'})).body.error.code,'CONFLICT','no choice before the selection');

  const dashboard=client(p.base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:tim.id},transports:['websocket'],reconnection:false});closers.push(()=>dashboard.close());
  const pushed:PassivesSnapshot[]=[];dashboard.on('passives',(s:PassivesSnapshot)=>pushed.push(s));
  await until(()=>dashboard.connected,'dashboard');

  const started=(await as(admin.id).post(`${passives}/selection/start`)).body as PassivesSnapshot;
  assert.equal(started.phase,'SELECTION');
  assert.deepEqual(started.selection.map(s=>s.status),['WAITING','WAITING','WAITING'],'admin, Ben and Tim');
  assert.equal((await as(admin.id).post(`${passives}/selection/start`)).body.error.code,'CONFLICT');

  // Three different, offerable cards; the same offer comes back after a reload.
  const benOffer=(await snapshot(ben.id)).myOffer!;
  assert.equal(benOffer.length,3);assert.equal(new Set(benOffer).size,3);
  const offerable=new Set(started.catalog.filter(c=>c.availability==='AVAILABLE').map(c=>c.id));
  assert.ok(benOffer.every(id=>offerable.has(id)));
  assert.ok(started.catalog.some(c=>c.id==='marathoner'&&c.availability==='DISABLED_MISSING_CAPABILITY'));
  assert.deepEqual((await snapshot(ben.id)).myOffer,benOffer);
  // Offers are private: Tim's live snapshot only carries his own cards.
  await until(()=>pushed.some(s=>s.phase==='SELECTION'),'live selection');
  const timOffer=(await snapshot(tim.id)).myOffer!;
  assert.deepEqual(pushed.filter(s=>s.phase==='SELECTION').at(-1)!.myOffer,timOffer);
  assert.equal(JSON.stringify(pushed).includes(JSON.stringify(benOffer)),false);

  // A card outside the player's offer, or for someone else, is refused.
  const outside=[...offerable].find(id=>!benOffer.includes(id))!;
  assert.equal((await as(ben.id).post(`${passives}/choose`,{passiveId:outside})).body.error.code,'CONFLICT');
  assert.equal((await as(tim.id).post(`${passives}/choose`,{passiveId:benOffer[0],accountId:ben.id})).body.error.code,'VALIDATION_FAILED');
  const chosen=(await as(ben.id).post(`${passives}/choose`,{passiveId:benOffer[1]})).body;
  assert.equal(chosen.passiveId,benOffer[1]);assert.equal(chosen.source,'INITIAL_CHOICE');
  assert.equal((await as(ben.id).post(`${passives}/choose`,{passiveId:benOffer[2]})).body.error.code,'CONFLICT','double choice');
  const statuses=(p.store.db.prepare('SELECT status FROM passive_offers WHERE account_id=? ORDER BY offer_index').all(ben.id) as {status:string}[]).map(r=>r.status);
  assert.deepEqual(statuses,['REJECTED','CHOSEN','REJECTED']);
  // The chosen passive is public.
  await until(()=>pushed.some(s=>s.owned.some(o=>o.accountId===ben.id)),'public choice');

  // Not everyone chose: the race does not start without force.
  assert.equal((await as(admin.id).post(`${passives}/race/start`)).body.error.code,'CONFLICT');
  // Admin resets Tim's offer (new generation) and cancels Ben's choice (same three cards).
  await as(admin.id).post(`${passives}/offers/reset`,{accountId:tim.id});
  const newTim=(await snapshot(tim.id)).myOffer!;assert.equal(newTim.length,3);
  assert.equal((p.store.db.prepare("SELECT COUNT(*) AS n FROM passive_offers WHERE account_id=? AND status='CANCELLED'").get(tim.id) as {n:number}).n,3);
  await as(admin.id).post(`${passives}/offers/cancel-choice`,{accountId:ben.id});
  assert.deepEqual((await snapshot(ben.id)).myOffer,benOffer);
  assert.equal((await snapshot(ben.id)).owned.length,0,'the cancelled choice is removed');

  for(const [id,card] of [[ben.id,benOffer[0]],[tim.id,newTim[0]],[admin.id,(await snapshot(admin.id)).myOffer![0]]] as const)
   assert.equal((await as(id).post(`${passives}/choose`,{passiveId:card})).status,200);
  const done=(await as(admin.id).post(`${passives}/race/start`)).body as PassivesSnapshot;
  assert.equal(done.phase,'DONE');assert.equal(done.myOffer,null);
  assert.equal((await as(admin.id).get(`/api/lobbies/${lobby.id}`)).body.status,'RUNNING');
  assert.equal((await as(admin.id).post(`${passives}/offers/reset`,{accountId:tim.id})).body.error.code,'CONFLICT','frozen after the start');

  // Passives belong to the race, not to a Run.
  const run=(await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true})).body;
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs/${run.id}/status`,{status:'LOST'});
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  assert.deepEqual((await snapshot(ben.id)).owned.filter(o=>o.accountId===ben.id).map(o=>o.passiveId),[benOffer[0]]);

  // Admin grant / revoke, audited.
  const extra=[...offerable].find(id=>id!==benOffer[0])!;
  assert.equal((await as(ben.id).post(`${passives}/grant`,{accountId:ben.id,passiveId:extra})).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await as(admin.id).post(`${passives}/grant`,{accountId:ben.id,passiveId:extra})).status,201);
  assert.equal((await as(admin.id).post(`${passives}/grant`,{accountId:ben.id,passiveId:extra})).body.error.code,'PASSIVE_ALREADY_OWNED');
  assert.equal((await as(admin.id).post(`${passives}/revoke`,{accountId:ben.id,passiveId:extra})).status,200);
  const logs=(await as(admin.id).get(`/api/lobbies/${lobby.id}/audit?category=PASSIVE`)).body;
  assert.ok(JSON.stringify(logs).includes('passive.selection.start'));
  // Rewards are only visible to admins.
  assert.ok(Array.isArray((await snapshot(admin.id)).rewards));assert.equal((await snapshot(ben.id)).rewards,undefined);
 }finally{for(const c of closers)c();await p.close();}
});
