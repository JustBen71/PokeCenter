import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchSpecies} from '../src/PokemonSelect.tsx';
test('species search matches French names, accents, case and national numbers',()=>{
 assert.deepEqual(searchSpecies('poussifeu'),[['255','Poussifeu']]);
 assert.ok(searchSpecies('eoko').some(([id])=>id==='358'));
 assert.ok(searchSpecies('PIKA').some(([id])=>id==='25'));
 assert.deepEqual(searchSpecies('386'),[['386','Deoxys']]);
 assert.equal(searchSpecies('introuvable').length,0);
 assert.equal(searchSpecies('').length,386);
});
