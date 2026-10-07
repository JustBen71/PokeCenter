import test from 'node:test';
import assert from 'node:assert/strict';
import type {Objective,PublicPlayer} from '@pokerace/shared';
import {routeFromHash,routes} from '../src/app/routes.ts';
import {rankBy,raceScore} from '../src/map/objective-score.ts';

test('admin pages are hidden from players and old links still work',()=>{
 assert.equal(routeFromHash('#/gestion',false),'course');assert.equal(routeFromHash('#/gestion',true),'management');
 assert.equal(routeFromHash('#/logs',false),'course');assert.equal(routeFromHash('#/bibliotheque',false),'course');
 assert.equal(routeFromHash('#/equipes',false),'course');assert.equal(routeFromHash('#/progressions',false),'map');assert.equal(routeFromHash('#/roulette',true),'wheels');
 assert.equal(routeFromHash('#/nimporte',false),'course');
 assert.deepEqual(routes.filter(r=>!r.admin).map(r=>r.id),['course','map','board','passives','auctions','shop','bank','jackpot']);
 assert.equal(new Set(routes.map(r=>r.hash)).size,routes.length);
});

const player=(completed:string[],known=true)=>({state:{game:{romStatus:known?'recognized':'unknown'},progression:known?{version:1,completed}:null}} as unknown as PublicPlayer);
const objective=(id:string,order:number,enabled=true):Objective=>({id,name:id,description:'',order,rewardMoney:0,mapPosition:null,gameCondition:{type:'progression',objectiveId:id},enabled});

test('race score follows the lobby objectives: count first, then the furthest objective; ties share a rank',()=>{
 const objectives=[objective('starter',10),objective('badge1',20),objective('badge2',30),objective('woods',15,false)];
 const a=raceScore(player(['starter','badge1']),objectives),b=raceScore(player(['badge2','starter']),objectives),c=raceScore(player(['woods']),objectives);
 assert.ok(b.score>a.score,'same count, furthest objective wins');
 assert.equal(c.score,0,'disabled objectives do not count');
 assert.deepEqual(rankBy([a,b,a,{known:false,score:0}],r=>r.known?r.score:null),[2,1,2,null]);
 // Without lobby objectives the default Emerald order is kept.
 assert.ok(raceScore(player(['badge1']),[]).score>raceScore(player(['starter']),[]).score);
});
