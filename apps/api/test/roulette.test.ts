import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import type {Gag,PublicPlayer} from '@pokerace/shared';
import {weightedDraw,planGag} from '../src/roulette-engine.js';
import {registerRoulette} from '../src/roulette-routes.js';
import {observeEffect,assertKeptPokemon} from '../src/roulette-effects.js';
import {Store} from '../src/store.js';

const gag:Gag={id:'swap',name:'Échange',enabled:true,weight:1,action:'pokemon.swap',blocks:{playerA:{mode:'fixed',playerId:'a'},playerB:{mode:'fixed',playerId:'b'},pokemonA:{mode:'highest'},pokemonB:{mode:'lowest'}}};
function players():PublicPlayer[]{return ['a','b'].map((id,i)=>({playerId:id,connected:true,lastSeenAt:new Date().toISOString(),receivedAt:new Date().toISOString(),state:{playerId:id,playerName:id,observedAt:new Date().toISOString(),game:{romStatus:'recognized'},capabilities:['compare-replace-v1'],progression:{version:1,completed:[]},party:[{slot:1,level:5,raw:String(i+1).repeat(200),speciesName:id},{slot:2,level:10,raw:String(i+3).repeat(200),speciesName:id+'2'}]}})) as PublicPlayer[];}
test('weighted tickets cover exact weights and ignore disabled gags',()=>{
 const gags=[gag,{...gag,id:'second',weight:3},{...gag,id:'off',enabled:false,weight:999}];
 assert.deepEqual([0,1,2,3].map(n=>weightedDraw(gags,()=>n).id),['swap','second','second','second']);
 assert.throws(()=>weightedDraw([]));
});
test('plans preserve exact bytes and select levels; unavailable clients fail',()=>{
 const p=players(),plan=planGag(gag,p,'a',()=>0);
 assert.deepEqual(plan.operations.map(o=>[o.playerId,o.slot,o.before[0],o.after[0]]),[['a',2,'3','2'],['b',1,'2','3']]);
 p[1].state.capabilities=[];assert.throws(()=>planGag(gag,p,'a'),/Relancez/);
 p[1].connected=false;assert.throws(()=>planGag(gag,p,'a'),/indisponible/);
});
test('random selectors never exchange a player with themselves, including tied ranks',()=>{
 for(const mode of ['random','first','last','penultimate']){
 const plan=planGag({...gag,blocks:{...gag.blocks,playerA:{mode},playerB:{mode}}},players(),'a',()=>0);
 assert.notEqual(plan.operations[0].playerId,plan.operations[1].playerId);
 }
});
test('draw/apply is durable and idempotent; failure compensates and locks uncertain targets',async()=>{
 const store=new Store(':memory:'),app=express();app.use(express.json());let p=players(),fail=false;const sent:any[]=[];
 registerRoulette(app,store,()=>p,async op=>{sent.push(op);if(fail&&op.playerId==='b')throw Error('connexion perdue');},new Set());store.putGag(gag);
 try{
  assert.equal((await request(app).post('/api/roulette/draw').send({drawKey:randomUUID()})).status,400);
  assert.equal((await request(app).post('/api/roulette/draw').send({drawKey:randomUUID(),spinnerId:'missing'})).status,400);
  const key=randomUUID();const draw=await request(app).post('/api/roulette/draw').send({drawKey:key,spinnerId:'a'});assert.equal(draw.body.status,'drawn');assert.equal(draw.body.spinnerId,'a');
  assert.equal((await request(app).post('/api/roulette/draw').send({drawKey:key,spinnerId:'b'})).status,409);
  assert.deepEqual((await request(app).post('/api/roulette/draw').send({drawKey:key,spinnerId:'a'})).body,draw.body);
  assert.equal((await request(app).post(`/api/roulette/runs/${key}/apply`)).body.status,'completed');assert.equal(sent.length,2);assert.equal(store.library().length,2);
  await request(app).post(`/api/roulette/runs/${key}/apply`);assert.equal(sent.length,2);
  fail=true;const key2=randomUUID();await request(app).post('/api/roulette/draw').send({drawKey:key2,spinnerId:'a'});
  assert.equal((await request(app).post(`/api/roulette/runs/${key2}/apply`)).body.status,'review');
  assert.equal(sent.length,5);assert.equal(sent[4].raw,sent[2].expectedRaw);assert.equal(sent[4].expectedRaw,sent[2].raw);
  const key3=randomUUID();await request(app).post('/api/roulette/draw').send({drawKey:key3,spinnerId:'a'});assert.equal((await request(app).post(`/api/roulette/runs/${key3}/apply`)).status,409);
  await request(app).post(`/api/roulette/runs/${key2}/reviewed`);p[0].state.party[1].raw='f'.repeat(200);
  assert.equal((await request(app).post(`/api/roulette/runs/${key3}/apply`)).body.status,'failed');assert.equal(sent.length,5);
 }finally{store.close();}
});

