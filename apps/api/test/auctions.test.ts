import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {Store} from '../src/store.js';
import {registerAuctions} from '../src/auction-routes.js';
import {generateLot} from '../src/auction-generator.js';
import type {PublicPlayer,PokemonInjection,BuiltPokemon} from '@pokerace/shared';
const build=async(form:PokemonInjection):Promise<BuiltPokemon>=>({name:'Pikachu',stats:{maxHp:40,attack:20,defense:20,speed:20,spAttack:20,spDefense:20},moves:[{id:33,pp:35},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],experience:1000,choices:[]});
function players():PublicPlayer[]{return ['alice','bob'].map((id,i)=>({playerId:id,connected:true,lastSeenAt:new Date().toISOString(),receivedAt:new Date().toISOString(),state:{playerId:id,playerName:id,game:{romStatus:'recognized'},capabilities:['auction-purchase-v1'],trainer:{money:3000,partyCount:1},party:[{slot:1,level:10+i*5}]}})) as PublicPlayer[];}
test('generation averages all active Pokemon, includes dex endpoints and legal random IV/EV',async()=>{
 const p=players();p[1].state.party.push({...p[1].state.party[0],slot:2,level:20});p[1].state.trainer!.partyCount=2;
 const low=await generateLot(p,()=>0,build),high=await generateLot(p,max=>max-1,build);
 assert.equal(low.level,15);assert.equal(low.sampleSize,3);assert.equal(low.speciesId,1);assert.equal(high.speciesId,386);
 assert.deepEqual(Object.values(high.template.ivs),[31,31,31,31,31,31]);assert.equal(Object.values(high.template.evs).reduce((a,b)=>a+b),510);assert.ok(Object.values(high.template.evs).every(v=>v<=255));
 assert.equal(low.template.currentHp,40);assert.deepEqual(low.template.moves,(await build(low.template)).moves);
 await assert.rejects(generateLot([],()=>0,build));
});
test('auction keeps secrets, serializes bids, checks cash/space and settles only once',async()=>{
 const store=new Store(':memory:'),app=express(),locks=new Set<string>(),p=players(),sent:any[]=[];app.use(express.json());
 registerAuctions(app,store,()=>p,async d=>{sent.push(d);},locks,ps=>generateLot(ps,()=>0,build));
 try{
  const created=await request(app).post('/api/auctions').send({});assert.equal(created.status,201);const id=created.body.id;
  const snapshot=(await request(app).get('/api/auctions')).body.auctions[0];assert.deepEqual(snapshot.hints,created.body.hints);assert.equal(snapshot.uncertainty,25);
  for(const key of ['template','moves','settlement'])assert.ok(!JSON.stringify(created.body).includes(`"${key}"`));
  assert.equal((await request(app).post('/api/auctions').send({})).status,409);
  const bid=(playerId:string,amount:number)=>request(app).post(`/api/auctions/${id}/bid`).send({playerId,amount});
  assert.equal((await bid('alice',4000)).status,409);
  p[0].state.trainer!.partyCount=6;assert.equal((await bid('alice',100)).status,409);p[0].state.trainer!.partyCount=1;
  const concurrent=await Promise.all([bid('alice',100),bid('bob',100)]);assert.equal(concurrent.filter(r=>r.status===200).length,1);
  await bid('bob',200);assert.equal((await request(app).post(`/api/auctions/${id}/accept`).send({playerId:'alice',amount:100})).status,409);assert.equal(sent.length,0);
  const accept=()=>request(app).post(`/api/auctions/${id}/accept`).send({playerId:'bob',amount:200});
  assert.equal((await accept()).body.status,'sold');await accept();assert.equal(sent.length,1);
  assert.equal(sent[0].action,'purchase');assert.equal(sent[0].expectedMoney,3000);assert.equal(sent[0].expectedCount,1);assert.equal(sent[0].slot,2);assert.equal(sent[0].price,200);assert.equal(locks.size,0);
 }finally{store.close();}
});
test('uncertain purchase is locked, persists through restart and is never retried',async()=>{
 const store=new Store(':memory:'),app=express(),locks=new Set<string>();app.use(express.json());let attempts=0;
 const register=(target:ReturnType<typeof express>,l:Set<string>)=>registerAuctions(target,store,players,async()=>{attempts++;throw Error('lost acknowledgement')},l,ps=>generateLot(ps,()=>0,build));register(app,locks);
 try{
  const id=(await request(app).post('/api/auctions').send({})).body.id;
  await request(app).post(`/api/auctions/${id}/bid`).send({playerId:'alice',amount:100});
  await request(app).post(`/api/auctions/${id}/accept`).send({playerId:'alice',amount:100});
  assert.equal(store.auctions()[0].status,'review');assert.ok(locks.has('alice'));
  await request(app).post(`/api/auctions/${id}/accept`).send({playerId:'alice',amount:100});assert.equal(attempts,1);
  const restarted=express(),newLocks=new Set<string>();restarted.use(express.json());register(restarted,newLocks);assert.ok(newLocks.has('alice'));
  assert.equal((await request(restarted).post('/api/auctions').send({})).status,409);
  await request(restarted).post(`/api/auctions/${id}/reviewed`).send({outcome:'cancelled'});assert.equal(newLocks.size,0);assert.equal(attempts,1);
 }finally{store.close();}
});
