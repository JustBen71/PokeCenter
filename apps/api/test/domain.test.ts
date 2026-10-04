import test from 'node:test';
import assert from 'node:assert/strict';
import type {PublicNativeClient} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {DomainError,toApiError} from '../src/errors.js';
import {CurrentGameService} from '../src/game/current-game-service.js';
import {sanitizeMetadata} from '../src/audit/audit-service.js';

const setup=()=>{
 const store=new Store(':memory:');const d=store.portal!;
 const admin=d.accounts.save({id:'p-admin',name:'Admin',sprite:'red',admin:true});
 const ben=d.accounts.save({id:'p-ben',name:'Ben',sprite:'may',admin:false});
 const lobby=d.lobbies.create({name:'Octobre',createdBy:admin.id});
 d.lobbies.addMember(lobby.id,ben.id);
 return {store,...d,admin,ben,lobby};
};
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;

test('accounts keep their creation date and stay unique by normalized name',()=>{
 const {store,accounts}=setup();
 const before=accounts.get('p-ben')!;
 const after=accounts.save({id:'p-ben',name:'Bén',sprite:'red',admin:false});
 assert.equal(after.createdAt,before.createdAt);assert.equal(after.sprite,'red');
 assert.equal(accounts.findByName('BEN')?.id,'p-ben');
 assert.throws(()=>accounts.save({id:'p-other',name:'ben',sprite:'red',admin:false}),/UNIQUE/);
 store.close();
});

test('lobby creation adds the creator, default settings and a unique invite code; joining is idempotent',()=>{
 const {store,lobbies,lobby,admin,ben}=setup();
 assert.match(lobby.inviteCode,/^[0-9A-F]{8}$/);
 assert.equal(lobbies.getByInviteCode(lobby.inviteCode)?.id,lobby.id);
 assert.deepEqual(lobbies.members(lobby.id).map(m=>m.accountId),[admin.id,ben.id]);
 const joinedAt=lobbies.members(lobby.id)[1].joinedAt;lobbies.addMember(lobby.id,ben.id);
 assert.equal(lobbies.members(lobby.id).length,2);assert.equal(lobbies.members(lobby.id)[1].joinedAt,joinedAt);
 assert.equal(lobbies.settings(lobby.id).bankDepositTaxPercent,10);
 assert.equal(lobbies.updateSettings(lobby.id,{bankDepositTaxPercent:15}).bankDepositTaxPercent,15);
 assert.throws(()=>lobbies.updateSettings(lobby.id,{bankDepositTaxPercent:101}),code('VALIDATION_FAILED'));
 assert.throws(()=>lobbies.addMember(lobby.id,'p-ghost'),/FOREIGN KEY/);
 assert.throws(()=>lobbies.require('nope'),code('LOBBY_NOT_FOUND'));
 assert.equal(lobbies.setStatus(lobby.id,'RUNNING').status,'RUNNING');
 store.close();
});

test('runs are numbered per player, keep history and allow a single RUNNING attempt',()=>{
 const {store,runs,lobby,ben,admin}=setup();
 const first=runs.create(lobby.id,ben.id,{start:true});
 assert.equal(first.number,1);assert.equal(first.status,'RUNNING');assert.ok(first.startedAt);
 assert.throws(()=>runs.create(lobby.id,ben.id,{start:true}),code('RUN_ALREADY_RUNNING'));
 const second=runs.create(lobby.id,ben.id);assert.equal(second.number,2);assert.equal(second.status,'NOT_STARTED');
 assert.throws(()=>runs.start(second.id),code('RUN_ALREADY_RUNNING'));
 assert.equal(runs.current(lobby.id,ben.id)?.id,first.id);
 const lost=runs.transition(first.id,'LOST');assert.equal(lost.status,'LOST');assert.ok(lost.endedAt);
 assert.throws(()=>runs.transition(first.id,'RUNNING'),code('INVALID_RUN_TRANSITION'));
 assert.equal(runs.start(second.id).status,'RUNNING');
 assert.deepEqual(runs.history(lobby.id,ben.id).map(r=>[r.number,r.status]),[[2,'RUNNING'],[1,'LOST']]);
 // Another player is independent.
 assert.equal(runs.create(lobby.id,admin.id,{start:true}).number,1);
 assert.throws(()=>runs.create(lobby.id,'p-ghost'),code('NOT_LOBBY_MEMBER'));
 // The database itself rejects a second RUNNING row even if the service is bypassed.
 assert.throws(()=>store.db.prepare("INSERT INTO runs VALUES('x',?,?,9,'RUNNING',NULL,NULL,'t','t')").run(lobby.id,ben.id),/UNIQUE/);
 store.close();
});