test('spinner always owns A even when a saved gag names another A',()=>{
 const plan=planGag({...gag,blocks:{...gag.blocks,playerB:{mode:'random'}}},players(),'b',()=>0);
 assert.equal(plan.operations[0].playerId,'b');assert.equal(plan.operations[1].playerId,'a');
 assert.throws(()=>planGag(gag,players(),'unknown'));
});


test('catalogue import is persistent, optional and does not resurrect deleted gags',()=>{
 const store=new Store(':memory:'),app=express();registerRoulette(app,store,players,async()=>{},new Set());
 assert.equal(store.gags().length,20);assert.equal(store.gags().filter(g=>g.enabled).length,0);
 store.deleteGag('chaos-01');registerRoulette(express(),store,players,async()=>{},new Set());assert.equal(store.gags().length,19);store.close();
});

test('money transfers conserve balances and refuse overflow',()=>{
 const ps=players();ps.forEach(p=>{p.state.capabilities!.push('game-bundle-v1');p.state.trainer={money:1001} as any;});
 const money:Gag={...gag,action:'money.transfer',blocks:{direction:'redistribute',percent:100,playerB:{mode:'random'}}};
 const plan=planGag(money,ps,'a');assert.deepEqual(plan.operations.map(o=>o.bundleAfter!.money),[0,2002]);
 ps[0].state.trainer!.money=999999;assert.throws(()=>planGag({...money,blocks:{direction:'steal',percent:50,playerB:{mode:'fixed',playerId:'b'}}},ps,'a'),/plafond/);
});

test('human choices block execution, authenticate voters and survive reload',async()=>{
 const store=new Store(':memory:'),app=express();app.use(express.json());app.use((req,res,next)=>{res.locals.account={id:req.header('x-account-id')};next();});const ps=players();ps.forEach(p=>p.state.party.forEach(mon=>mon.currentHp=10));let sends=0;
 registerRoulette(app,store,()=>ps,async()=>{sends++;},new Set());store.putGag({...gag,blocks:{playerB:{mode:'choice'},pokemonA:{mode:'choice',by:'target'},pokemonB:{mode:'highest'}}});
 const id=randomUUID();let run=(await request(app).post('/api/roulette/draw').send({drawKey:id,spinnerId:'a'})).body;
 assert.equal(run.pending.key,'playerB');assert.equal((await request(app).post(`/api/roulette/runs/${id}/apply`)).status,409);assert.equal(sends,0);
 assert.equal((await request(app).post(`/api/roulette/runs/${id}/choose`).set('x-account-id','b').send({value:'b',key:'playerB'})).status,400);
 run=(await request(app).post(`/api/roulette/runs/${id}/choose`).set('x-account-id','a').send({value:'b',key:'playerB'})).body;
 assert.equal(run.pending.key,'pokemonA');assert.deepEqual(run.pending.actors,['b']);assert.equal(store.run(id)!.choices!.playerB,'b');
 run=(await request(app).post(`/api/roulette/runs/${id}/choose`).set('x-account-id','b').send({value:run.pending.options[0].value,key:run.pending.key})).body;
 assert.equal(run.pending,undefined);assert.equal(run.operations.length,2);assert.equal((await request(app).post(`/api/roulette/runs/${id}/apply`)).body.status,'completed');assert.equal(sends,2);store.close();
});


test('cards persist, belong to their owner and expire at the next badge',async()=>{
 const store=new Store(':memory:'),app=express(),ps=players();app.use(express.json());app.use((req,res,next)=>{res.locals.account={id:req.header('x-account-id')};next();});const monitor=registerRoulette(app,store,()=>ps,async()=>{},new Set());
 store.putGag({...gag,action:'card.grant',blocks:{kind:'reroll'}});const id=randomUUID();await request(app).post('/api/roulette/draw').send({drawKey:id,spinnerId:'a'});await request(app).post(`/api/roulette/runs/${id}/apply`);await request(app).post(`/api/roulette/runs/${id}/apply`);
 assert.equal(store.effects().length,1);const card=store.effects()[0];assert.equal(card.status,'active');
 assert.equal((await request(app).post(`/api/roulette/effects/${card.id}/use`).set('x-account-id','b').send({playerId:'a'})).status,403);
 assert.equal((await request(app).post(`/api/roulette/effects/${card.id}/use`).set('x-account-id','a').send({playerId:'b'})).status,200);assert.equal(store.effects()[0].status,'armed');
 ps[0].state.progression!.completed.push('badge1');await monitor.observe();assert.equal(store.effects()[0].status,'expired');store.close();
});

