import {useState} from 'react';
import {trainerSprites} from '@pokerace/shared';
import species from '../species-fr.json';

export const trainerLabels:Record<string,string>={brendan:'Brice',may:'Flora',red:'Red',leaf:'Leaf',steven:'Pierre',youngster:'Gamin',lass:'Fillette',hiker:'Montagnard',beauty:'Canon'};
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

// Reuses the local trainer and Pokémon sprites; the server validates the chosen identifier again.
export function AvatarPicker({value,onChange}:{value:string;onChange:(sprite:string)=>void}){
 const [kind,setKind]=useState<'trainer'|'pokemon'>(value.startsWith('pokemon-')?'pokemon':'trainer'),[search,setSearch]=useState('');
 const pokemon=Object.entries(species as Record<string,string>).filter(([id,name])=>fold(`${id} ${name}`).includes(fold(search)));
 return <div className="avatar-picker">
  <div className="avatar-tabs" role="tablist">
   <button type="button" role="tab" aria-selected={kind==='trainer'} onClick={()=>setKind('trainer')}>Dresseurs</button>
   <button type="button" role="tab" aria-selected={kind==='pokemon'} onClick={()=>setKind('pokemon')}>Pokémon</button>
  </div>
  {kind==='pokemon'&&<input aria-label="Rechercher un avatar Pokémon" placeholder="Poussifeu, Pikachu, numéro…" value={search} onChange={e=>setSearch(e.target.value)}/>}
  <div className="trainer-picker avatar-scroll" role="radiogroup" aria-label="Avatar">
   {kind==='trainer'
    ?trainerSprites.map(id=><label key={id} className={value===id?'selected':''}><input type="radio" name="sprite" checked={value===id} onChange={()=>onChange(id)}/><img src={`/trainers/${id}.svg`} alt=""/><span>{trainerLabels[id]}</span></label>)
    :pokemon.map(([id,name])=><label key={id} className={value===`pokemon-${id}`?'selected':''}><input type="radio" name="sprite" checked={value===`pokemon-${id}`} onChange={()=>onChange(`pokemon-${id}`)}/><img loading="lazy" src={`/sprites/${id}.png`} alt=""/><span>{name}</span></label>)}
  </div>
 </div>;
}
