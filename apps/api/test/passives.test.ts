import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {passiveCatalog,type LobbyNotification} from '@pokerace/shared';
import {Store} from '../src/store.js';
import {PassiveService} from '../src/passives/passive-service.js';
import {DomainError} from '../src/errors.js';

// Deterministic RNG: replays the given values (modulo n), then 0.
export const sequence=(...values:number[])=>(n:number)=>(values.length?values.shift()!:0)%n;
const code=(fn:()=>unknown)=>{try{fn();}catch(e){return e instanceof DomainError?e.code:String(e);}return 'OK';};

export function passiveFixture(path=':memory:',implemented:ReadonlySet<string>=new Set(passiveCatalog.map(p=>p.id)),random=sequence()){
 const store=new Store(path);const domain=store.portal!;
 for(const [id,name] of [['ben','Ben'],['tim','Tim'],['adm','Admin'],['out','Dehors']])domain.accounts.save({id,name,sprite:'may',admin:id==='adm'});
 const lobby=domain.lobbies.get('lobby')??domain.lobbies.create({id:'lobby',name:'Course',createdBy:'adm'});
 for(const id of ['ben','tim'])domain.lobbies.addMember(lobby.id,id);
 const notes:{n:LobbyNotification;to?:string}[]=[],changes:string[]=[];
 const passives=new PassiveService({domain,implemented,random,changed:l=>changes.push(l),notify:(_l,n,to)=>notes.push({n,to})});
 return {store,domain,passives,notes,changes,lobbyId:lobby.id};
}

