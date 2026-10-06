import test from 'node:test';
import assert from 'node:assert/strict';
import {passiveById,type WheelResolution,type WheelType} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,rawPokemon,until} from './support/fake-game-client.js';
import {implementedPassives} from '../src/passives/passive-handlers.js';

const settle=()=>new Promise(r=>setTimeout(r,60));
async function setup(){
 const p=await passivePortal({implemented:implementedPassives});
 const {as,lobby,portal}=p;
 const act=(who:string,passiveId:string,body:object)=>as(who).post(`/api/lobbies/${lobby.id}/passives/${passiveId}/act`,body);
 const owned=(who:string)=>portal.services.passives.owned(lobby.id,who).map(o=>o.passiveId);
 const progress=(who:string,id:string)=>portal.services.passives.owned(lobby.id,who).find(o=>o.passiveId===id)!.progress;
 const grant=(who:string,...ids:string[])=>{for(const id of ids)portal.services.passives.grant(lobby.id,who,id,'ADMIN');};
 const tickets=(recipient:string,tone:string)=>(p.store.db.prepare("SELECT COUNT(*) AS n FROM wheel_tickets t JOIN wheel_types w ON w.id=t.wheel_type_id WHERE t.recipient_account_id=? AND w.tone=? AND t.status='QUEUED'").get(recipient,tone) as {n:number}).n;
 const order=['starter','rival103','woods','badge1','goods','badge2','letter','museum','rival110','wally'];
 const reach=(who:string,n:number)=>portal.services.objectives.observe(lobby.id,who,order.slice(0,n));
 const wheel=async(name:string,tone:string,gages:string[])=>(await as(p.admin.id).post(`/api/lobbies/${lobby.id}/wheels`,{name,price:0,icon:tone==='BAD'?'purple-4':'green-4',tone,
  gages:gages.map(g=>({name:g,handler:'NOTICE',params:{}}))})).body as WheelType;
 const spin=async(w:WheelType,ownerId:string,targetId?:string)=>(await as(p.admin.id).post(`/api/lobbies/${lobby.id}/wheels/${w.id}/spin`,{ownerId,...(targetId?{targetId}:{})})).body as WheelResolution;
 return {...p,act,owned,progress,grant,tickets,reach,wheel,spin};
}

test('Usurpateur: once, copies a non-legendary passive of an opponent who keeps it',async()=>{
 const p=await setup();
 try{
  const {ben,tim,admin,act,owned,grant}=p;
  grant(ben.id,'usurper');grant(tim.id,'rivalry','paradox');
  assert.equal((await act(tim.id,'usurper',{action:'copy',accountId:ben.id,targetId:tim.id,passiveId:'rivalry'})).body.error.code,'FORBIDDEN');
  assert.equal((await act(ben.id,'usurper',{action:'copy',targetId:tim.id,passiveId:'paradox'})).body.error.code,'VALIDATION_FAILED','no legendary');
  assert.equal((await act(ben.id,'usurper',{action:'copy',targetId:tim.id,passiveId:'scout'})).body.error.code,'PASSIVE_NOT_OWNED');
  assert.equal((await act(ben.id,'usurper',{action:'copy',targetId:ben.id,passiveId:'usurper'})).body.error.code,'VALIDATION_FAILED','not oneself');
  const done=await act(ben.id,'usurper',{action:'copy',targetId:tim.id,passiveId:'rivalry'});
  assert.equal(done.status,200);assert.match(done.body.message,/Ben copie « Rivalité » de Tim/);
  assert.deepEqual(owned(ben.id),['usurper','rivalry']);assert.deepEqual(owned(tim.id),['rivalry','paradox'],'the opponent keeps it');
  assert.equal(p.portal.services.passives.owned(p.lobby.id,ben.id)[1].source,'EVENT');
  assert.equal((await act(ben.id,'usurper',{action:'copy',targetId:tim.id,passiveId:'rivalry'})).body.error.code,'CONFLICT','once per race');
  // Used up: no longer stealable.
  assert.ok(!p.portal.services.passives.stealable(p.lobby.id,ben.id,tim.id).some(o=>o.passiveId==='usurper'));
  const logs=(await p.as(admin.id).get(`/api/lobbies/${p.lobby.id}/audit?category=PASSIVE`)).body as {action:string}[];
  assert.ok(logs.some(l=>l.action==='passive.act.copy'));
 }finally{await p.close();}
});

