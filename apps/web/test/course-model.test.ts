import test from 'node:test';
import assert from 'node:assert/strict';
import type {PublicPlayer,Run} from '@pokerace/shared';
import {courseRows,runActions} from '../src/course/course-model.ts';
import type {PlayerViewModel} from '../src/native-clients.ts';

const member=(id:string,name:string)=>({id,name,sprite:'red',admin:false,joinedAt:'2026-10-04T00:00:00.000Z'});
const view=(accountId:string,{connected=true,completed=[] as string[],money=1000,source='native' as PlayerViewModel['source']}={}):PlayerViewModel=>{
 const display={playerId:accountId,connected,receivedAt:'2026-10-04T00:00:00.000Z',lastSeenAt:'2026-10-04T00:00:00.000Z',
  state:{protocolVersion:1,playerId:accountId,playerName:accountId,game:{name:'pokemon-emerald',language:'fr',profileId:'p',romStatus:'recognized',revision:'0',header:null},
   trainer:{name:'T',money},location:{mapGroup:0,mapNumber:0,label:'Bourg-en-Vol'},party:[],progression:{version:1,completed},observedAt:'2026-10-04T00:00:00.000Z',diagnostic:null}} as unknown as PublicPlayer;
 return {accountId,display,source,legacyActionsAvailable:false};
};
const run=(accountId:string,number:number,status:Run['status']):Run=>({id:`${accountId}-${number}`,lobbyId:'l',accountId,number,status,startedAt:null,endedAt:null,createdAt:'',updatedAt:''});

test('every member has a row, ranked by real progression with shared ranks',()=>{
 const rows=courseRows([member('a','Ana'),member('b','Ben'),member('c','Cyl'),member('d','Dan')],
  [view('a',{completed:['badge1']}),view('b',{completed:['badge1']}),view('c',{connected:false})],
  [run('a',1,'LOST'),run('a',2,'RUNNING'),run('b',1,'NOT_STARTED')]);
 assert.deepEqual(rows.map(r=>[r.name,r.rank]),[['Ana',1],['Ben',1],['Cyl',3],['Dan',null]]);
 const ana=rows[0];assert.equal(ana.run?.number,2);assert.deepEqual(ana.runs.map(r=>r.number),[2,1]);
 assert.equal(rows[1].run?.status,'NOT_STARTED');
 assert.deepEqual(rows.map(r=>r.clientState),['playing','playing','offline','never']);
 assert.equal(rows[3].money,null);assert.equal(rows[0].location,'Bourg-en-Vol');
});

test('a connected player who is not a member still appears',()=>{
 const rows=courseRows([],[view('x',{source:'connection'})],[]);
 assert.equal(rows.length,1);assert.equal(rows[0].clientState,'no-game');
});

test('admin Run actions follow the Run state machine',()=>{
 assert.deepEqual(runActions(null).map(a=>a.label),['Démarrer la Run #1','Préparer sans démarrer']);
 assert.deepEqual(runActions(run('a',1,'NOT_STARTED')).map(a=>a.status),['RUNNING','ABORTED']);
 assert.deepEqual(runActions(run('a',1,'RUNNING')).map(a=>a.status),['LOST','COMPLETED','ABORTED']);
 assert.equal(runActions(run('a',1,'LOST'))[0].label,'Nouvelle Run');
});
