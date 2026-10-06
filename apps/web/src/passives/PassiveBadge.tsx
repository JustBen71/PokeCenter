import {useState} from 'react';
import {passiveRarityLabels,type OwnedPassive,type PassiveDefinition} from '@pokerace/shared';
import {definition} from './passives-data';
import {PassiveDetail} from './PassiveDetail';

// Compact rarity-coloured badge; the label includes the rarity unless compact.
export function PassiveBadge({passive,compact=false,onClick}:{passive:PassiveDefinition;compact?:boolean;onClick?:()=>void}){
 const label=compact?passive.name:`${passiveRarityLabels[passive.rarity]} · ${passive.name}`;
 return <button type="button" className={`passive-badge ${passive.rarity.toLowerCase()}`} title={passive.description} onClick={onClick}>{label}</button>;
}

/** One line under a player's team: full labels up to three passives, then compact names and « +N ». */
export function PassiveBadgeRow({owned,ownerName,max=3}:{owned:OwnedPassive[];ownerName:string;max?:number}){
 const [open,setOpen]=useState<OwnedPassive|null>(null),[all,setAll]=useState(false);
 const known=owned.filter(o=>definition(o.passiveId));
 if(!known.length)return null;
 const compact=known.length>max,shown=compact&&!all?known.slice(0,max):known;
 return <div className="passive-row" aria-label={`Passifs de ${ownerName}`}>
  {shown.map(o=><PassiveBadge key={o.id} passive={definition(o.passiveId)!} compact={compact} onClick={()=>setOpen(o)}/>)}
  {compact&&!all&&<button type="button" className="passive-badge more" onClick={()=>setAll(true)} aria-label={`Voir les ${known.length-max} autres passifs`}>+{known.length-max}</button>}
  {open&&<PassiveDetail owned={open} ownerName={ownerName} onClose={()=>setOpen(null)}/>}
 </div>;
}
