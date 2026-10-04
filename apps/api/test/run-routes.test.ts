import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {io as client} from 'socket.io-client';
import type {Run} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';

test('admins manage Runs, members read them and dashboards receive changes live',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const sockets:ReturnType<typeof client>[]=[];
 try{
  const app=portal.app;
  const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const outsider=(await request(app).post('/api/accounts').send({name:'Out',sprite:'may',admin:false})).body;
  const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b)});
  const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
  await as(ben.id).post('/api/lobbies/join',{code:lobby.inviteCode});

  const dashboard=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:ben.id},transports:['websocket'],reconnection:false});sockets.push(dashboard);
  let live:Run[]=[];let members=0;
  const firstRuns=new Promise<void>(r=>dashboard.once('runs',(rows:Run[])=>{live=rows;r();}));
  dashboard.on('lobby',(l:{members:unknown[]})=>{members=l.members.length;});
  await firstRuns;assert.deepEqual(live,[]);assert.equal(members,2);
  const nextRuns=()=>new Promise<Run[]>(r=>dashboard.once('runs',r));

  const runs=`/api/lobbies/${lobby.id}/runs`;
  assert.equal((await as(ben.id).post(runs,{accountId:ben.id,start:true})).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await as(admin.id).post(runs,{accountId:outsider.id})).body.error.code,'NOT_LOBBY_MEMBER');
  let update=nextRuns();
  const first=(await as(admin.id).post(runs,{accountId:ben.id,start:true})).body as Run;
  assert.equal(first.status,'RUNNING');assert.equal((await update).length,1);
  assert.equal((await as(admin.id).post(runs,{accountId:ben.id,start:true})).body.error.code,'RUN_ALREADY_RUNNING');
  update=nextRuns();
  assert.equal((await as(admin.id).post(`${runs}/${first.id}/status`,{status:'LOST'})).body.status,'LOST');
  assert.equal((await update)[0].status,'LOST');
  assert.equal((await as(admin.id).post(`${runs}/${first.id}/status`,{status:'RUNNING'})).body.error.code,'INVALID_RUN_TRANSITION');
  const second=(await as(admin.id).post(runs,{accountId:ben.id})).body as Run;
  assert.equal(second.number,2);assert.equal(second.status,'NOT_STARTED');
  assert.equal((await as(admin.id).post(`${runs}/${second.id}/status`,{status:'RUNNING'})).body.status,'RUNNING');
  // Members read the history; outsiders do not.
  assert.deepEqual((await as(ben.id).get(runs)).body.map((r:Run)=>[r.number,r.status]),[[2,'RUNNING'],[1,'LOST']]);
  assert.equal((await as(outsider.id).get(runs)).body.error.code,'NOT_LOBBY_MEMBER');
  // A run of another lobby cannot be changed through this lobby.
  const other=(await as(admin.id).post('/api/lobbies',{name:'Autre'})).body;
  assert.equal((await as(admin.id).post(`/api/lobbies/${other.id}/runs/${second.id}/status`,{status:'COMPLETED'})).body.error.code,'RUN_NOT_FOUND');
  // A new member is pushed to existing dashboards.
  const joined=new Promise<void>(r=>dashboard.on('lobby',(l:{members:unknown[]})=>{if(l.members.length===3)r();}));
  await as(outsider.id).post('/api/lobbies/join',{code:lobby.inviteCode});await joined;
  assert.equal(store.portal!.audit.list({category:'RUN'}).length,4);
 }finally{sockets.forEach(s=>s.close());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
