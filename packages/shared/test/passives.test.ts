import test from 'node:test';
import assert from 'node:assert/strict';
import {passiveCatalog,passiveCapabilitySchema,passiveRarities,defaultRarityWeights,passiveSettingsSchema} from '../src/index.js';

test('passive catalogue: unique ids and handlers, valid rarities and capabilities, four rarities used',()=>{
 assert.equal(new Set(passiveCatalog.map(p=>p.id)).size,passiveCatalog.length,'unique ids');
 assert.equal(new Set(passiveCatalog.map(p=>p.handler)).size,passiveCatalog.length,'one distinct mechanic per entry');
 for(const p of passiveCatalog){
  assert.ok(passiveRarities.includes(p.rarity),p.id);
  assert.match(p.handler,/^[A-Z_]+$/,p.id);
  for(const c of p.requires)assert.ok(passiveCapabilitySchema.safeParse(c).success,`${p.id}: ${c}`);
 }
 assert.deepEqual([...new Set(passiveCatalog.map(p=>p.rarity))].sort(),[...passiveRarities].sort());
 // Explicitly removed entries are not reintroduced.
 for(const name of ['Sac de survie','Archiviste','Sniper'])assert.ok(!passiveCatalog.some(p=>p.name===name),name);
 assert.deepEqual(defaultRarityWeights,{COMMON:55,UNCOMMON:30,RARE:12,LEGENDARY:3});
});

test('passive settings: weights bounded, at least one positive, something to change',()=>{
 assert.ok(passiveSettingsSchema.safeParse({weights:{COMMON:1,UNCOMMON:0,RARE:0,LEGENDARY:0}}).success);
 assert.ok(!passiveSettingsSchema.safeParse({weights:{COMMON:0,UNCOMMON:0,RARE:0,LEGENDARY:0}}).success);
 assert.ok(!passiveSettingsSchema.safeParse({weights:{COMMON:-1,UNCOMMON:0,RARE:0,LEGENDARY:1}}).success);
 assert.ok(!passiveSettingsSchema.safeParse({}).success);
});
