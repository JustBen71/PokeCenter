import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';

const withPortal=async(run:(ctx:{app:ReturnType<typeof createPortal>['app'];store:Store})=>Promise<void>)=>{
 const store=new Store(':memory:');const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000});
 try{await run({app:portal.app,store});}finally{for(const c of portal.running.values())c.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();}
};

test('accounts: creation, session lookup and profile edits are validated by the server',()=>withPortal(async({app,store})=>{
 const create=(body:object)=>request(app).post('/api/accounts').send(body);
 const admin=(await create({name:'Ben',sprite:'red',admin:true})).body;
 const player=(await create({name:'Timéo',sprite:'pokemon-255',admin:false})).body;
 assert.ok(admin.createdAt);
 const dup=await create({name:' TIMEO ',sprite:'may',admin:false});
 assert.equal(dup.status,409);assert.equal(dup.body.error.code,'CONFLICT');
 assert.equal((await create({name:'x',sprite:'../evil',admin:false})).body.error.code,'VALIDATION_FAILED');

 assert.equal((await request(app).get('/api/me')).body.error.code,'ACCOUNT_REQUIRED');
 assert.equal((await request(app).get('/api/me').set('x-account-id','p-unknown')).status,401);
 assert.equal((await request(app).get('/api/me').set('x-account-id',player.id)).body.name,'Timéo');

 const patch=(actor:string,id:string,body:object)=>request(app).patch(`/api/accounts/${id}`).set('x-account-id',actor).send(body);
 // Partial edits from the profile menu.
 assert.equal((await patch(player.id,player.id,{sprite:'may'})).body.sprite,'may');
 assert.equal((await patch(player.id,player.id,{name:'Timéo B'})).body.name,'Timéo B');
 assert.equal((await patch(player.id,player.id,{})).body.error.code,'VALIDATION_FAILED');
 assert.equal((await patch(player.id,player.id,{name:'ben'})).body.error.code,'CONFLICT');
 // No self-promotion, no editing someone else.
 const promote=await patch(player.id,player.id,{admin:true});
 assert.equal(promote.status,403);assert.equal(promote.body.error.code,'ADMIN_REQUIRED');
 assert.equal((await patch(player.id,admin.id,{name:'Pirate'})).body.error.code,'FORBIDDEN');
 // Sending its unchanged role is harmless.
 assert.equal((await patch(player.id,player.id,{name:'Timéo',admin:false})).status,200);
 // Admins manage roles but the last admin stays.
 assert.equal((await patch(admin.id,admin.id,{admin:false})).body.error.code,'LAST_ADMIN');
 assert.equal((await patch(admin.id,player.id,{admin:true})).body.admin,true);
 assert.equal((await patch(admin.id,admin.id,{admin:false})).body.admin,false);
 // Ben is no longer admin: editing the new admin is refused, an unknown id is reported as such.
 assert.equal((await patch(admin.id,player.id,{name:'X'})).body.error.code,'FORBIDDEN');
 assert.equal((await patch(player.id,'p-none',{name:'X'})).body.error.code,'ACCOUNT_NOT_FOUND');
 const actions=store.portal!.audit.list({category:'ADMIN'}).map(l=>l.targetAccountId);
 assert.deepEqual(actions.sort(),[admin.id,player.id].sort());
}));

