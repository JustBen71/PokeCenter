import {useState} from 'react';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useToast} from '../components/toast-context';
import {PassiveCard} from './PassiveCard';
import {definition,usePassives} from './passives-data';

/** Priority overlay while the race waits for the player's choice among their three private cards. */
export function PassiveSelection(){
 const {lobby}=useLobby();const toast=useToast();const {phase,myOffer}=usePassives();
 const [busy,setBusy]=useState('');
 if(phase!=='SELECTION'||!myOffer?.length)return null;
 const choose=async(passiveId:string)=>{
  setBusy(passiveId);
  try{await api(`/api/lobbies/${lobby.id}/passives/choose`,{method:'POST',body:{passiveId}});toast.success(`Passif « ${definition(passiveId)?.name} » choisi`);}
  catch(e){toast.error(e);}finally{setBusy('');}
 };
 return <div className="passive-selection" role="dialog" aria-modal="true" aria-label="Choisis ton passif">
  <div>
   <p className="eyebrow">LA COURSE COMMENCE</p>
   <h2>Choisis ton passif</h2>
   <p className="muted">Il restera actif pendant toute la course, même si tu perds une Run. Ces cartes ne sont visibles que par toi.</p>
   <div className="passive-cards">{myOffer.map(id=>{const def=definition(id);if(!def)return null;
    return <PassiveCard key={id} passive={def}><button className="btn primary" disabled={!!busy} onClick={()=>void choose(id)}>{busy===id?'Choix…':'Choisir'}</button></PassiveCard>;})}</div>
  </div>
 </div>;
}
