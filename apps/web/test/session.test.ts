import test from 'node:test';
import assert from 'node:assert/strict';
import {readSession,writeSession} from '../src/auth/storage.ts';
import {toRequestError} from '../src/api/client.ts';

const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>void m.set(k,v),removeItem:(k:string)=>void m.delete(k),m};};

test('a reload restores the tab session, a new tab restores the remembered one, logout forgets it',()=>{
 const local=memory(),tab=memory();
 assert.deepEqual(readSession(tab,local),{accountId:null,lobbyId:null});
 writeSession(tab,local,{accountId:'p-ben',lobbyId:'lobby-1'});
 assert.deepEqual(readSession(tab,local),{accountId:'p-ben',lobbyId:'lobby-1'});
 // A new tab has an empty sessionStorage but shares localStorage.
 assert.deepEqual(readSession(memory(),local),{accountId:'p-ben',lobbyId:'lobby-1'});
 // A second tab can use another account without changing the first one.
 const other=memory();writeSession(other,local,{accountId:'p-tim',lobbyId:null});
 assert.equal(readSession(tab,local).accountId,'p-ben');assert.equal(readSession(other,local).accountId,'p-tim');
 // "Changer de compte" clears the tab and the remembered session but keeps the last account preselected.
 writeSession(tab,local,{accountId:null,lobbyId:null});
 assert.deepEqual(readSession(tab,local),{accountId:null,lobbyId:null});
 assert.equal(local.m.get('pokerace-last-account'),'p-tim');
});

test('corrupted or blocked storage never breaks the login page',()=>{
 const local=memory();local.setItem('pokerace-session','{oops');
 assert.deepEqual(readSession(memory(),local),{accountId:null,lobbyId:null});
 const blocked={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');},removeItem:()=>{throw new Error('denied');}};
 assert.deepEqual(readSession(blocked,blocked),{accountId:null,lobbyId:null});
 assert.doesNotThrow(()=>writeSession(blocked,blocked,{accountId:'p',lobbyId:null}));
});

test('server errors keep their stable code and readable message',()=>{
 const stable=toRequestError(409,{ok:false,error:{code:'INVALID_INVITE_CODE',message:'Aucun lobby ne correspond à ce code'}});
 assert.equal(stable.code,'INVALID_INVITE_CODE');assert.equal(stable.message,'Aucun lobby ne correspond à ce code');
 assert.equal(toRequestError(403,{ok:false,error:{code:'ADMIN_REQUIRED',message:''}}).message,'Action réservée aux administrateurs.');
 const legacy=toRequestError(409,{error:'player offline'});
 assert.equal(legacy.code,'HTTP');assert.equal(legacy.message,'player offline');
 assert.equal(toRequestError(500,null).message,'La requête a échoué (500)');
});
