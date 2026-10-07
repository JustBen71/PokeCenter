import request from 'supertest';
import {passiveCatalog,type PassivesSnapshot} from '@pokerace/shared';
import {Store} from '../../src/store.js';
import {createPortal} from '../../src/rooms.js';

// Portal with three members (admin, Ben, Tim) in one lobby, and passives enabled for tests.
export async function passivePortal(options:{implemented?:ReadonlySet<string>;random?:(n:number)=>number;commandTimeoutMs?:number;resetDelayMs?:number;handlers?:Record<string,import('../../src/passives/passive-events.js').PassiveHandler>}={}){
 const store=new Store(':memory:');
 const portal=createPortal(store,{adminToken:'',corsOrigin:'http://localhost',offlineAfterMs:15000,commandTimeoutMs:options.commandTimeoutMs??300,resetDelayMs:options.resetDelayMs??0,battleMoves:async()=>[33,45],
  passives:{implemented:options.implemented??new Set(passiveCatalog.map(p=>p.id)),random:options.random,handlers:options.handlers}});
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