test('confirming ledger rows moves server balances atomically and only once',()=>{
 const {store,ledger,lobby,ben}=setup();
 // A bank deposit with 10% tax: two legs that must both succeed.
 const legs=ledger.atomic(()=>[
  ledger.create({lobbyId:lobby.id,accountId:ben.id,type:'BANK_DEPOSIT',amount:9000,source:'GAME',destination:'BANK',commandId:'cmd-1',idempotencyKey:'deposit-1:bank'}),
  ledger.create({lobbyId:lobby.id,accountId:ben.id,type:'JACKPOT_CONTRIBUTION',amount:1000,source:'GAME',destination:'JACKPOT',commandId:'cmd-1',idempotencyKey:'deposit-1:jackpot'})
 ]);
 assert.deepEqual(legs.map(t=>t.status),['PENDING','PENDING']);
 assert.equal(ledger.bankBalance(lobby.id,ben.id),0);
 for(const t of legs)ledger.transition(t.id,'APPLYING');
 ledger.atomic(()=>legs.forEach(t=>ledger.transition(t.id,'CONFIRMED')));
 assert.equal(ledger.bankBalance(lobby.id,ben.id),9000);assert.equal(ledger.jackpotBalance(lobby.id),1000);
 // Confirming again must not credit twice.
 ledger.transition(legs[0].id,'CONFIRMED');assert.equal(ledger.bankBalance(lobby.id,ben.id),9000);
 assert.ok(ledger.get(legs[0].id)!.confirmedAt);
 assert.deepEqual(ledger.byCommand('cmd-1').map(t=>t.id),legs.map(t=>t.id));
 // Replaying the same idempotency key returns the existing row; a different payload is refused.
 assert.equal(ledger.create({lobbyId:lobby.id,accountId:ben.id,type:'BANK_DEPOSIT',amount:9000,source:'GAME',destination:'BANK',idempotencyKey:'deposit-1:bank'}).id,legs[0].id);
 assert.throws(()=>ledger.create({lobbyId:lobby.id,accountId:ben.id,type:'BANK_DEPOSIT',amount:1,source:'GAME',destination:'BANK',idempotencyKey:'deposit-1:bank'}),code('IDEMPOTENCY_CONFLICT'));
 store.close();
});