test('lobbies: admins create, players join by code, visibility and edits are enforced',()=>withPortal(async({app,store})=>{
 const admin=(await request(app).post('/api/accounts').send({name:'Admin',sprite:'red',admin:true})).body;
 const ben=(await request(app).post('/api/accounts').send({name:'Ben',sprite:'may',admin:false})).body;
 const tim=(await request(app).post('/api/accounts').send({name:'Tim',sprite:'may',admin:false})).body;
 const as=(id:string)=>({get:(p:string)=>request(app).get(p).set('x-account-id',id),post:(p:string,b:object={})=>request(app).post(p).set('x-account-id',id).send(b),patch:(p:string,b:object)=>request(app).patch(p).set('x-account-id',id).send(b)});

 assert.equal((await request(app).get('/api/lobbies')).body.error.code,'ACCOUNT_REQUIRED');
 const refused=await as(ben.id).post('/api/lobbies',{name:'Pirate'});
 assert.equal(refused.status,403);assert.equal(refused.body.error.code,'ADMIN_REQUIRED');
 assert.equal((await as(admin.id).post('/api/lobbies',{name:'  '})).body.error.code,'VALIDATION_FAILED');
 const created=await as(admin.id).post('/api/lobbies',{name:'Lobby Octobre'});
 assert.equal(created.status,201);
 const lobby=created.body;
 assert.equal(lobby.status,'OPEN');assert.equal(lobby.joined,true);assert.match(lobby.inviteCode,/^[0-9A-F]{8}$/);
 assert.deepEqual(lobby.members.map((m:{id:string})=>m.id),[admin.id]);

 // Non-members do not see the lobby, nor its code.
 assert.deepEqual((await as(ben.id).get('/api/lobbies')).body,[]);
 assert.equal((await as(ben.id).get(`/api/lobbies/${lobby.id}`)).body.error.code,'NOT_LOBBY_MEMBER');
 assert.equal((await as(ben.id).post('/api/lobbies/join',{code:'NOPE'})).body.error.code,'INVALID_INVITE_CODE');
 // Typed codes ignore case and spaces; joining twice changes nothing.
 const typed=lobby.inviteCode.toLowerCase().replace(/^(.{4})/,'$1 ');
 const joined=(await as(ben.id).post('/api/lobbies/join',{code:typed})).body;
 assert.equal(joined.id,lobby.id);assert.equal(joined.joined,true);assert.equal(joined.inviteCode,lobby.inviteCode);
 assert.equal((await as(ben.id).post('/api/lobbies/join',{code:lobby.inviteCode})).body.members.length,2);
 assert.deepEqual((await as(ben.id).get('/api/lobbies')).body.map((l:{id:string})=>l.id),[lobby.id]);
 // The new lobby already serves its course API to members only.
 assert.equal((await as(ben.id).get(`/rooms/${lobby.id}/api/players`)).status,200);
 assert.equal((await as(tim.id).get(`/rooms/${lobby.id}/api/players`)).status,401);
 // The game client can resolve the code once the account is a member.
 assert.equal((await request(app).post('/api/rooms/resolve').send({roomCode:lobby.inviteCode,playerName:'Ben'})).body.socketPath,`/rooms/${lobby.id}/socket.io`);

 assert.equal((await as(ben.id).patch(`/api/lobbies/${lobby.id}`,{name:'Pirate'})).body.error.code,'ADMIN_REQUIRED');
 const edited=(await as(admin.id).patch(`/api/lobbies/${lobby.id}`,{name:'Lobby Novembre',status:'RUNNING'})).body;
 assert.equal(edited.name,'Lobby Novembre');assert.equal(edited.status,'RUNNING');
 assert.equal((await as(admin.id).patch(`/api/lobbies/${lobby.id}`,{status:'DONE'})).body.error.code,'VALIDATION_FAILED');
 // Admins see every lobby, with its code, even without joining.
 const other=(await as(admin.id).post('/api/lobbies',{name:'Autre'})).body;
 assert.equal((await as(admin.id).get(`/api/lobbies/${other.id}`)).body.inviteCode,other.inviteCode);
 await as(admin.id).patch(`/api/lobbies/${other.id}`,{status:'ARCHIVED'});
 assert.equal((await as(tim.id).post('/api/lobbies/join',{code:other.inviteCode})).body.error.code,'CONFLICT');
 assert.deepEqual(store.portal!.audit.list({category:'LOBBY'}).map(l=>l.action).sort(),['lobby.create','lobby.create','lobby.join','lobby.join','lobby.update','lobby.update'].sort());
}));
