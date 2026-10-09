import test from 'node:test';
import assert from 'node:assert/strict';
import type {ShopSnapshot,WheelType,WheelsSnapshot} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {until} from './support/fake-game-client.js';

// Wheels kept out of the shop, « Lancer à tous » and the automatic wheel of a lobby.
async function setup(){
 const p=await passivePortal();
 const {as,admin,lobby}=p,path=`/api/lobbies/${lobby.id}`;
 const wheel=async(o:{name:string;tone:'GOOD'|'BAD';forSale?:boolean})=>(await as(admin.id).post(`${path}/wheels`,{name:o.name,price:0,icon:o.tone==='BAD'?'purple-1':'green-1',tone:o.tone,
  ...(o.forSale===undefined?{}:{forSale:o.forSale}),gages:[{name:'Gage',handler:'NOTICE',params:{}}]})).body as WheelType;
 const resolutions=()=>p.store.db.prepare('SELECT owner_account_id AS owner,target_account_id AS target,status,wheel_type_id AS wheel FROM wheel_resolutions ORDER BY rowid').all() as {owner:string;target:string|null;status:string;wheel:string}[];
 const run=(id:string)=>as(admin.id).post(`${path}/runs`,{accountId:id,start:true});
 return {...p,path,wheel,resolutions,run};
}

test('a wheel not for sale stays out of the shop but the admin can still spin it',async()=>{
 const t=await setup();
 try{
  const hidden=await t.wheel({name:'Cachée',tone:'GOOD',forSale:false}),sold=await t.wheel({name:'Vendue',tone:'GOOD'});
  assert.equal(hidden.forSale,false);assert.equal(sold.forSale,true);
  const shop=(await t.as(t.ben.id).get(`${t.path}/shop`)).body as ShopSnapshot;
  assert.ok(shop.wheels.some(w=>w.id===sold.id));assert.ok(!shop.wheels.some(w=>w.id===hidden.id));
  const buy=await t.as(t.ben.id).post(`${t.path}/shop/tickets`,{wheelId:hidden.id,requestId:crypto.randomUUID()});
  assert.equal(buy.body.error.code,'CONFLICT');
  assert.equal((await t.as(t.admin.id).post(`${t.path}/wheels/${hidden.id}/spin`,{ownerId:t.ben.id})).status,201);
 }finally{await t.close();}
});

test('Lancer à tous: one wheel per player in a Run, immediate gages applied, hostile wheels target the player',async()=>{
 const t=await setup();
 try{
  const good=await t.wheel({name:'Bonus',tone:'GOOD'}),bad=await t.wheel({name:'Malus',tone:'BAD'});
  assert.equal((await t.as(t.admin.id).post(`${t.path}/wheels/${good.id}/spin-all`)).body.error.code,'CONFLICT','nobody in a Run');
  assert.equal((await t.as(t.ben.id).post(`${t.path}/wheels/${good.id}/spin-all`)).status,403);
  await t.run(t.ben.id);await t.run(t.tim.id);
  assert.deepEqual((await t.as(t.admin.id).post(`${t.path}/wheels/${good.id}/spin-all`)).body,{players:2});
  await until(()=>t.resolutions().filter(r=>r.status==='SUCCESS').length===2,'both applied');
  assert.deepEqual(t.resolutions().map(r=>r.owner).sort(),[t.ben.id,t.tim.id].sort(),'the admin without a Run gets none');
  await t.as(t.admin.id).post(`${t.path}/wheels/${bad.id}/spin-all`);
  await until(()=>t.resolutions().filter(r=>r.wheel===bad.id&&r.status==='SUCCESS').length===2,'hostile applied');
  assert.ok(t.resolutions().filter(r=>r.wheel===bad.id).every(r=>r.target===r.owner));
  // Two launches in a row are queued: the second wheel starts once every player had the first one.
  t.portal.services.wheels.spinAll(t.lobby.id,good.id,t.admin);t.portal.services.wheels.spinAll(t.lobby.id,bad.id,t.admin);
  await until(()=>t.resolutions().length===8,'both launches');
  assert.deepEqual(t.resolutions().slice(4).map(r=>r.wheel),[good.id,good.id,bad.id,bad.id]);
 }finally{await t.close();}
});

test('automatic wheel: spun for everyone once per period, countdown from the save, off with 0 minutes',async()=>{
 const t=await setup();
 try{
  const good=await t.wheel({name:'Horloge',tone:'GOOD'});
  await t.run(t.ben.id);
  const set=(await t.as(t.admin.id).put(`${t.path}/wheels-auto`,{wheelId:good.id,everyMinutes:30})).body;
  assert.equal(set.everyMinutes,30);assert.ok(Date.parse(set.nextAt)-Date.now()>29*60000);
  assert.equal(((await t.as(t.ben.id).get(`${t.path}/wheels`)).body as WheelsSnapshot).auto?.wheelId,good.id);
  const wheels=t.portal.services.wheels,start=Date.now();
  wheels.tickAutoWheels(start+60000);assert.equal(t.resolutions().length,0,'not due yet');
  wheels.tickAutoWheels(start+31*60000);
  await until(()=>t.resolutions().length===1,'spun');
  wheels.tickAutoWheels(start+32*60000);await new Promise(r=>setTimeout(r,50));
  assert.equal(t.resolutions().length,1,'once per period');
  wheels.tickAutoWheels(start+62*60000);await until(()=>t.resolutions().length===2,'next period');
  await t.as(t.admin.id).put(`${t.path}/wheels-auto`,{wheelId:good.id,everyMinutes:0});
  wheels.tickAutoWheels(start+999*60000);await new Promise(r=>setTimeout(r,50));
  assert.equal(t.resolutions().length,2,'off');
 }finally{await t.close();}
});
