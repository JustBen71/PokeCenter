import test from 'node:test';
import assert from 'node:assert/strict';
import {passiveFixture} from './support/domain-fixture.js';
import {BattleEncounterService} from '../src/battles/battle-encounter-service.js';
import {DomainError} from '../src/errors.js';

const code=(fn:()=>unknown)=>{try{fn();}catch(e){return e instanceof DomainError?e.code:String(e);}return 'OK';};
const party=[{speciesId:19,level:3,moves:[33,39],heldItem:0,nature:4,ev:0}];
const source={type:'CUSTOM_PARTY' as const,refId:null,label:'test',scaling:{mode:'COPY_EXACT' as const,delta:0}};

test('battle encounters: migration 15, frozen spec, queue, one active battle per player, audited lifecycle',()=>{
 const {domain,lobbyId}=passiveFixture();
 const battles=new BattleEncounterService({domain,changed:()=>{},notify:()=>{}});
 domain.audit.record({lobbyId,category:'BATTLE',action:'x',status:'INFO',message:'ok'});
 assert.equal(code(()=>battles.create(lobbyId,'out',{trainer:{name:'BEN',spriteId:'youngster'},party},source,'adm')),'NOT_LOBBY_MEMBER');
 assert.equal(code(()=>battles.create(lobbyId,'ben',{trainer:{name:'BEN',spriteId:'youngster'},party:[{...party[0],speciesId:0}]},source,'adm')),'VALIDATION_FAILED');
 const a=battles.create(lobbyId,'ben',{trainer:{name:'TIMÉO',spriteId:'cooltrainer_m'},party},source,'adm');
 assert.equal(a.status,'CREATED');assert.equal(a.trainer.name,'TIMÉO');assert.deepEqual(a.party,party);
 assert.equal(battles.queue(lobbyId,a.id,'adm').status,'WAITING_SAFE_STATE');
 const b=battles.create(lobbyId,'ben',{trainer:{name:'BIS',spriteId:'lass'},party},source,'adm');
 assert.equal(code(()=>battles.queue(lobbyId,b.id,'adm')),'BATTLE_ALREADY_PENDING','one queued battle per player');
 assert.equal(code(()=>battles.move(a,'WON')),'CONFLICT','WAITING → WON is not allowed');
 const sending=battles.move(a,'SENDING',{commandId:a.id});
 const running=battles.move(sending,'RUNNING');assert.ok(running.startedAt);
 assert.equal(code(()=>battles.cancel(lobbyId,a.id,'adm')),'CONFLICT','a running battle cannot be cancelled');
 const won=battles.move(running,'WON',{result:{outcome:'WIN',observedAt:'now'}});
 assert.ok(won.endedAt);assert.deepEqual(won.result,{outcome:'WIN',observedAt:'now'});
 assert.equal(battles.queue(lobbyId,b.id,'adm').status,'WAITING_SAFE_STATE','free again after the end');
 assert.equal(battles.cancel(lobbyId,b.id,'adm').status,'CANCELLED');
 assert.deepEqual(domain.audit.list({lobbyId,category:'BATTLE'}).map(l=>l.action).filter(a=>a!=='x').reverse(),
  ['battle.created','battle.start_requested','battle.created','battle.start_requested','battle.cancelled']);
});