test('inheritance applies once after a newly observed death',async()=>{
 const store=new Store(':memory:'),app=express(),ps=players(),sent:any[]=[];app.use(express.json());ps.forEach(p=>{p.state.capabilities!.push('game-bundle-v1');p.state.trainer={money:1000} as any;p.state.party.forEach(mon=>mon.currentHp=10);});
 const monitor=registerRoulette(app,store,()=>ps,async op=>{sent.push(op);},new Set());store.putGag({...gag,action:'rule.inheritance',blocks:{playerB:{mode:'fixed',playerId:'b'},deathPercent:50,badgePercent:25}});
 const id=randomUUID();await request(app).post('/api/roulette/draw').send({drawKey:id,spinnerId:'a'});await request(app).post(`/api/roulette/runs/${id}/apply`);assert.equal(sent.length,0);
 ps[0].state.party[0].currentHp=0;await monitor.observe();assert.equal(sent.length,2);assert.deepEqual(sent.map(o=>o.after.money),[500,1500]);await monitor.observe();assert.equal(sent.length,2);assert.equal(store.effects()[0].status,'triggered');store.close();
});

test('a double wheel queues two finite independent effects and runs each only once',async()=>{
 const store=new Store(':memory:'),app=express(),ps=players();app.use(express.json());const monitor=registerRoulette(app,store,()=>ps,async()=>{},new Set());
 const repeat={...gag,action:'roulette.repeat',blocks:{count:2}};store.putGag(repeat);store.putGag({...gag,id:'notice',action:'gag.notice',blocks:{text:'Un tour de table'}});
 const id=randomUUID();store.putRun({id,drawKey:id,gagId:repeat.id,gag:repeat,name:repeat.name,spinnerId:'a',status:'drawn',createdAt:new Date().toISOString(),operations:[],summary:'Deux tours',log:[],odds:[]});
 assert.equal((await request(app).post(`/api/roulette/runs/${id}/apply`)).status,200);assert.equal(store.childRuns(id).length,2);assert.ok(store.childRuns(id).every(r=>r.status==='completed'));await monitor.observe();await request(app).post(`/api/roulette/runs/${id}/apply`);assert.equal(store.childRuns(id).length,2);store.close();
});


test('capture restriction observes two new routes and keeps violation counts',()=>{
 const ps=players(),owner=ps[0];owner.state.location={mapGroup:0,mapNumber:9,label:'Bourg-en-Vol'};owner.state.events={trainerBattles:0,captures:0,trainerLead:null};
 const effect:any={id:'r',runId:'r',name:'Pacte',ownerId:'a',kind:'noCapture',status:'active',badges:[],living:[],captures:0,routeCount:2,routes:[],lastMap:'0:9',violations:0};
 owner.state.location={mapGroup:0,mapNumber:16,label:'Route 101'};observeEffect(effect,ps);assert.equal(effect.routes.length,1);
 owner.state.events.captures=1;observeEffect(effect,ps);assert.equal(effect.violations,1);
 owner.state.location={mapGroup:0,mapNumber:10,label:'Rosyères'};observeEffect(effect,ps);assert.equal(effect.status,'active');
 owner.state.location={mapGroup:0,mapNumber:17,label:'Route 102'};observeEffect(effect,ps);assert.equal(effect.routes.length,2);assert.equal(effect.status,'active');
 owner.state.location={mapGroup:0,mapNumber:0,label:'Clémenti-Ville'};observeEffect(effect,ps);assert.equal(effect.status,'expired');assert.match(effect.note,/1 capture/);
});

