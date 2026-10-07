import test from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {passiveCatalog,type LobbyNotification,type NativeGameState,type WheelResolution,type WheelType} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,rawPokemon,until} from './support/fake-game-client.js';
import {areaOf,implementedPassives} from '../src/passives/passive-handlers.js';

// Minimal observation: only the validated fields the handlers read.
const state=(o:{label?:string;species?:number[];completed?:string[]}={})=>({location:{mapGroup:0,mapNumber:0,label:o.label??'Bourg-en-Vol'},
 party:(o.species??[1]).map((speciesId,i)=>({slot:i+1,speciesId})),progression:{version:1,completed:o.completed??[]}}) as unknown as NativeGameState;

test('implemented passives: the whole catalogue',()=>{
 assert.deepEqual([...implementedPassives].sort(),passiveCatalog.map(p=>p.id).sort());
 assert.equal(areaOf('Myokara — Centre Pokémon — 1F'),'Myokara');assert.equal(areaOf('Route 101'),'Route 101');assert.equal(areaOf('Zone inconnue (9:9)'),null);
});

test('Contre-sort: one hostile wheel of difference before the same gage again, fallback audited',async()=>{
 const p=await passivePortal({implemented:implementedPassives});
 try{
  const {as,admin,ben,tim,lobby}=p;
  p.portal.services.passives.grant(lobby.id,tim.id,'counterspell','ADMIN');
  const wheel=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,{name:'Duo',price:0,icon:'purple-1',tone:'BAD',gages:[{name:'A',handler:'NOTICE',params:{}},{name:'B',handler:'NOTICE',params:{}}]})).body as WheelType;
  const spin=async(w:WheelType)=>((await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels/${w.id}/spin`,{ownerId:ben.id,targetId:tim.id})).body as WheelResolution).gage.name;
  const first=await spin(wheel),second=await spin(wheel),third=await spin(wheel);
  assert.notEqual(second,first,'BAD #2 cannot repeat BAD #1');
  assert.notEqual(third,second,'BAD #3 cannot repeat BAD #2');
  assert.equal(third,first,'the first gage is possible again');
  // Without the passive, nothing is filtered: Ben can suffer the same gage twice on a one-gage wheel.
  const solo=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,{name:'Solo',price:0,icon:'purple-2',tone:'BAD',gages:[{name:'Seul',handler:'NOTICE',params:{}}]})).body as WheelType;
  assert.equal(await spin(solo),'Seul');assert.equal(await spin(solo),'Seul','fallback: the only gage stays drawable');
  const logs=(await as(admin.id).get(`/api/lobbies/${lobby.id}/audit?category=PASSIVE`)).body as {action:string}[];
  assert.ok(logs.some(l=>l.action==='counterspell_fallback'));
 }finally{await p.close();}
});

test('Rivalité: the first player overtaken receives one hostile wheel; catch-up and replays trigger nothing',async()=>{
 const p=await passivePortal({implemented:implementedPassives});
 try{
  const {as,admin,ben,tim,lobby,store,portal}=p;
  const {objectives,passives}=portal.services;
  const zoe=(await as(admin.id).post('/api/accounts',{name:'Zoé',sprite:'may',admin:false})).body;
  await as(zoe.id).post('/api/lobbies/join',{code:lobby.inviteCode});
  passives.grant(lobby.id,ben.id,'rivalry','ADMIN');
  const order=['starter','rival103','woods','badge1','goods','badge2'];
  const reach=(id:string,n:number)=>objectives.observe(lobby.id,id,order.slice(0,n));
  const tickets=()=>store.db.prepare("SELECT target_account_id AS target,buyer_account_id AS owner,t.price AS price FROM wheel_tickets t JOIN wheel_types w ON w.id=t.wheel_type_id WHERE w.tone='BAD' ORDER BY t.rowid").all() as {target:string;owner:string;price:number}[];
  // Ranking: admin 5 objectives (#1), Zoé 4 (#2), Tim 3 (#3), Ben 1 (#4). Catch-up observations trigger nothing.
  await reach(admin.id,5);await reach(zoe.id,4);await reach(tim.id,3);await reach(ben.id,1);
  await new Promise(r=>setTimeout(r,50));
  assert.equal(tickets().length,0,'first calculation');
  // Ben #4 → #3 tied with Tim: nobody is behind him yet. Then ahead of Tim (#3 → #2 tied with Zoé): Tim is overtaken.
  await reach(ben.id,3);await new Promise(r=>setTimeout(r,50));
  assert.equal(tickets().length,0,'tie is not an overtake');
  await reach(ben.id,4);
  await until(()=>tickets().length===1,'one wheel');
  assert.deepEqual(tickets()[0],{target:tim.id,owner:ben.id,price:0});
  // Ben #3 → #1 at once (4 → 6 objectives in one observation): one wheel only, for Zoé (the first overtaken).
  await reach(ben.id,6);
  await until(()=>tickets().length>=2,'second wheel');await new Promise(r=>setTimeout(r,50));
  assert.equal(tickets().length,2);assert.equal(tickets()[1].target,zoe.id);
  // Identical refresh / reconnection: nothing new.
  await reach(ben.id,6);await reach(ben.id,6);await new Promise(r=>setTimeout(r,50));
  assert.equal(tickets().length,2);
 }finally{await p.close();}
});

test('Le sixième homme, Cartographe, Collectionneur: rewards once, baseline not rewarded',async()=>{
 const p=await passivePortal({implemented:implementedPassives});
 try{
  const {ben,lobby,store,portal}=p;const {passives,passiveEngine}=portal.services;
  for(const id of ['sixth-man','cartographer','collector'])passives.grant(lobby.id,ben.id,id,'ADMIN');
  const good=()=>(store.db.prepare("SELECT COUNT(*) AS n FROM wheel_tickets t JOIN wheel_types w ON w.id=t.wheel_type_id WHERE w.tone='GOOD' AND t.recipient_account_id=?").get(ben.id) as {n:number}).n;
  const six=[1,4,7,10,13,16];
  await passiveEngine.observe(lobby.id,ben.id,state({species:six,completed:['badge1']}));
  assert.equal(good(),0,'badge1 already owned: baseline');
  await passiveEngine.observe(lobby.id,ben.id,state({species:six.slice(0,5),completed:['badge1','badge2']}));
  assert.equal(good(),0,'badge with 5 Pokémon: nothing');
  await passiveEngine.observe(lobby.id,ben.id,state({species:six,completed:['badge1','badge2','badge3']}));
  assert.equal(good(),1,'badge with 6 Pokémon: one kind wheel');
  await passiveEngine.observe(lobby.id,ben.id,state({species:six,completed:['badge1','badge2','badge3']}));
  assert.equal(good(),1,'same badge replayed: no second wheel');
  assert.deepEqual(passives.progress(lobby.id,ben.id,'sixth-man','rewarded',[]),['badge3']);

  // Cartographe: 5 big areas (a building in a known town does not count) → one ticket.
  for(const label of ['Rosyères','Rosyères — Centre Pokémon — 1F','Route 101','Route 102','Myokara','Myokara — Arène'])await passiveEngine.observe(lobby.id,ben.id,state({label,species:six,completed:['badge1','badge2','badge3']}));
  assert.equal(passives.progress<string[]>(lobby.id,ben.id,'cartographer','places',[]).length,5,'Bourg-en-Vol + 4 areas');
  assert.equal(good(),2);

  // Collectionneur: 10 distinct species over time → one ticket, never twice.
  await passiveEngine.observe(lobby.id,ben.id,state({species:[2,3,5,6],completed:['badge1','badge2','badge3']}));
  assert.equal(passives.progress<number[]>(lobby.id,ben.id,'collector','species',[]).length,10);
  assert.equal(good(),3);
  await passiveEngine.observe(lobby.id,ben.id,state({species:[2,3,5,6],completed:['badge1','badge2','badge3']}));
  assert.equal(good(),3);
 }finally{await p.close();}
});

test('Deuxième souffle, Éclaireur, Brocanteur: money after a lost Run, private reveals',async()=>{
 const p=await passivePortal({implemented:implementedPassives,random:()=>1});
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,lobby,base,store,portal}=p;const {passives,passiveEngine}=portal.services;
  for(const id of ['second-wind','scout','bargain-hunter'])passives.grant(lobby.id,ben.id,id,'ADMIN');
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money:1000,party:[rawPokemon(1,5)]});closers.push(()=>game.close());
  const dashboard=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:ben.id},transports:['websocket'],reconnection:false});closers.push(()=>dashboard.close());
  const timDashboard=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:p.tim.id},transports:['websocket'],reconnection:false});closers.push(()=>timDashboard.close());
  const mine:string[]=[],theirs:string[]=[];
  dashboard.on('notification',(n:LobbyNotification)=>mine.push(n.message));timDashboard.on('notification',(n:LobbyNotification)=>theirs.push(n.message));
  await until(()=>dashboard.connected&&timDashboard.connected,'dashboards');
  const runs=`/api/lobbies/${lobby.id}/runs`;
  // Run #1 is not after a loss: no bonus. Run #2 after a loss: +1 500 ₽ once.
  const run1=(await as(admin.id).post(runs,{accountId:ben.id,start:true})).body;
  await new Promise(r=>setTimeout(r,100));assert.equal(game.money,1000);
  await as(admin.id).post(`${runs}/${run1.id}/status`,{status:'LOST'});
  await as(admin.id).post(runs,{accountId:ben.id,start:true});
  await until(()=>game.money===2500,'second wind paid');
  assert.equal(passives.progress(lobby.id,ben.id,'second-wind','uses',0),1);

  // Éclaireur: next objective revealed to Ben only.
  await portal.services.objectives.update(lobby.id,'rival103',{rewardMoney:700},admin.id);
  game.completed=['starter'];game.publish();await new Promise(r=>setTimeout(r,150));
  game.completed=['starter','rival103'];game.publish();
  await until(()=>mine.some(m=>m.includes('Éclaireur — prochain objectif')),'scout reveal');
  assert.ok(!theirs.some(m=>m.includes('Éclaireur')),'private');

  // Brocanteur: three lost auctions arm it; joining the next one reveals one exact stat, privately.
  for(const n of [1,2,3])await passiveEngine.publish({lobbyId:lobby.id,accountId:ben.id,id:`auction-lost:a${n}`,type:'AUCTION_LOST',data:{auctionId:`a${n}`}});
  assert.equal(passives.progress(lobby.id,ben.id,'bargain-hunter','armed',false),true);
  const template={...JSON.parse('{}'),stats:{maxHp:21,attack:42,defense:13,speed:14,spAttack:15,spDefense:16}};
  store.db.prepare(`INSERT INTO lobby_auctions(id,lobby_id,status,species_id,name,level,sample_size,uncertainty,hints_json,template_json,created_at) VALUES('lot',?,'OPEN',1,'Bulbizarre',5,1,0,'{}',?,'now')`).run(lobby.id,JSON.stringify(template));
  await passiveEngine.publish({lobbyId:lobby.id,accountId:ben.id,id:'auction-joined:lot',type:'AUCTION_JOINED',data:{auctionId:'lot'}});
  await until(()=>mine.some(m=>m.includes('Bulbizarre : Attaque = 42')),'reveal');
  assert.ok(!theirs.some(m=>m.includes('Bulbizarre')),'only the player sees it');
  assert.equal(passives.progress(lobby.id,ben.id,'bargain-hunter','armed',true),false,'used once');
  assert.deepEqual(passives.owned(lobby.id,ben.id).find(o=>o.passiveId==='bargain-hunter')!.progress,{losses:0,armed:false},'the value is not in the public progression');
 }finally{for(const c of closers)c();await p.close();}
});
