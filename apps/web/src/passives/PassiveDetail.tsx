import {useEffect} from 'react';
import {passiveRarityLabels,passiveSourceLabels,type OwnedPassive} from '@pokerace/shared';
import {definition,isConsumed,progressLines} from './passives-data';

const date=(iso:string)=>new Date(iso).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});

// Everything about an owned passive: rarity, rules, how it was acquired, progression and state.
export function PassiveFacts({owned}:{owned:OwnedPassive}){
 const def=definition(owned.passiveId);if(!def)return null;
 const lines=progressLines(owned);
 return <div className={`passive-facts ${def.rarity.toLowerCase()}`}>
  <p className="passive-rarity">{passiveRarityLabels[def.rarity]} · {def.family}</p>
  <strong>{def.name}</strong>
  <p>{def.description}</p>
  <small>{passiveSourceLabels[owned.source]} · {date(owned.acquiredAt)} · {isConsumed(owned)?'Consommé':'Disponible'}</small>
  {lines.length>0&&<ul>{lines.map(l=><li key={l}>{l}</li>)}</ul>}
 </div>;
}

export function PassiveDetail({owned,ownerName,onClose}:{owned:OwnedPassive;ownerName:string;onClose:()=>void}){
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[onClose]);
 return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="dialog passive-dialog" role="dialog" aria-modal="true" aria-label={`Passif de ${ownerName}`}>
   <p className="eyebrow">PASSIF DE {ownerName.toUpperCase()}</p>
   <PassiveFacts owned={owned}/>
   <div className="dialog-actions"><button type="button" onClick={onClose}>Fermer</button></div>
  </div>
 </div>;
}