test('a failing ledger operation rolls back every leg of the database transaction',()=>{
 const {store,ledger,lobby,ben}=setup();
 ledger.record({lobbyId:lobby.id,accountId:ben.id,type:'ADMIN_ADJUSTMENT',amount:500,source:'EXTERNAL',destination:'BANK'});
 const count=()=>ledger.list(lobby.id).length;const before=count();
 // Withdraw 400 then 400 more: the second leg overdraws, so the first must disappear too.
 assert.throws(()=>ledger.atomic(()=>{
  ledger.record({lobbyId:lobby.id,accountId:ben.id,type:'ADMIN_ADJUSTMENT',amount:400,source:'BANK',destination:'EXTERNAL'});
  ledger.record({lobbyId:lobby.id,accountId:ben.id,type:'ADMIN_ADJUSTMENT',amount:400,source:'BANK',destination:'EXTERNAL'});
 }),code('INSUFFICIENT_FUNDS'));
 assert.equal(ledger.bankBalance(lobby.id,ben.id),500);assert.equal(count(),before);
 assert.throws(()=>ledger.record({lobbyId:lobby.id,type:'JACKPOT_REWARD',amount:1,source:'JACKPOT',destination:'EXTERNAL'}),code('INSUFFICIENT_FUNDS'));
 assert.throws(()=>ledger.record({lobbyId:lobby.id,accountId:ben.id,type:'BANK_WITHDRAW',amount:1,source:'BANK',destination:'GAME'}),code('VALIDATION_FAILED'));
 assert.throws(()=>ledger.create({lobbyId:lobby.id,type:'BANK_DEPOSIT',amount:1,source:'GAME',destination:'BANK'}),code('VALIDATION_FAILED'));
 assert.throws(()=>ledger.create({lobbyId:lobby.id,accountId:ben.id,type:'BANK_DEPOSIT',amount:0,source:'GAME',destination:'BANK'}),code('VALIDATION_FAILED'));
 store.close();
});

test('an uncertain game write stays in REVIEW until an explicit resolution',()=>{
 const {store,ledger,lobby,ben}=setup();
 const t=ledger.create({lobbyId:lobby.id,accountId:ben.id,type:'BANK_WITHDRAW',amount:100,source:'EXTERNAL',destination:'GAME'});
 ledger.transition(t.id,'APPLYING',{commandId:'cmd-lost'});
 const review=ledger.transition(t.id,'REVIEW',{metadata:{reason:'confirmation perdue'}});
 assert.equal(review.status,'REVIEW');assert.equal(review.commandId,'cmd-lost');assert.equal(review.metadata.reason,'confirmation perdue');
 // No path goes back to PENDING/APPLYING, so nothing can replay the command automatically.
 assert.throws(()=>ledger.transition(t.id,'APPLYING'),code('INVALID_TRANSACTION_TRANSITION'));
 assert.throws(()=>ledger.transition(t.id,'PENDING'),code('INVALID_TRANSACTION_TRANSITION'));
 assert.equal(ledger.transition(t.id,'FAILED').status,'FAILED');
 assert.throws(()=>ledger.transition(t.id,'CONFIRMED'),code('INVALID_TRANSACTION_TRANSITION'));
 store.close();
});

test('audit entries are filtered and never keep secrets or memory payloads',()=>{
 const {store,audit,lobby,ben,admin}=setup();
 audit.record({lobbyId:lobby.id,actorAccountId:admin.id,targetAccountId:ben.id,category:'GAME_COMMAND',action:'game.money.add',status:'REVIEW',commandId:'cmd-9',errorCode:'COMMAND_OUTCOME_UNKNOWN',message:'Confirmation perdue, état du jeu à vérifier',
  metadata:{amount:100,sessionToken:'abc',nested:{ADMIN_TOKEN:'x',raw:'00ff',ok:true},list:[{bridgeSecret:'s'}]}});
 audit.record({lobbyId:lobby.id,actorAccountId:admin.id,category:'LOBBY',action:'lobby.update',status:'SUCCESS',message:'ok'});
 const [entry]=audit.list({commandId:'cmd-9'});
 assert.deepEqual(entry.metadata,{amount:100,sessionToken:'[redacted]',nested:{ADMIN_TOKEN:'[redacted]',raw:'[redacted]',ok:true},list:[{bridgeSecret:'[redacted]'}]});
 assert.equal(audit.list({accountId:ben.id}).length,1);
 assert.equal(audit.list({lobbyId:lobby.id,category:'LOBBY'}).length,1);
 assert.equal(audit.list({status:'REVIEW'})[0].errorCode,'COMMAND_OUTCOME_UNKNOWN');
 assert.equal(JSON.stringify(sanitizeMetadata({x:'a'.repeat(600)})).length<600,true);
 store.close();
});

