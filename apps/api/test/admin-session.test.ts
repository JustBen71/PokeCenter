import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';

// Production mode (ADMIN_TOKEN set): accounts are public to pick, so the admin role is a session given by the server password.
test('admin session: no role at creation, server password gives a signed session for that account only, attempts limited',async()=>{
 const portal=createPortal(new Store(':memory:'),{adminToken:'mot-de-passe-du-serveur',corsOrigin:'http://localhost',offlineAfterMs:15000});
 const app=portal.app;
 const as=(id:string,token?:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id).set('x-admin-token',token??''),
  post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).set('x-admin-token',token??'').send(b)});
 const lea=(await request(app).post('/api/accounts').send({name:'Léa',sprite:'may',admin:true})).body;
const tom=(await request(app).post('/api/accounts').send({name:'Tom',sprite:'may',admin:false})).body;
assert.ok(lea.id,JSON.stringify(lea));assert.equal(lea.admin,false,'the role is never declared at creation');
 assert.deepEqual((await request(app).get('/api/admin/session')).body,{passwordRequired:true});
 assert.equal((await as(lea.id).post('/api/lobbies',{name:'Course'})).body.error.code,'ADMIN_REQUIRED');

 assert.equal((await as(lea.id).post('/api/admin/session',{password:'faux'})).body.error.code,'FORBIDDEN');
 const {token}=(await as(lea.id).post('/api/admin/session',{password:'mot-de-passe-du-serveur'})).body;
 assert.match(token,/^\d+\.[a-f0-9]{64}$/);
 assert.equal((await as(lea.id,token).get('/api/me')).body.admin,true);
 assert.equal((await as(lea.id,token).post('/api/lobbies',{name:'Course'})).status,201);
 // Bound to Léa: useless with Tom's account, a forged or expired token is nobody's.
 assert.equal((await as(tom.id,token).get('/api/me')).body.admin,false);
 assert.equal((await as(lea.id,`${Date.now()+1e9}.${'0'.repeat(64)}`).get('/api/me')).body.admin,false);
 assert.equal((await as(lea.id,`1.${token.split('.')[1]}`).get('/api/me')).body.admin,false);
 assert.equal((await as(lea.id).get('/api/me')).body.admin,false,'no token, no role');
 // 10 failures per address per 15 minutes, then refused even with the right password.
 for(let i=0;i<10;i++)await as(tom.id).post('/api/admin/session',{password:'x'});
 const blocked=(await as(tom.id).post('/api/admin/session',{password:'mot-de-passe-du-serveur'})).body.error;
 assert.match(blocked.message,/Trop d’essais/);
 portal.server.close();
});
