import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io as client} from 'socket.io-client';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';

test('shared library persists exact copies, dispatches raw restores and deletes without a key',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'pokemon-library-')),'test.sqlite');const store=new Store(path);
 const {server,io}=createApp(store,{accountsRequired:false,corsOrigin:'http://localhost',offlineAfterMs:15000,roomCode:'123',adminToken:'admin'});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
 const headers={'content-type':'application/json'};
 const socket=client(`${base}/agent`,{auth:{playerId:'player-1',playerName:'Test',roomCode:'123'},transports:['websocket']});
 try {
  await new Promise<void>((resolve,reject)=>{socket.on('connect',resolve);socket.on('connect_error',reject);});
  const b=Buffer.alloc(100);b.writeUInt16LE(25,32);b.writeUInt16LE(25,28);b[84]=5;b.writeUInt16LE(12,86);b.writeUInt16LE(20,88);const raw=b.toString('hex');
  const body={label:'Pikachu test',pokemon:{slot:1,speciesId:25,speciesName:'Pikachu',nickname:'TEST',level:5,currentHp:12,maxHp:20,shiny:true,raw}};
  assert.equal((await fetch(`${base}/api/library`)).status,200);

  assert.equal((await fetch(`${base}/api/library`,{method:'POST',headers,body:JSON.stringify({...body,pokemon:{...body.pokemon,raw:'0'.repeat(200)}})})).status,400);
  const saved=await fetch(`${base}/api/library`,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(saved.status,201);const entry=await saved.json() as {id:string};
  const reopened=new Store(path);assert.equal(reopened.library()[0].pokemon?.raw,raw);reopened.close();
  const rows=await (await fetch(`${base}/api/library`,{headers})).json() as any[];assert.equal(rows[0].id,entry.id);
  const command=new Promise<any>(resolve=>socket.once('command',(data,ack)=>{resolve(data);ack({ok:true});}));
  assert.equal((await fetch(`${base}/api/pokemon`,{method:'POST',headers,body:JSON.stringify({playerId:'player-1',slot:2,raw})})).status,200);
  assert.deepEqual((await command).data,{playerId:'player-1',slot:2,raw});
  const removal=new Promise<any>(resolve=>socket.once('command',(data,ack)=>{resolve(data);ack({ok:true});}));
  assert.equal((await fetch(`${base}/api/pokemon`,{method:'POST',headers,body:JSON.stringify({action:'remove',playerId:'player-1',slot:1,raw})})).status,200);
  assert.equal((await removal).data.action,'remove');
  assert.equal((await fetch(`${base}/api/library/${entry.id}`,{method:'DELETE',headers})).status,200);assert.equal(store.library().length,0);
 } finally {socket.close();await new Promise<void>(r=>io.close(()=>r()));store.close();}
});
