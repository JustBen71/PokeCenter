import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type {AuditLog} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import {sendError} from '../src/errors.js';
import {FakeGameClient,until} from './support/fake-game-client.js';

test('audit trail: admin only, filters, entry details with linked transactions and command, audited internal errors',async()=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:300});
 await new Promise<void>(r=>portal.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(portal.server.address() as {port:number}).port}`;
 const closers:(()=>void)[]=[];
 try{
  const app=portal.app;
  const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
  const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
  const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b)});
  const lobby=(await as(admin.id).post('/api/lobbies',{name:'Course'})).body;
  await as(ben.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben'});closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'game');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
  await as(admin.id).post(`/api/lobbies/${lobby.id}/players/${ben.id}/money`,{operation:'add',amount:250,reason:'test'});
  game.mode={refuse:'state_changed'};
  await as(admin.id).post(`/api/lobbies/${lobby.id}/players/${ben.id}/money`,{operation:'add',amount:1});
  const audit=`/api/lobbies/${lobby.id}/audit`;

  assert.equal((await as(ben.id).get(audit)).body.error.code,'ADMIN_REQUIRED');
  const all=(await as(admin.id).get(audit)).body as AuditLog[];
  // Global account events and lobby events, newest first.
  assert.ok(all.some(l=>l.category==='ACCOUNT'&&l.lobbyId===null));
  assert.ok(all.some(l=>l.category==='LOBBY'));assert.ok(all.some(l=>l.category==='RUN'));
  assert.ok(Date.parse(all[0].timestamp)>=Date.parse(all.at(-1)!.timestamp));
  const commands=(await as(admin.id).get(`${audit}?category=GAME_COMMAND`)).body as AuditLog[];
  assert.deepEqual(commands.map(l=>l.status).sort(),['FAILED','SUCCESS']);
  const errors=(await as(admin.id).get(`${audit}?outcome=error`)).body as AuditLog[];
  assert.ok(errors.length>=2&&errors.every(l=>['FAILED','REVIEW'].includes(l.status)));
  assert.ok((await as(admin.id).get(`${audit}?accountId=${ben.id}`)).body.every((l:AuditLog)=>l.actorAccountId===ben.id||l.targetAccountId===ben.id));
  assert.equal((await as(admin.id).get(`${audit}?category=NOPE`)).body.error.code,'VALIDATION_FAILED');

  // One entry opened: its game command, the money rows and every entry sharing the command id.
  const success=commands.find(l=>l.status==='SUCCESS')!;
  const details=(await as(admin.id).get(`${audit}/${success.id}`)).body;
  assert.equal(details.command.status,'COMPLETED');
  assert.deepEqual(details.transactions.map((t:{type:string;status:string})=>[t.type,t.status]),[['ADMIN_ADJUSTMENT','CONFIRMED']]);
  assert.ok(details.related.length>=2);
  assert.equal((await as(admin.id).get(`${audit}?commandId=${success.commandId}`)).body.length,details.related.length);
  assert.equal((await as(admin.id).get(`${audit}/unknown`)).body.error.code,'NOT_FOUND');
  // Nothing secret in the stored metadata.
  assert.doesNotMatch(JSON.stringify(all),/sessionToken|ADMIN_TOKEN|"raw":"[0-9a-f]{20}/);

  // An unexpected failure is answered generically and audited as ERROR.
  const res={req:{method:'POST',originalUrl:`/api/lobbies/${lobby.id}/bank/deposit`},status(){return this;},json(body:unknown){(res as any).body=body;return this;}} as any;
  sendError(res,new Error('disk full'));
  assert.deepEqual(res.body,{ok:false,error:{code:'INTERNAL_ERROR',message:'Erreur interne du serveur'}});
  const logged=(await as(admin.id).get(`${audit}?category=ERROR`)).body as AuditLog[];
  assert.equal(logged[0].errorCode,'INTERNAL_ERROR');assert.equal(logged[0].metadata.error,'disk full');
 }finally{closers.forEach(c=>c());for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
});
