import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {battleEncounterSpecSchema,battleTrainerNameSchema,battleTransitions,nationalSpecies} from '../src/index.js';

const mon={speciesId:19,level:3,moves:[33,39],nature:4};
const spec=(party:unknown[]=[mon],trainer:object={name:'BEN',spriteId:'youngster'})=>({encounterId:randomUUID(),trainer,party});
const ok=(v:unknown)=>battleEncounterSpecSchema.safeParse(v).success;

test('battle spec: party 1..6, levels 1..100, valid moves, sprite and name from the game table',()=>{
 assert.ok(ok(spec()));
 assert.ok(!ok(spec([])),'empty party');assert.ok(!ok(spec(Array(7).fill(mon))),'party > 6');
 assert.ok(!ok(spec([{...mon,level:0}])));assert.ok(!ok(spec([{...mon,level:101}])));
 assert.ok(!ok(spec([{...mon,moves:[355]}])),'unknown move');assert.ok(!ok(spec([{...mon,moves:[33,33]}])),'duplicate move');
 assert.ok(!ok(spec([{...mon,moves:[1,2,3,4,5]}])),'5 moves');
 assert.ok(!ok(spec([{...mon,speciesId:387}])),'not Gen III');
 assert.ok(!ok(spec([{...mon,heldItem:999}])),'invalid item');
 assert.ok(!ok(spec([{...mon,ev:256}])),'stat effort out of bounds');
 assert.ok(!ok(spec([{...mon,personality:5}])),'personality not matching the nature');
 assert.ok(ok(spec([{...mon,personality:29}])),'29 % 25 = 4');
 assert.ok(!ok(spec([mon],{name:'BEN',spriteId:'rival'})),'sprite outside the catalogue');
 assert.equal(battleTrainerNameSchema.parse(' Éloïse '.normalize('NFD')),'Éloïse');
 assert.ok(!battleTrainerNameSchema.safeParse('TROPLONGNOM').success,'> 7 characters');
 assert.ok(!battleTrainerNameSchema.safeParse('Bé😀').success,'outside the game table');
 assert.ok(!battleTrainerNameSchema.safeParse('   ').success);
});

test('battle lifecycle: terminal statuses never move, REVIEW only by reconciliation',()=>{
 for(const s of ['WON','LOST','CANCELLED','FAILED'] as const)assert.deepEqual(battleTransitions[s],[]);
 assert.ok(battleTransitions.REVIEW.includes('WON')&&!battleTransitions.REVIEW.includes('SENDING'),'never re-sent from REVIEW');
 assert.equal(nationalSpecies.get(288),263,'Zigzaton: internal 288 = national 263');
});
