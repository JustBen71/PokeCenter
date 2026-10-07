import {randomInt} from 'node:crypto';
import {isLegendary,legendarySpecies,levelMoves,type BattlePokemonSpec,type BoardSlot,type PokemonData} from '@pokerace/shared';

/** Default moves of a species at a level (the last four learnt by level-up in Emerald). */
export type MovesProvider=(speciesId:number,level:number)=>Promise<number[]>;
const learnsets=new Map<number,Promise<PokemonData|null>>();
// ponytail: PokéAPI down = only Charge (33) for that Pokémon; an offline learnset table if it ever matters.
export const pokeApiMoves:MovesProvider=async(speciesId,level)=>{
 if(!learnsets.has(speciesId))learnsets.set(speciesId,fetch(`https://pokeapi.co/api/v2/pokemon/${speciesId}/`,{signal:AbortSignal.timeout(15000)})
  .then(r=>r.ok?r.json() as Promise<PokemonData>:null).catch(()=>null).then(d=>{if(!d)learnsets.delete(speciesId);return d;}));
 const data=await learnsets.get(speciesId);
 return data?[...new Set(levelMoves(data,level).map(m=>m.id))].slice(-4):[];
};

const ordinary=Array.from({length:386},(_,i)=>i+1).filter(id=>!isLegendary(id));
/** Final party of a board team: chosen Pokémon as given, draws inside their level range and legendary rule. */
export async function drawParty(slots:readonly BoardSlot[],moves:MovesProvider,random:(n:number)=>number=randomInt):Promise<BattlePokemonSpec[]>{
 return Promise.all(slots.map(async slot=>{
  const pool=slot.mode==='RANDOM'?(slot.legendary==='ONLY'?legendarySpecies:slot.legendary==='ALLOWED'?[...ordinary,...legendarySpecies]:ordinary):null;
  const speciesId=slot.mode==='FIXED'?slot.speciesId:pool![random(pool!.length)]!;
  const level=slot.mode==='FIXED'?slot.level:slot.minLevel+random(slot.maxLevel-slot.minLevel+1);
  const chosen=slot.mode==='FIXED'&&slot.moves.length?slot.moves:await moves(speciesId,level);
  return {speciesId,level,moves:chosen.length?chosen:[33],heldItem:slot.mode==='FIXED'?slot.heldItem:0,
   nature:slot.mode==='FIXED'&&slot.nature!==undefined?slot.nature:random(25),ev:slot.mode==='FIXED'?slot.ev:0};
 }));
}

/** Slots of a wheel team: `count` draws around the beneficiary's average level (± spread). */
export function wheelSlots(average:number,p:{count:number;spread:number;legendary:'NO'|'ALLOWED'|'ONLY'}):BoardSlot[]{
 const minLevel=Math.max(1,Math.round(average)-p.spread),maxLevel=Math.min(100,Math.round(average)+p.spread);
 return Array.from({length:p.count},()=>({mode:'RANDOM' as const,minLevel,maxLevel,legendary:p.legendary}));
}
