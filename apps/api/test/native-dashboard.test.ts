import test from 'node:test';
import assert from 'node:assert/strict';
import {io as connect,type Socket} from 'socket.io-client';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
import {nativeState} from '../../../packages/shared/test/native-fixture.js';
const hello={type:'HELLO',protocolVersion:1,playerId:'installation-test',clientVersion:'0.1.0',platform:'windows-x64',emulator:{name:'BizHawk'},bridge:{type:'bizhawk',connected:true,gameLoaded:true,protocolVersion:1},system:'GBA'};
const observation=()=>{const state=nativeState();return {type:'GAME_STATE',protocolVersion:1,gameStateVersion:1,adapter:state.adapter,state};};
function event(socket:Socket,name:string,predicate:(value:any)=>boolean=()=>true):Promise<any>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,listener);reject(Error('Timed out: '+name));},3000);const listener=(value:any)=>{if(predicate(value)){clearTimeout(timer);socket.off(name,listener);resolve(value);}};socket.on(name,listener);});}
async function fixture(t:test.TestContext){
 const store=new Store(':memory:');store.accounts();store.putAccount({id:'account-test',name:'Tester',sprite:'may',admin:false},'tester');
 const {server,io,nativeClients}=createApp(store,{corsOrigin:'http://localhost',offlineAfterMs:15000,roomCode:'room-secret',adminToken:'admin-secret'});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
 const options={transports:['websocket'],reconnection:false,autoConnect:false,forceNew:true};
 const dashboard=connect(base+'/dashboard',{...options,auth:{accountId:'account-test'}});
 const client=connect(base+'/client',{...options,auth:{protocolVersion:1,playerId:'installation-test',playerName:'Tester',roomCode:'room-secret',sessionToken:'do-not-project'}});
 t.after(async()=>{client.disconnect();dashboard.disconnect();await new Promise<void>(r=>io.close(()=>r()));store.close();});
 const initial=event(dashboard,'native-clients');dashboard.connect();assert.deepEqual(await initial,[]);
 const joined=event(dashboard,'native-clients',rows=>rows.length===1&&!rows[0].ready);const connected=event(client,'SERVER_STATUS');client.connect();await connected;await joined;
 const ready=event(dashboard,'native-clients',rows=>rows[0]?.ready);client.emit('HELLO',hello);await ready;
 return {base,client,dashboard,nativeClients};
}
test('public REST/dashboard use account identity, allowlisted fields, initial snapshot and live transitions',async t=>{
 const {base,client,dashboard,nativeClients}=await fixture(t);
 let update=event(dashboard,'native-clients',rows=>rows[0]?.allowMemoryWrites===true);client.emit('CLIENT_STATUS',{type:'CLIENT_STATUS',protocolVersion:1,connected:true,allowMemoryWrites:true});await update;
 update=event(dashboard,'native-clients',rows=>rows[0]?.gameState?.trainer.money===12500);client.emit('GAME_STATE',observation());await update;
 const rows:any=await (await fetch(base+'/api/native-clients',{headers:{'x-account-id':'account-test'}})).json();assert.equal(rows[0].accountId,'account-test');assert.equal(rows[0].playerId,'installation-test');assert.deepEqual(rows[0].adapter.capabilities,nativeState().capabilities);
 const serialized=JSON.stringify(rows);for(const forbidden of ['roomCode','room-secret','sessionToken','do-not-project','socketId','adminToken','admin-secret','POKERACE_BRIDGE_TOKEN','romSha256','romPath','savePath','address','raw'])assert.equal(serialized.includes(forbidden),false,forbidden);
 const second=connect(base+'/dashboard',{transports:['websocket'],auth:{accountId:'account-test'},autoConnect:false});t.after(()=>second.close());const initial=event(second,'native-clients');second.connect();assert.deepEqual(await initial,rows);
 update=event(dashboard,'native-clients',r=>r[0]?.system==='NES');client.emit('BRIDGE_STATUS',{type:'BRIDGE_STATUS',protocolVersion:1,bridge:hello.bridge,system:'NES'});assert.equal((await update)[0].gameState,null);
 update=event(dashboard,'native-clients',r=>r[0]?.adapter.status==='unsupported_system');client.emit('GAME_STATE',{type:'GAME_STATE',protocolVersion:1,gameStateVersion:1,adapter:{id:null,status:'unsupported_system',profileId:null,capabilities:[]},state:null});await update;
 update=event(dashboard,'native-clients',r=>r.length===0);client.disconnect();await update;assert.deepEqual(nativeClients.publicSnapshot(),[]);assert.deepEqual(await (await fetch(base+'/api/native-clients',{headers:{'x-account-id':'account-test'}})).json(),[]);
});
test('identical snapshots and heartbeats do not flood dashboard',async t=>{
 const {client,dashboard}=await fixture(t);const first=event(dashboard,'native-clients',r=>r[0]?.gameState);client.emit('GAME_STATE',observation());await first;
 let updates=0;dashboard.on('native-clients',()=>updates++);
 const duplicate=observation();duplicate.state.observedAt='2026-10-03T12:00:01.000Z';client.emit('GAME_STATE',duplicate);client.emit('HEARTBEAT',{type:'HEARTBEAT',protocolVersion:1,clientVersion:'0.1.0',bridgeConnected:true,system:'GBA'});
 // A following useful event acts as an ordered socket barrier.
 const changed=event(dashboard,'native-clients',r=>r[0]?.gameState?.trainer.money===100);const next=observation();next.state.trainer.money=100;client.emit('GAME_STATE',next);await changed;assert.equal(updates,1);
});
for(const variant of ['invalid','oversized','raw','write-capability'] as const)test(`rejects ${variant} GAME_STATE and removes public client`,async t=>{
 const {client,dashboard,nativeClients}=await fixture(t);const value:any=observation();
 if(variant==='invalid')value.state.trainer.money=-1;
 if(variant==='oversized')value.state.trainer.name='x'.repeat(40000);
 if(variant==='raw')value.state.party[0].raw='00'.repeat(100);
 if(variant==='write-capability')value.adapter.capabilities=['party.write'];
 const gone=event(dashboard,'native-clients',r=>r.length===0);client.emit('GAME_STATE',value);await gone;assert.deepEqual(nativeClients.publicSnapshot(),[]);
});