test('Lien du destin: every 3 new objectives of one of the pair, the other gets a kind wheel ticket',async()=>{
 const p=await setup();
 try{
  const {ben,tim,act,grant,tickets,reach}=p;
  grant(ben.id,'fate-link');
  await reach(ben.id,1);await reach(tim.id,1);// catch-up, not counted
  assert.equal((await act(ben.id,'fate-link',{action:'link',targetId:tim.id})).status,200);
  assert.equal((await act(ben.id,'fate-link',{action:'link',targetId:tim.id})).body.error.code,'CONFLICT','one link');
  await reach(ben.id,2);await reach(ben.id,3);await settle();
  assert.equal(tickets(tim.id,'GOOD'),0);
  await reach(ben.id,4);await until(()=>tickets(tim.id,'GOOD')===1,'ticket for Tim');
  for(const n of [2,3,4])await reach(tim.id,n);
  await until(()=>tickets(ben.id,'GOOD')===1,'ticket for Ben');
  assert.deepEqual({mine:p.progress(ben.id,'fate-link').mine,theirs:p.progress(ben.id,'fate-link').theirs},{mine:3,theirs:3});
 }finally{await p.close();}
});

test('Couronne du champion: charges only while #1, three charges = one passive among three Common/Uncommon',async()=>{
 const p=await setup();
 try{
  const {ben,tim,act,grant,reach,owned,progress}=p;
  grant(ben.id,'champion-crown');
  await reach(tim.id,4);await reach(ben.id,1);
  await reach(ben.id,2);await settle();
  assert.equal(progress(ben.id,'champion-crown').charges,undefined,'not #1: no charge');
  for(const n of [5,6,7])await reach(ben.id,n);
  await until(()=>Array.isArray(progress(ben.id,'champion-crown').offer),'offer');
  const offer=progress(ben.id,'champion-crown').offer as string[];
  assert.equal(offer.length,3);assert.ok(offer.every(id=>['COMMON','UNCOMMON'].includes(passiveById.get(id)!.rarity)));
  assert.equal(progress(ben.id,'champion-crown').charges,0);
  assert.equal((await act(ben.id,'champion-crown',{action:'choose',passiveId:'paradox'})).body.error.code,'VALIDATION_FAILED');
  assert.equal((await act(ben.id,'champion-crown',{action:'choose',passiveId:offer[1]})).status,200);
  assert.ok(owned(ben.id).includes(offer[1]));assert.equal(progress(ben.id,'champion-crown').offer,null);
  assert.equal((await act(ben.id,'champion-crown',{action:'choose',passiveId:offer[0]})).body.error.code,'CONFLICT');
 }finally{await p.close();}
});

test('Sixième sens and Maître du chaos: the player chooses the gage before anything applies',async()=>{
 const p=await setup();
 try{
  const {ben,tim,admin,as,lobby,grant,wheel,spin}=p;
  grant(ben.id,'sixth-sense');grant(tim.id,'chaos-master');
  const resolutions=`/api/lobbies/${lobby.id}/wheel-resolutions`;
  const kind=await wheel('Trois cadeaux','GOOD',['A','B','C']);
  const r=await spin(kind,ben.id);
  assert.equal(r.status,'AWAITING_CHOICE');assert.equal(r.chooserId,ben.id);
  assert.equal(r.options!.length,2);assert.notEqual(r.options![0].id,r.options![1].id);
  assert.equal((await as(admin.id).post(`${resolutions}/${r.id}/apply`)).body.error.code,'CONFLICT','choice first');
  assert.equal((await as(tim.id).post(`${resolutions}/${r.id}/choose`,{gageId:r.options![0].id})).body.error.code,'FORBIDDEN');
  const chosen=(await as(ben.id).post(`${resolutions}/${r.id}/choose`,{gageId:r.options![1].id})).body as WheelResolution;
  assert.equal(chosen.status,'DRAWN');assert.equal(chosen.gage.name,r.options![1].name);assert.equal(chosen.options,null);
  assert.equal((await as(ben.id).post(`${resolutions}/${r.id}/choose`,{gageId:r.options![0].id})).body.error.code,'CONFLICT');
  assert.equal((await as(admin.id).post(`${resolutions}/${r.id}/apply`)).body.status,'SUCCESS');
  // Not for the holder as a target of a hostile wheel.
  const hostile=await wheel('Trois malus','BAD',['X','Y','Z','W']);
  assert.equal((await spin(hostile,tim.id,ben.id)).options,null);
  // Maître du chaos: once, three different gages for the target.
  const chaos=await spin(hostile,ben.id,tim.id);
  assert.equal(chaos.chooserId,tim.id);assert.equal(new Set(chaos.options!.map(g=>g.id)).size,3);
  assert.equal((await as(tim.id).post(`${resolutions}/${chaos.id}/choose`,{gageId:chaos.options![2].id})).body.gage.name,chaos.options![2].name);
  assert.equal((await spin(hostile,ben.id,tim.id)).options,null,'used once');
 }finally{await p.close();}
});

