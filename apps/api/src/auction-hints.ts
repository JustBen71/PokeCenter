import {randomInt} from 'node:crypto';
import type {PokemonInjection} from '@pokerace/shared';
export function auctionHints(p:PokemonInjection,percent:number,random=(max:number)=>randomInt(max)){
 const interval=(value:number,max:number,min=0)=>{
  if(percent===0)return {min:value,max:value};
  const margin=Math.max(1,Math.ceil(Math.max(value,1)*percent/100));
  // Independent margins avoid placing the hidden value at the exact midpoint.
  return {min:Math.max(min,value-1-random(margin)),max:Math.min(max,value+1+random(margin))};
 };
 const group=(values:Record<string,number>,max:number,min=0)=>Object.fromEntries(Object.entries(values).map(([key,v])=>[key,interval(v,max,min)]));
 return {ivs:group(p.ivs,31),evs:group(p.evs,255),stats:group(p.stats,999,1)};
}
