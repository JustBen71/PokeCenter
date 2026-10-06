import test from 'node:test';
import assert from 'node:assert/strict';
import type {BattleEncounter} from '@pokerace/shared';
import {activeBattle,battlesOf,statusClass} from '../src/battles/battles-data.ts';

const e=(id:string,accountId:string,status:BattleEncounter['status'])=>({id,accountId,status} as BattleEncounter);

test('the player card shows only the queued, running or uncertain battle; the drawer keeps the whole history',()=>{
 const snapshot={encounters:[e('a','ben','WON'),e('b','ben','WAITING_SAFE_STATE'),e('c','tim','LOST')]};
 assert.equal(activeBattle(snapshot,'ben')?.id,'b');assert.equal(activeBattle(snapshot,'tim'),undefined);
 assert.deepEqual(battlesOf(snapshot,'ben').map(x=>x.id),['a','b']);
 assert.equal(statusClass(e('x','ben','LOST')),'status-failed');assert.equal(statusClass(e('x','ben','WON')),'status-confirmed');
});