test('Paradoxe: undoes the latest reversible negative action once (wheel money, hostile ticket)',async()=>{
 const p=await setup();
 const closers:(()=>void)[]=[];
 try{
  const {ben,tim,admin,as,lobby,base,act,grant,tickets,portal}=p;
  grant(tim.id,'paradox');grant(ben.id,'paradox');
  assert.equal((await act(tim.id,'paradox',{action:'undo'})).body.error.code,'CONFLICT','nothing to undo');
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',money:3000});closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'game');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:tim.id,start:true});
  const fine=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,{name:'Amende',price:0,icon:'purple-1',tone:'BAD',gages:[{name:'Amende',handler:'TAKE_MONEY',params:{amount:700}}]})).body as WheelType;
  const r=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels/${fine.id}/spin`,{ownerId:ben.id,targetId:tim.id})).body as WheelResolution;
  await as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${r.id}/apply`);
  assert.equal(game.money,2300);
  const undo=await act(tim.id,'paradox',{action:'undo'});
  assert.equal(undo.status,200);assert.match(undo.body.message,/700 ₽ perdus sur une roue sont rendus/);
  await until(()=>game.money===3000,'refund in game');
  assert.equal((await act(tim.id,'paradox',{action:'undo'})).body.error.code,'CONFLICT','once per race');
  // Ben: a hostile ticket waiting in his queue is cancelled.
  portal.services.shop.grantTicket(lobby.id,{tone:'BAD',ownerId:tim.id,targetId:ben.id,reason:'test'});
  assert.equal(tickets(ben.id,'BAD'),1);
  assert.match((await act(ben.id,'paradox',{action:'undo'})).body.message,/ticket hostile .* est annulé/);
  assert.equal(tickets(ben.id,'BAD'),0);
 }finally{for(const c of closers)c();await p.close();}
});

test('Âme liée: exact copy kept server-side, reinjected by an admin after a lost Run, out of battle',async()=>{
 const p=await setup();
 const closers:(()=>void)[]=[];
 try{
  const {ben,admin,as,lobby,base,act,grant,progress,portal}=p;
  grant(ben.id,'bound-soul');
  const pet=rawPokemon(25,12,'PIKA');
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:1000,party:[rawPokemon(1,5),pet]});closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'game');
  const runs=`/api/lobbies/${lobby.id}/runs`;
  const run=(await as(admin.id).post(runs,{accountId:ben.id,start:true})).body;
  assert.equal((await act(ben.id,'bound-soul',{action:'bind',slot:2})).status,200);
  const shown=progress(ben.id,'bound-soul');
  assert.equal((shown.bound as {name:string}).name,'PIKA');assert.equal(JSON.stringify(shown).includes(pet),false,'the copy is never published');
  assert.equal((await act(admin.id,'bound-soul',{action:'reinject',accountId:ben.id,confirmOutOfBattle:true})).body.error.code,'CONFLICT','no lost Run yet');
  await as(admin.id).post(`${runs}/${run.id}/status`,{status:'LOST'});
  await until(()=>progress(ben.id,'bound-soul').ready===true,'ready');
  game.party=[rawPokemon(4,5)];game.publish();
  await as(admin.id).post(runs,{accountId:ben.id,start:true});
  assert.equal((await act(ben.id,'bound-soul',{action:'reinject'})).body.error.code,'ADMIN_REQUIRED');
  assert.equal((await act(admin.id,'bound-soul',{action:'reinject',accountId:ben.id})).body.error.code,'SAFE_STATE_REQUIRED');
  assert.equal((await act(admin.id,'bound-soul',{action:'reinject',accountId:ben.id,confirmOutOfBattle:true})).status,200);
  assert.equal(game.party.length,2);assert.equal(game.party[1],pet,'the exact same Pokémon');
  assert.equal(progress(ben.id,'bound-soul').ready,false);
 }finally{for(const c of closers)c();await p.close();}
});
