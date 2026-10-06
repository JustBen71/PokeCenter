import test from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {passiveById,type LobbyNotification,type PassivesSnapshot,type WheelResolution,type WheelType} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {until} from './support/fake-game-client.js';
import {implementedPassives} from '../src/passives/passive-handlers.js';

const wheelBody=(name:string,handler:string,params:object,tone='GOOD')=>({name,price:0,icon:tone==='BAD'?'purple-3':'green-3',tone,gages:[{name,handler,params}]});

test('wheel gages: random passive by rarities, legendary rarity, no fake success',async()=>{
 // « Usurpateur » stands in for an implemented legendary (none is implemented in this sprint).
 const p=await passivePortal({implemented:new Set([...implementedPassives,'usurper'])});
 try{
  const {as,admin,ben,lobby,portal}=p;
  const make=async(name:string,handler:string,params:object)=>(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,wheelBody(name,handler,params))).body as WheelType;
  const spinApply=async(w:WheelType)=>{
   const r=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels/${w.id}/spin`,{ownerId:ben.id})).body as WheelResolution;
   return (await as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${r.id}/apply`)).body as WheelResolution&{error?:{code:string}};
  };
  assert.equal((await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,wheelBody('X','PASSIVE_GRANT_RARITY',{rarity:'MYTHIC'}))).body.error.code,'VALIDATION_FAILED');
  assert.equal((await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,wheelBody('X','PASSIVE_GRANT_RANDOM',{rarities:[]}))).body.error.code,'VALIDATION_FAILED');

  const owned=()=>portal.services.passives.owned(lobby.id,ben.id).map(o=>o.passiveId);
  const uncommon=await make('Peu commun','PASSIVE_GRANT_RANDOM',{rarities:['UNCOMMON']});
  const offerable=portal.services.passives.offerable(lobby.id).filter(d=>d.rarity==='UNCOMMON').map(d=>d.id);
  for(let i=0;i<offerable.length;i++){const r=await spinApply(uncommon);assert.equal(r.status,'SUCCESS',JSON.stringify(r));}
  assert.deepEqual([...owned()].sort(),[...offerable].sort(),'one new compatible passive each time, never a duplicate');
  assert.ok(owned().every(id=>passiveById.get(id)!.rarity==='UNCOMMON'));
  assert.ok(portal.services.passives.owned(lobby.id,ben.id).every(o=>o.source==='WHEEL'));
  const none=await spinApply(uncommon);
  assert.equal(none.error?.code,'NO_PASSIVE_AVAILABLE','nothing left: no fake success');
  assert.equal(owned().length,offerable.length,'previous passives kept');

  const divine=await make('Roue divine','PASSIVE_GRANT_RARITY',{rarity:'LEGENDARY'});
  assert.equal((await spinApply(divine)).status,'SUCCESS');
  assert.ok(owned().includes('usurper'));
  assert.equal((await spinApply(divine)).error?.code,'NO_PASSIVE_AVAILABLE');
 }finally{await p.close();}
 // With the real catalogue, no legendary is available yet: the gage refuses instead of pretending.
 const real=await passivePortal({implemented:implementedPassives});
 try{
  const {as,admin,ben,lobby}=real;
  const w=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,wheelBody('Divine','PASSIVE_GRANT_RARITY',{rarity:'LEGENDARY'}))).body as WheelType;
  const r=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels/${w.id}/spin`,{ownerId:ben.id})).body as WheelResolution;
  assert.equal((await as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${r.id}/apply`)).body.error.code,'NO_PASSIVE_AVAILABLE');
 }finally{await real.close();}
});

test('wheel gage PASSIVE_STEAL: target and passive chosen after the draw, atomic transfer with progression, live badges',async()=>{
 const p=await passivePortal({implemented:implementedPassives});
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,tim,lobby,base,portal}=p;const {passives}=portal.services;
  passives.grant(lobby.id,tim.id,'cartographer','ADMIN');passives.setProgress(lobby.id,tim.id,'cartographer','places',['A','B','C']);
  passives.grant(lobby.id,tim.id,'rivalry','ADMIN');passives.grant(lobby.id,ben.id,'rivalry','ADMIN');
  const watch=(accountId:string)=>{const s=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId},transports:['websocket'],reconnection:false});closers.push(()=>s.close());
   const seen={notes:[] as string[],snapshots:[] as PassivesSnapshot[]};s.on('notification',(n:LobbyNotification)=>seen.notes.push(n.message));s.on('passives',(x:PassivesSnapshot)=>seen.snapshots.push(x));return {s,seen};};
  const benView=watch(ben.id),timView=watch(tim.id);
  await until(()=>benView.s.connected&&timView.s.connected,'dashboards');
  const wheel=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,wheelBody('Voleur','PASSIVE_STEAL',{},'BAD'))).body as WheelType;
  const r=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels/${wheel.id}/spin`,{ownerId:ben.id})).body as WheelResolution;
  assert.equal(r.status,'AWAITING_CHOICE');
  const apply=(body:object)=>as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${r.id}/apply`,body);
  assert.equal((await apply({targetId:tim.id})).body.error.code,'VALIDATION_FAILED','passive required');
  assert.equal((await apply({targetId:ben.id,passiveId:'rivalry'})).body.error.code,'VALIDATION_FAILED','not oneself');
  // Ben already owns Rivalité: refused, nothing moves.
  assert.equal((await apply({targetId:tim.id,passiveId:'rivalry'})).body.error.code,'PASSIVE_ALREADY_OWNED');
  assert.deepEqual(passives.owned(lobby.id,tim.id).map(o=>o.passiveId),['cartographer','rivalry']);
  const done=(await apply({targetId:tim.id,passiveId:'cartographer'})).body as WheelResolution;
  assert.equal(done.status,'SUCCESS');assert.match(done.result!,/Ben vole « Cartographe » à Tim/);
  assert.deepEqual(passives.owned(lobby.id,tim.id).map(o=>o.passiveId),['rivalry']);
  const stolen=passives.owned(lobby.id,ben.id).find(o=>o.passiveId==='cartographer')!;
  assert.deepEqual(stolen.progress.places,['A','B','C'],'progression follows');assert.equal(stolen.source,'WHEEL');
  await until(()=>timView.seen.notes.some(n=>n.includes('Ben t’a volé « Cartographe »'))&&benView.seen.notes.some(n=>n.includes('tu récupères « Cartographe » de Tim')),'notifications');
  assert.ok(!benView.seen.notes.some(n=>n.includes('t’a volé')),'the thief does not get the victim message');
  await until(()=>timView.seen.snapshots.some(s=>s.owned.some(o=>o.accountId===ben.id&&o.passiveId==='cartographer')),'live badges');
  const logs=(await as(admin.id).get(`/api/lobbies/${lobby.id}/audit?category=PASSIVE`)).body as {action:string}[];
  assert.ok(logs.some(l=>l.action==='passive.steal'));
 }finally{for(const c of closers)c();await p.close();}
});