test('migration 13: PASSIVE audit category and PASSIVE_REWARD ledger type are accepted, data kept',()=>{
 const {domain,lobbyId}=passiveFixture();
 domain.audit.record({lobbyId,category:'PASSIVE',action:'x',status:'INFO',message:'ok'});
 domain.db.prepare(`INSERT INTO money_transactions(id,lobby_id,type,amount,source,destination,status,created_at,updated_at) VALUES('t',?,'PASSIVE_REWARD',5,'EXTERNAL','GAME','PENDING','a','a')`).run(lobbyId);
 assert.ok(domain.audit.list({lobbyId,category:'PASSIVE'}).length>=1);
 const indexes=(domain.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('audit_logs','money_transactions')").all() as {name:string}[]).map(r=>r.name);
 for(const i of ['audit_logs_lobby','audit_logs_command','money_transactions_lobby','money_transactions_account','money_transactions_command'])assert.ok(indexes.includes(i),i);
});

test('passive service: availability, grant, duplicates, revoke, atomic transfer with progression',()=>{
 const {passives,domain,notes,lobbyId}=passiveFixture(':memory:',new Set(['scout','rivalry','counterspell','usurper']));
 const entry=(id:string)=>passives.catalog(lobbyId).find(p=>p.id===id)!;
 assert.equal(entry('scout').availability,'AVAILABLE');
 assert.equal(entry('marathoner').availability,'DISABLED_MISSING_CAPABILITY');
 assert.deepEqual(entry('marathoner').missing,['steps.read']);
 assert.equal(entry('paradox').availability,'NOT_YET_IMPLEMENTED');
 // Never granted while it cannot work.
 assert.equal(code(()=>passives.grant(lobbyId,'ben','marathoner','ADMIN')),'CAPABILITY_MISSING');
 assert.equal(code(()=>passives.grant(lobbyId,'out','scout','ADMIN')),'NOT_LOBBY_MEMBER');

 passives.grant(lobbyId,'ben','scout','ADMIN',{actorId:'adm'});
 passives.grant(lobbyId,'ben','rivalry','ADMIN',{actorId:'adm'});
 assert.equal(code(()=>passives.grant(lobbyId,'ben','scout','WHEEL')),'PASSIVE_ALREADY_OWNED');
 assert.deepEqual(passives.owned(lobbyId,'ben').map(p=>p.passiveId),['scout','rivalry'],'cumulative');
 assert.ok(notes.some(x=>x.n.message.includes('Ben obtient « Éclaireur »')));

 // Disabled in the lobby: no longer grantable.
 passives.updateSettings(lobbyId,{disabled:['counterspell']},'adm');
 assert.equal(code(()=>passives.grant(lobbyId,'tim','counterspell','ADMIN')),'CONFLICT');

 // Steal: progression follows the passive; duplicates and missing passives are refused without changes.
 passives.setProgress(lobbyId,'ben','scout','revealed',7);
 passives.grant(lobbyId,'tim','rivalry','ADMIN');
 assert.equal(code(()=>passives.transfer(lobbyId,'ben','tim','rivalry')),'PASSIVE_ALREADY_OWNED');
 assert.deepEqual(passives.owned(lobbyId,'ben').map(p=>p.passiveId),['scout','rivalry'],'rolled back');
 passives.transfer(lobbyId,'ben','tim','scout',{actorId:'adm'});
 assert.deepEqual(passives.owned(lobbyId,'ben').map(p=>p.passiveId),['rivalry']);
 const stolen=passives.owned(lobbyId,'tim').find(p=>p.passiveId==='scout')!;
 assert.equal(stolen.progress.revealed,7);assert.equal(stolen.metadata.stolenFrom,'ben');
 assert.ok(notes.some(x=>x.to==='ben'&&x.n.message.includes('Tim t’a volé « Éclaireur »')));
 assert.ok(notes.some(x=>x.to==='tim'&&x.n.message.includes('tu récupères « Éclaireur » de Ben')));
 assert.equal(code(()=>passives.transfer(lobbyId,'ben','tim','scout')),'PASSIVE_NOT_OWNED');

 // A consumed single-use passive is not stealable.
 passives.grant(lobbyId,'ben','usurper','ADMIN');passives.setProgress(lobbyId,'ben','usurper','consumed',true);
 assert.deepEqual(passives.stealable(lobbyId,'ben','tim').map(p=>p.passiveId),[]);
 assert.equal(code(()=>passives.transfer(lobbyId,'ben','tim','usurper')),'CONFLICT');

 passives.revoke(lobbyId,'tim','scout',{actorId:'adm'});
 assert.equal(passives.progress(lobbyId,'tim','scout','revealed',null),null,'progress removed with the passive');
 assert.ok(domain.audit.list({lobbyId,category:'PASSIVE'}).some(l=>l.action==='passive.steal'));
});

test('passive service: weighted pick by rarity, exclusions and no candidate',()=>{
 const {passives,lobbyId}=passiveFixture(':memory:',new Set(['scout','collector','rivalry','usurper']),sequence(0,0,54,0,55,0,87,0));
 // Weights 55/30/12/3 over COMMON, UNCOMMON, LEGENDARY (no RARE candidate): total 88.
 assert.equal(passives.pick(lobbyId,'ben')!.rarity,'COMMON');
 assert.equal(passives.pick(lobbyId,'ben')!.rarity,'COMMON');
 assert.equal(passives.pick(lobbyId,'ben')!.rarity,'UNCOMMON');
 assert.equal(passives.pick(lobbyId,'ben')!.id,'usurper','87 ≥ 55+30');
 assert.equal(passives.pick(lobbyId,'ben',{rarities:['RARE']}),null);
 passives.grant(lobbyId,'ben','usurper','ADMIN');
 assert.equal(passives.pick(lobbyId,'ben',{rarities:['LEGENDARY']}),null,'owned passives are excluded');
 assert.equal(passives.pick(lobbyId,'ben',{rarities:['COMMON'],exclude:['scout']})!.id,'collector');
 passives.updateSettings(lobbyId,{disabled:['collector']},'adm');
 assert.equal(passives.pick(lobbyId,'ben',{rarities:['COMMON'],exclude:['scout']}),null,'disabled passives are excluded');
 // A zero weight still allows a rarity explicitly requested.
 passives.updateSettings(lobbyId,{weights:{COMMON:1,UNCOMMON:0,RARE:0,LEGENDARY:0}},'adm');
 assert.equal(passives.pick(lobbyId,'tim',{rarities:['LEGENDARY']})!.id,'usurper');
});

test('passives survive a server restart',()=>{
 const folder=mkdtempSync(join(tmpdir(),'pokerace-passives-'));
 try{
  const path=join(folder,'portal.sqlite');
  let f=passiveFixture(path);
  f.passives.grant(f.lobbyId,'ben','scout','ADMIN');f.passives.setProgress(f.lobbyId,'ben','scout','revealed',2);f.store.close();
  f=passiveFixture(path);
  const [owned]=f.passives.owned(f.lobbyId,'ben');
  assert.equal(owned.passiveId,'scout');assert.equal(owned.progress.revealed,2);
  f.store.close();
 }finally{rmSync(folder,{recursive:true,force:true});}
});
