import {randomInt} from 'node:crypto';
import {buildPokemon,pokemonInjectionSchema,type PublicPlayer,type PokemonInjection} from '@pokerace/shared';
export async function generateLot(players:PublicPlayer[],random=(max:number)=>randomInt(max),build=buildPokemon,options:{speciesId?:number;level?:number}={}){
 const active=players.filter(p=>p.connected&&p.state.game.romStatus==='recognized');
 if(!active.length||active.some(p=>Date.now()-Date.parse(p.lastSeenAt)>15000||p.state.trainer?.partyCount!==p.state.party.length))throw Error('Attendez les équipes complètes des joueurs connectés.');
 const team=active.flatMap(p=>p.state.party);if(!team.length)throw Error('Aucun Pokémon dans les équipes connectées.');
 const level=options.level??Math.max(1,Math.min(100,Math.round(team.reduce((n,p)=>n+p.level,0)/team.length)));
 const keys=['hp','attack','defense','speed','spAttack','spDefense'] as const;
 const ivs=Object.fromEntries(keys.map(k=>[k,random(32)])) as PokemonInjection['ivs'];
 const evs=Object.fromEntries(keys.map(k=>[k,0])) as PokemonInjection['evs'];
 const total=random(511);for(let i=0;i<total;i++){const available=keys.filter(k=>evs[k]<255);evs[available[random(available.length)]]++;}
 const form:PokemonInjection={playerId:'auction',slot:1,speciesId:options.speciesId??(1+random(386)),nickname:'ENCHERE',level,experience:0,currentHp:1,stats:{maxHp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1},moves:Array.from({length:4},()=>({id:0,pp:0})),heldItem:0,abilitySlot:0,nature:random(25),friendship:70,otName:'ENCHERE',trainerId:random(65536),secretId:random(65536),ivs,evs,shiny:random(8192)===0};
 const built=await build(form);
 const nickname=built.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 -]/g,'').slice(0,10)||'ENCHERE';
 const template=pokemonInjectionSchema.parse({...form,nickname,stats:built.stats,currentHp:built.stats.maxHp,experience:built.experience,moves:built.moves});
 return {template,name:built.name,level,speciesId:form.speciesId,sampleSize:team.length,participants:active.map(p=>p.playerId)};
}
