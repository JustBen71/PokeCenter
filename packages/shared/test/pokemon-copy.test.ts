import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodePokemonCopy,rawPokemonSchema,encodePokemon,type PokemonInjection} from '../src/index.js';

test('all 24 encrypted layouts retain identity, PP, IV/EV and party stats',()=>{
 const orders=['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'];
 for(let pid=0;pid<24;pid++) {
  const b=Buffer.alloc(100);b.writeUInt32LE(pid,0);b.writeUInt32LE(12345,4);b.fill(255,8,18);b[8]=0xbb;b.fill(255,20,27);b[20]=0xbc;
  const blocks={G:[280,135,70<<8],A:[10|(45<<16),0,17|(32<<8)],E:[1|(2<<8)|(3<<16)|(4<<24),5|(6<<8),0],M:[0,31|(4<<5)|(7<<10)|(9<<15)|(10<<20)|(11<<25),0]};
  let sum=0;for(let i=0;i<4;i++)for(let j=0;j<3;j++){const w=blocks[orders[pid][i] as keyof typeof blocks][j];sum=(sum+(w&65535)+(w>>>16))&65535;b.writeUInt32LE((w^pid^12345)>>>0,32+i*12+j*4);}
  b.writeUInt16LE(sum,28);b[84]=5;b.writeUInt16LE(12,86);[20,11,9,9,12,10].forEach((v,i)=>b.writeUInt16LE(v,88+i*2));
  const raw=b.toString('hex'),mon=decodePokemonCopy(raw);
  assert.equal(mon.personality,pid);assert.equal(mon.internalSpecies,280);assert.equal(mon.experience,135);assert.equal(mon.nickname,'A');assert.equal(mon.otName,'B');
  assert.deepEqual(mon.moves.slice(0,2),[{id:10,pp:17},{id:45,pp:32}]);assert.equal(mon.ivs.hp,31);assert.equal(mon.evs.spDefense,6);assert.equal(mon.currentHp,12);assert.equal(mon.stats.spAttack,12);
  assert.equal(rawPokemonSchema.safeParse(raw).success,true);b[32]^=1;assert.equal(rawPokemonSchema.safeParse(b.toString('hex')).success,false);
 }
});


test('generated copies preserve all 386 species, nature, shiny flag, stats and IV/EV',()=>{
 for(let speciesId=1;speciesId<=386;speciesId++){
  const form:PokemonInjection={playerId:'test',slot:1,speciesId,nickname:'TEST',level:10,experience:1000,currentHp:25,stats:{maxHp:30,attack:21,defense:22,speed:23,spAttack:24,spDefense:25},moves:[{id:33,pp:35},{id:45,pp:40},{id:0,pp:0},{id:0,pp:0}],heldItem:0,abilitySlot:1,nature:speciesId%25,friendship:70,otName:'BEN',trainerId:12345,secretId:54321,ivs:{hp:31,attack:20,defense:10,speed:9,spAttack:8,spDefense:7},evs:{hp:5,attack:6,defense:7,speed:8,spAttack:9,spDefense:10},shiny:speciesId%17===0};
  const raw=encodePokemon(form),decoded=decodePokemonCopy(raw);assert.equal(rawPokemonSchema.safeParse(raw).success,true);assert.equal(decoded.nature,form.nature);assert.equal(decoded.shiny,form.shiny);assert.equal(decoded.abilitySlot,1);assert.deepEqual(decoded.moves,form.moves);assert.deepEqual(decoded.stats,form.stats);assert.deepEqual(decoded.ivs,form.ivs);assert.deepEqual(decoded.evs,form.evs);
 }
});
