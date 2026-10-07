import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePokemonCopy,magikarpFrom,nationalSpecies,withLevel} from '@pokerace/shared';
import {rawPokemon} from './support/fake-game-client.js';

test('level change keeps the exact Pokémon (personality, nickname, moves, IVs) and only changes experience, level, stats, HP ratio',()=>{
 const raw=rawPokemon(255,10,'POUSSIFEU'),before=decodePokemonCopy(raw);
 const stats={maxHp:40,attack:21,defense:15,speed:18,spAttack:24,spDefense:17};
 const after=decodePokemonCopy(withLevel(raw,{level:12,experience:1728,stats}));
 assert.equal(after.level,12);assert.equal(after.experience,1728);assert.deepEqual(after.stats,stats);
 assert.equal(after.personality,before.personality);assert.equal(after.nickname,before.nickname);assert.deepEqual(after.moves,before.moves);
 assert.deepEqual(after.ivs,before.ivs);assert.equal(after.currentHp,Math.round(before.currentHp*40/before.stats.maxHp));
});

test('Magikarp curse: level 1 Magikarp, only Trempette, same trainer so it obeys',()=>{
 const raw=rawPokemon(6,50,'DRACO'),before=decodePokemonCopy(raw),carp=decodePokemonCopy(magikarpFrom(raw));
 assert.equal(nationalSpecies.get(carp.internalSpecies),129);
 assert.equal(carp.level,1);assert.equal(carp.experience,0);assert.equal(carp.nickname,'MAGICARPE');
 assert.deepEqual(carp.moves.map(m=>m.id),[150,0,0,0]);
 assert.equal(carp.trainerId,before.trainerId);assert.equal(carp.secretId,before.secretId);assert.equal(carp.otName,before.otName);
 assert.equal(carp.currentHp,carp.stats.maxHp);
});
