import test from 'node:test';
import assert from 'node:assert/strict';
import type {OwnedPassive} from '@pokerace/shared';
import {emptyPassives,isConsumed,ownedBy,progressLines} from '../src/passives/passives-data.ts';
import {routeFromHash} from '../src/app/routes.ts';

const owned=(passiveId:string,progress:Record<string,unknown>={},accountId='ben'):OwnedPassive=>({id:passiveId+accountId,accountId,passiveId,source:'INITIAL_CHOICE',acquiredAt:'2026-10-06T10:00:00Z',progress,metadata:{}});

test('passive progression is worded from the server counters',()=>{
 assert.deepEqual(progressLines(owned('cartographer',{places:['A','B','C','D','E','F','G']})),['7 lieu(x) découvert(s)','Prochain ticket : 2 / 5']);
 assert.deepEqual(progressLines(owned('collector',{species:[1,2,3]})),['3 espèce(s) différente(s)','Prochain ticket : 3 / 10']);
 assert.deepEqual(progressLines(owned('second-wind',{uses:2})),['Activations : 2 / 3']);
 assert.deepEqual(progressLines(owned('bargain-hunter',{losses:1})),['Enchères perdues : 1 / 3']);
 assert.deepEqual(progressLines(owned('bargain-hunter',{losses:0,armed:true})),['Révélation prête pour la prochaine enchère']);
 assert.deepEqual(progressLines(owned('counterspell')),['Aucune roue hostile subie']);
 assert.deepEqual(progressLines(owned('counterspell',{lastBadGage:{id:'g',name:'Amende'}})),['Dernier gage hostile : « Amende » (exclu du prochain tirage)']);
 assert.deepEqual(progressLines(owned('sixth-man',{badges:['badge1','badge2'],rewarded:['badge2']})),['Badges récompensés : 1']);
 assert.deepEqual(progressLines(owned('rivalry')),[]);
 assert.equal(isConsumed(owned('usurper',{consumed:true})),true);
});

test('passives are grouped by player and the page is public',()=>{
 const snapshot={...emptyPassives,owned:[owned('scout'),owned('rivalry',{},'tim'),owned('collector')]};
 assert.deepEqual(ownedBy(snapshot,'ben').map(p=>p.passiveId),['scout','collector']);
 assert.equal(routeFromHash('#/passifs',false),'passives');
});