test('stable error payloads hide unexpected failures',()=>{
 assert.deepEqual(toApiError(new DomainError('RUN_NOT_RUNNING','Aucune Run')),{ok:false,error:{code:'RUN_NOT_RUNNING',message:'Aucune Run'}});
 assert.deepEqual(toApiError(new Error('SQLITE secret path')),{ok:false,error:{code:'INTERNAL_ERROR',message:'Erreur interne du serveur'}});
 assert.equal(new DomainError('GAME_NOT_CONNECTED','x').status,409);
});

test('CurrentGameService resolves the game context and refuses sensitive actions with precise codes',()=>{
 const {store,lobbies,runs,lobby,ben}=setup();
 let now=Date.parse('2026-10-04T12:00:00.000Z');
 const observedAt=new Date(now).toISOString();
 const client:PublicNativeClient={accountId:ben.id,playerId:'install-ben',playerName:'Ben',ready:true,lastSeenAt:observedAt,clientVersion:'1',platform:'win',emulator:{name:'BizHawk'},
  bridge:{type:'bizhawk',connected:true,gameLoaded:true,protocolVersion:1},system:'GBA',allowMemoryWrites:false,canPurchase:true,
  adapter:{id:'gen3',status:'ready',profileId:'BPEF',capabilities:['trainer.read','money.read','party.read']},
  gameState:{gameStateVersion:1,adapter:{id:'gen3',status:'ready',profileId:'BPEF',capabilities:['trainer.read','money.read','party.read']},
   game:{family:'pokemon',generation:3,title:'emerald',language:'fr',revision:'0'},trainer:{name:'BEN',money:24350,playTimeSeconds:10,partyCount:1},
   location:{mapGroup:0,mapNumber:0,label:'Bourg-en-Vol'},party:[{raw:'00'.repeat(100),slot:1,speciesId:25,speciesName:'Pikachu',nickname:null,level:5,currentHp:20,maxHp:20,shiny:false}],
   progression:{version:1,completed:[]},capabilities:['trainer.read','money.read','party.read'],observedAt}
 };
 let clients:PublicNativeClient[]=[];
 const service=new CurrentGameService({lobbies,runs,clients:()=>clients,staleAfterMs:15000,now:()=>now});
 const refused=(c:string,options={})=>assert.throws(()=>service.require(lobby.id,ben.id,options),code(c));

 assert.throws(()=>service.resolve(lobby.id,'p-ghost'),code('NOT_LOBBY_MEMBER'));
 assert.throws(()=>service.resolve('nope',ben.id),code('LOBBY_NOT_FOUND'));
 refused('GAME_NOT_CONNECTED');
 clients=[{...client,bridge:{...client.bridge,connected:false}}];refused('GAME_NOT_CONNECTED');
 clients=[{...client,bridge:{...client.bridge,gameLoaded:false}}];refused('GAME_NOT_CONNECTED');
 clients=[{...client,adapter:{...client.adapter,status:'unknown_rom'},gameState:null}];refused('GAME_ADAPTER_NOT_READY');
 clients=[client];
 refused('CAPABILITY_MISSING',{capabilities:['money.read','money.write']});
 refused('RUN_NOT_RUNNING',{capabilities:['money.read']});
 const run=runs.create(lobby.id,ben.id,{start:true});
 const context=service.require(lobby.id,ben.id,{capabilities:['money.read']});
 assert.equal(context.run?.id,run.id);assert.equal(context.game.money,24350);assert.equal(context.game.fresh,true);
 // The context exposes no raw Pokémon memory and no ROM fingerprint.
 assert.doesNotMatch(JSON.stringify(context),/raw|romSha256|0000000000/);
 now+=20000;refused('GAME_STATE_STALE');
 assert.equal(service.require(lobby.id,ben.id,{requireFresh:false}).game.fresh,false);
 store.close();
});
