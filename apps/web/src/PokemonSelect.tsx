import {useId,useState} from 'react';
import names from './species-fr.json';
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function searchSpecies(query:string) {
 return Object.entries(names).filter(([id,name])=>normalize(`${id} ${name}`).includes(normalize(query.trim())));
}
export function PokemonSelect({value,onChange}:{value:number;onChange:(id:number)=>void}) {
 const id=useId(),[open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0);
 const results=searchSpecies(query);
 const choose=(index:number)=>{if(results[index]){onChange(Number(results[index][0]));setOpen(false);setQuery('');}};
 return <div className="pokemon-select"><label htmlFor={id}>Pokémon</label><input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open&&results[active]?`${id}-${results[active][0]}`:undefined}
 value={open?query:`${value} — ${names[String(value) as keyof typeof names]}`} placeholder="Rechercher par nom ou numéro…"
 onFocus={()=>{setOpen(true);setQuery('');setActive(0);}} onBlur={()=>setOpen(false)} onChange={e=>{setOpen(true);setQuery(e.target.value);setActive(0);}}
 onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(i=>Math.min(i+1,results.length-1));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1));}else if(e.key==='Enter'&&open){e.preventDefault();choose(active);}else if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);}}}/>
 {open&&<ul id={`${id}-list`} role="listbox" aria-label="Pokémon disponibles">{results.map(([key,name],index)=><li key={key} id={`${id}-${key}`} role="option" aria-selected={index===active} ref={element=>{if(element&&index===active)element.scrollIntoView({block:'nearest'});}} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(index)}>{key} — {name}</li>)}{!results.length&&<li role="presentation">Aucun Pokémon trouvé</li>}</ul>}</div>;
}
