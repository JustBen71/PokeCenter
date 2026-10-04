import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {createPortal} from '../src/rooms.js';
import request from 'supertest';
import {migrate,migrations,schemaVersion} from '../src/db/migrations.js';

const tables=(db:Database.Database)=>(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(r=>r.name);
const latest=Math.max(...migrations.map(m=>m.version));
const withFolder=(run:(folder:string)=>void)=>{const folder=mkdtempSync(join(tmpdir(),'pokerace-migrations-'));try{run(folder);}finally{rmSync(folder,{recursive:true,force:true});}};

test('an empty portal database migrates to the latest schema and reopening is a no-op',()=>withFolder(folder=>{
 const path=join(folder,'portal.sqlite');
 let store=new Store(path);
 assert.equal(schemaVersion(store.db),latest);
 for(const t of ['accounts','lobbies','lobby_members','lobby_settings','runs','money_transactions','bank_accounts','jackpots','audit_logs','auctions','pokemon_library','player_states'])assert.ok(tables(store.db).includes(t),t);
 const names=(store.db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all() as {version:number;name:string}[]);
 assert.deepEqual(names.map(r=>r.version),migrations.map(m=>m.version));
 assert.ok(names.every(r=>r.name));
 store.close();store=new Store(path);
 assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {n:number}).n,migrations.length);
 store.close();
}));

test('a course database only receives the feature tables',()=>{
 const store=new Store(':memory:','course');
 assert.ok(tables(store.db).includes('auctions'));
 for(const t of ['accounts','lobbies','runs','money_transactions','audit_logs'])assert.ok(!tables(store.db).includes(t),t);
 assert.deepEqual(store.accounts(),[]);assert.equal(store.portal,undefined);
 store.close();
});

test('a database written by the previous store keeps accounts, rooms, members and feature data',()=>withFolder(folder=>{
 const path=join(folder,'old.sqlite');
 const old=new Database(path);
 old.exec(`
  CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  INSERT INTO schema_migrations VALUES(1,datetime('now'));
  CREATE TABLE player_states(player_id TEXT PRIMARY KEY,state_json TEXT NOT NULL,received_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);
  CREATE TABLE accounts(id TEXT PRIMARY KEY,name_key TEXT UNIQUE NOT NULL,data_json TEXT NOT NULL);
  CREATE TABLE rooms(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
  CREATE TABLE auctions(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
 `);
 const putAccount=old.prepare('INSERT INTO accounts VALUES(?,?,?)');
 putAccount.run('p-admin','timeo',JSON.stringify({id:'p-admin',name:'Timéo',sprite:'red',admin:true}));
 putAccount.run('p-ben','ben',JSON.stringify({id:'p-ben',name:'Ben',sprite:'pokemon-25',admin:false}));
 const putRoom=old.prepare('INSERT INTO rooms VALUES(?,?)');
 putRoom.run('legacy',JSON.stringify({id:'legacy',name:'Salon historique',code:'OLD',ownerId:'',memberIds:['p-admin','p-ben'],createdAt:'2026-09-01T10:00:00.000Z'}));
 putRoom.run('room-2',JSON.stringify({id:'room-2',name:'Octobre',code:'ABCD1234',ownerId:'p-admin',memberIds:['p-admin','p-ghost'],createdAt:'2026-09-02T10:00:00.000Z'}));
 old.prepare('INSERT INTO auctions VALUES(?,?)').run('auction-1',JSON.stringify({id:'auction-1',status:'open'}));
 old.close();

 const store=new Store(path);const {accounts,lobbies}=store.portal!;
 assert.equal(schemaVersion(store.db),latest);
 assert.deepEqual(accounts.list().map(a=>[a.id,a.name,a.sprite,a.admin]),[['p-admin','Timéo','red',true],['p-ben','Ben','pokemon-25',false]]);
 assert.equal(accounts.findByName('timeo')?.id,'p-admin');
 assert.deepEqual(lobbies.list().map(l=>[l.id,l.name,l.inviteCode,l.createdBy,l.status]),[['legacy','Salon historique','OLD',null,'OPEN'],['room-2','Octobre','ABCD1234','p-admin','OPEN']]);
 assert.deepEqual(lobbies.members('legacy').map(m=>m.accountId),['p-admin','p-ben']);
 // Unknown member ids cannot satisfy the foreign key and are dropped instead of blocking the migration.
 assert.deepEqual(lobbies.members('room-2').map(m=>m.accountId),['p-admin']);
 assert.equal(lobbies.settings('room-2').bankDepositTaxPercent,10);
 assert.equal(store.auctions()[0].id,'auction-1');
 assert.ok(!tables(store.db).includes('rooms'));assert.ok(!tables(store.db).includes('accounts_v1'));
 store.close();
}));

test('a failing migration is rolled back and not recorded',()=>{
 const db=new Database(':memory:');
 // A pre-existing "lobbies" table makes migration 4 fail after its first statements.
 db.exec("CREATE TABLE lobbies(id TEXT)");
 assert.throws(()=>migrate(db,'portal'),/already exists/);
 assert.equal(schemaVersion(db),3);
 assert.ok(!tables(db).includes('lobby_members'));
 db.exec('DROP TABLE lobbies');migrate(db,'portal');
 assert.equal(schemaVersion(db),latest);
 db.close();
});

test('the portal starts on a migrated database and keeps the legacy lobby reachable',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'pokerace-migrations-')),path=join(folder,'old.sqlite');
 const old=new Database(path);
 old.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,name_key TEXT UNIQUE NOT NULL,data_json TEXT NOT NULL);CREATE TABLE rooms(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);`);
 old.prepare('INSERT INTO accounts VALUES(?,?,?)').run('p-ben','ben',JSON.stringify({id:'p-ben',name:'Ben',sprite:'may',admin:false}));
 old.prepare('INSERT INTO rooms VALUES(?,?)').run('legacy',JSON.stringify({id:'legacy',name:'Salon historique',code:'OLD',ownerId:'',memberIds:['p-ben'],createdAt:'2026-09-01T10:00:00.000Z'}));
 old.close();
 const store=new Store(path);const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,roomCode:'OLD'});
 try{
  const rooms=(await request(portal.app).get('/api/rooms').set('x-account-id','p-ben')).body;
  assert.deepEqual(rooms.map((r:{id:string;code:string;joined:boolean})=>[r.id,r.code,r.joined]),[['legacy','OLD',true]]);
  assert.equal((await request(portal.app).post('/api/rooms/resolve').send({roomCode:'OLD',playerName:'ben'})).body.socketPath,'/socket.io');
  assert.equal((await request(portal.app).get('/api/players').set('x-account-id','p-ben')).status,200);
  assert.equal(store.portal!.lobbies.list().length,1);
 }finally{for(const course of portal.running.values())course.io.disconnectSockets(true);await new Promise<void>(r=>portal.server.close(()=>r()));store.close();rmSync(folder,{recursive:true,force:true});}
});
