import {useEffect,useState} from 'react';

// French move names come from PokéAPI and are cached for the session; ids are shown while loading or offline.
const moveNames=new Map<number,Promise<string>>();
export function useMoveNames(ids:string) {
 const [names,setNames]=useState<Record<number,string>>({});
 useEffect(()=>{
  let active=true;setNames({});
  for(const id of ids.split(',').map(Number).filter(Boolean)) {
   if(!moveNames.has(id))moveNames.set(id,fetch(`https://pokeapi.co/api/v2/move/${id}/`,{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(m=>m.names.find((v:{language:{name:string}})=>v.language.name==='fr')?.name??m.name).catch(e=>{moveNames.delete(id);throw e;}));
   moveNames.get(id)!.then(name=>{if(active)setNames(n=>({...n,[id]:name}));}).catch(()=>{});
  }
  return()=>{active=false;};
 },[ids]);
 return names;
}
