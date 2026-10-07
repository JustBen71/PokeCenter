import test from 'node:test';
import assert from 'node:assert/strict';
import {boardReward,boardSlotSchema,isLegendary} from '@pokerace/shared';
import {drawParty,wheelSlots} from '../src/battles/board-draw.js';
import {validateBattleSpec} from '../src/battles/battle-validator.js';

test('board reward: 40 ₽ per level, +10 % per extra Pokémon, +2 000 ₽ per legendary, rounded to 100 ₽',()=>{
 assert.equal(boardReward([{speciesId:25,level:10}]),400);
 assert.equal(boardReward([{speciesId:25,level:10},{speciesId:1,level:12}]),1000);// 880 × 1.1 = 968
 const six=Array.from({length:6},(_,i)=>({speciesId:i?16:150,level:30}));
 assert.equal(boardReward(six),12800);// 7 200 × 1.5 + 2 000
 assert.equal(boardReward(Array.from({length:6},()=>({speciesId:384,level:100}))),48000);
});

test('board draw: chosen Pokémon kept, draws inside their range and legendary rule, moves defaulted, valid for the game',async()=>{
 let n=0;const random=(max:number)=>(n++*7)%max;
 const asked:[number,number][]=[];
 const moves=async(speciesId:number,level:number)=>{asked.push([speciesId,level]);return speciesId===1?[]:[33,45];};
 const slots=[
  boardSlotSchema.parse({mode:'FIXED',speciesId:6,level:40,moves:[53],nature:3}),
  boardSlotSchema.parse({mode:'FIXED',speciesId:1,level:5}),
  ...Array.from({length:4},(_,i)=>boardSlotSchema.parse({mode:'RANDOM',minLevel:20,maxLevel:25,legendary:i===0?'ONLY':'NO'}))
 ];
 const party=await drawParty(slots,moves,random);
 assert.deepEqual(party[0],{speciesId:6,level:40,moves:[53],heldItem:0,nature:3,ev:0});
 assert.deepEqual(party[1]!.moves,[33],'no learnset: Charge');
 assert.ok(isLegendary(party[2]!.speciesId));
 for(const p of party.slice(2)){assert.ok(p.level>=20&&p.level<=25);assert.deepEqual(p.moves,[33,45]);}
 for(const p of party.slice(3))assert.ok(!isLegendary(p.speciesId));
 assert.ok(!asked.some(([s])=>s===6),'chosen moves are not replaced');
 validateBattleSpec({encounterId:'5d7f2e0a-0d7e-4b8b-9a55-111111111111',trainer:{name:'RIVAL',spriteId:'lass'},party});
 assert.throws(()=>boardSlotSchema.parse({mode:'RANDOM',minLevel:30,maxLevel:20}));
});

test('wheel team: around the beneficiary average, inside 1–100',()=>{
 assert.deepEqual(wheelSlots(12.4,{count:2,spread:3,legendary:'NO'}),[{mode:'RANDOM',minLevel:9,maxLevel:15,legendary:'NO'},{mode:'RANDOM',minLevel:9,maxLevel:15,legendary:'NO'}]);
 assert.deepEqual(wheelSlots(99,{count:1,spread:5,legendary:'ALLOWED'})[0],{mode:'RANDOM',minLevel:94,maxLevel:100,legendary:'ALLOWED'});
});