test('keep rules reject portal removals and the next badge releases them',()=>{
 const store=new Store(':memory:'),ps=players(),identity=ps[0].state.party[0].raw!.slice(0,16);ps[0].state.party[0].currentHp=10;
 const effect:any={id:'keep',runId:'r',name:'Garde',ownerId:'a',kind:'keep',identity,status:'active',badges:[],living:[identity],note:'',createdAt:new Date().toISOString()};store.putEffect(effect);
 assert.throws(()=>assertKeptPokemon(store,'a',[ps[0].state.party[1].raw!]),/rester/);ps[0].state.progression!.completed.push('badge1');observeEffect(effect,ps);store.putEffect(effect);assert.doesNotThrow(()=>assertKeptPokemon(store,'a',[]));store.close();
});


test('timed suspension removes exact bytes, survives restart, waits for room and restores once',async()=>{
 const store=new Store(':memory:'),app=express(),ps=players(),sent:any[]=[];app.use(express.json());
 ps.forEach(p=>{p.state.capabilities!.push('game-bundle-v1');p.state.trainer={money:1000,partyCount:2} as any;p.state.party.forEach(mon=>mon.currentHp=10);});
 const send=async(op:any)=>{sent.push(op);const p=ps.find(p=>p.playerId===op.playerId)!;p.state.party=op.after.party.map((raw:string,i:number)=>({...p.state.party[0],slot:i+1,raw}));p.state.trainer!.partyCount=p.state.party.length;};
 let monitor=registerRoulette(app,store,()=>ps,send,new Set());store.putGag({...gag,action:'pokemon.suspend',blocks:{pokemonA:{mode:'slot',slot:1},minutes:10}});
 const original=ps[0].state.party[0].raw!,id=randomUUID();await request(app).post('/api/roulette/draw').send({drawKey:id,spinnerId:'a'});assert.equal((await request(app).post(`/api/roulette/runs/${id}/apply`)).body.status,'completed');
 assert.equal(ps[0].state.party.length,1);const effect=store.effects()[0];assert.equal(effect.raw,original);assert.ok(Date.parse(effect.releaseAt!)-Date.parse(effect.createdAt)>=599000);assert.throws(()=>assertKeptPokemon(store,'b',[original]),/indisponible/);
 await monitor.observe();assert.equal(sent.length,1);ps[0].state.progression!.completed.push('badge1');await monitor.observe();assert.equal(store.effects()[0].status,'active');
 effect.releaseAt=new Date(Date.now()-1).toISOString();store.putEffect(effect);ps[0].connected=false;await monitor.observe();assert.equal(sent.length,1);
 monitor=registerRoulette(express(),store,()=>ps,send,new Set());ps[0].connected=true;const remaining=ps[0].state.party[0];ps[0].state.party=Array.from({length:6},(_,i)=>({...remaining,slot:i+1}));await monitor.observe();assert.equal(sent.length,1);assert.match(store.effects()[0].note,/place/);
 ps[0].state.party=[remaining];await monitor.observe();assert.equal(sent.length,2);assert.equal(ps[0].state.party[1].raw,original);assert.equal(store.effects()[0].status,'used');await monitor.observe();assert.equal(sent.length,2);store.close();
});

test('suspension preserves the last living Pokemon and never retries uncertain returns',async()=>{
 const ps=players();ps.forEach(p=>{p.state.capabilities!.push('game-bundle-v1');p.state.trainer={money:1000} as any;p.state.party.forEach(mon=>mon.currentHp=10);});
 const suspend={...gag,action:'pokemon.suspend',blocks:{pokemonA:{mode:'slot',slot:1},minutes:10}};
 ps[0].state.party[1].currentHp=0;assert.throws(()=>planGag(suspend,ps,'a'),/vivant/);ps[0].state.party[1].currentHp=10;
 const store=new Store(':memory:'),app=express();app.use(express.json());let calls=0;const send=async()=>{calls++;if(calls>1)throw Error('Acknowledgement lost');};const monitor=registerRoulette(app,store,()=>ps,send,new Set());store.putGag(suspend);
 const id=randomUUID();await request(app).post('/api/roulette/draw').send({drawKey:id,spinnerId:'a'});await request(app).post(`/api/roulette/runs/${id}/apply`);ps[0].state.party.shift();ps[0].state.party[0].slot=1;const effect=store.effects()[0];effect.releaseAt=new Date(Date.now()-1).toISOString();store.putEffect(effect);
 await monitor.observe();assert.equal(calls,2);assert.equal(store.effects()[0].status,'review');await monitor.observe();assert.equal(calls,2);const restarted=registerRoulette(express(),store,()=>ps,send,new Set());await restarted.observe();assert.equal(calls,2);store.close();
});
