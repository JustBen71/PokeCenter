import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateStats,emeraldPP,levelMoves,buildPokemon,type PokemonData} from '../src/pokemon-builder.ts';
const r=(name:string,id:number)=>({name,url:`https://pokeapi.co/api/v2/resource/${id}/`});
const keys=['hp','attack','defense','speed','special-attack','special-defense'];
const data:PokemonData={stats:[35,55,40,90,50,50].map((base_stat,i)=>({base_stat,stat:r(keys[i],i+1)})),past_stats:[{generation:r('generation-v',5),stats:[{base_stat:30,stat:r('defense',3)},{base_stat:40,stat:r('special-defense',5)}]}],moves:[]};
const zero={hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0};
test('Pikachu uses generation III defenses and integer nature rounding',()=>{
 const form={speciesId:25,level:50,nature:0,ivs:zero,evs:zero};
 assert.deepEqual(calculateStats(data,form),{maxHp:95,attack:60,defense:35,speed:95,spAttack:55,spDefense:45});
 assert.equal(calculateStats(data,{...form,nature:1}).attack,66);
 assert.equal(calculateStats(data,{...form,nature:1}).defense,31);
 assert.equal(calculateStats(data,{...form,ivs:{...zero,hp:31},evs:{...zero,hp:255}}).maxHp,142);
 assert.equal(calculateStats(data,{...form,speciesId:292}).maxHp,1);
});
test('PP changes use the first change after Emerald, ignoring null fields',()=>{
 assert.equal(emeraldPP({id:22,name:'vine-whip',names:[],pp:25,past_values:[{pp:15,version_group:r('x-y',15)},{pp:null,version_group:r('emerald',6)},{pp:10,version_group:r('diamond-pearl',8)}]}),10);
});
test('only Emerald level-up moves are available, sorted by learning order',()=>{
 const move=(id:number,level:number,version='emerald',method='level-up',order=0)=>({move:r('move',id),version_group_details:[{version_group:r(version,6),move_learn_method:r(method,1),level_learned_at:level,order}]});
 const fixture={...data,moves:[move(10,5,'emerald','level-up',2),move(45,5,'emerald','level-up',1),move(52,10),move(99,1,'ruby-sapphire'),move(100,0,'emerald','machine'),move(400,1)]};
 assert.deepEqual(levelMoves(fixture,5).map(m=>m.id),[45,10]);
});
test('builder uses growth table, four latest moves, localized names and cached requests',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async(input)=>{
   calls++;const path=String(input);
   const value=path.includes('/pokemon-species/')?{name:'test',names:[{name:'Essai',language:r('fr',5)}],growth_rate:r('medium',2)}
    :path.includes('/growth-rate/')?{levels:[{level:50,experience:125000}]}
    :path.includes('/move/')?{id:Number(path.split('/').at(-2)),name:'move',names:[],pp:20,past_values:[]}
    :{...data,moves:[1,2,3,4,5].map(id=>({move:r('move',id),version_group_details:[{version_group:r('emerald',6),move_learn_method:r('level-up',1),level_learned_at:id,order:0}]}))};
   return {ok:true,json:async()=>value} as Response;
 }) as typeof fetch;
 try {
   const form={speciesId:25,level:50,nature:0,ivs:zero,evs:zero} as Parameters<typeof buildPokemon>[0];
   const result=await buildPokemon(form);
   assert.equal(result.experience,125000);assert.equal(result.name,'Essai');
   assert.deepEqual(result.moves.map(m=>m.id),[2,3,4,5]);
   const count=calls;await buildPokemon({...form,nature:1});assert.equal(calls,count);
   await assert.rejects(buildPokemon({...form,level:101}));
   await assert.rejects(buildPokemon({...form,evs:{...zero,hp:255,attack:255,defense:1}}));
 } finally {globalThis.fetch=original;}
});
