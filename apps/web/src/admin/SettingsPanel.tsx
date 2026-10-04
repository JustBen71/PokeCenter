import {useEffect,useState} from 'react';
import type {LobbySettings} from '@pokerace/shared';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';

const fields:{key:keyof LobbySettings;label:string;help:string;unit?:string}[]=[
 {key:'bankDepositTaxPercent',label:'Taxe sur les dépôts en banque',help:'Part de chaque dépôt versée au jackpot.'},
 {key:'shopJackpotPercent',label:'Contribution boutique → jackpot',help:'Part de chaque achat de ticket versée au jackpot.'},
 {key:'auctionJackpotPercent',label:'Contribution enchères → jackpot',help:'Part du prix d’une enchère versée au jackpot.'},
 {key:'wheelJackpotPercent',label:'Contribution roues → jackpot',help:'Part des montants des gages versée au jackpot.'},
 {key:'protectionPrice',label:'Prix d’une protection',help:'En Pokédollars : annule la prochaine roue hostile reçue.',unit:'₽'}
];

// Financial rules of the lobby, read by every money feature instead of hard-coded percentages.
export function SettingsPanel(){
 const {lobby}=useLobby();const toast=useToast();
 const settings=useLiveTopic<LobbySettings|null>('settings',null);
 const [draft,setDraft]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false);
 useEffect(()=>{if(settings)setDraft(Object.fromEntries(Object.entries(settings).map(([k,v])=>[k,String(v)])));},[settings]);
 const changed=!!settings&&fields.some(f=>draft[f.key]!==String(settings[f.key]));
 const save=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);
  try{await api(`/api/lobbies/${lobby.id}/settings`,{method:'PATCH',body:Object.fromEntries(fields.map(f=>[f.key,Number(draft[f.key])]))});toast.success('Paramètres enregistrés');}
  catch(err){toast.error(err);}finally{setBusy(false);}
 };
 return <form className="panel" onSubmit={save}>
  <header className="panel-head"><h2>Paramètres financiers</h2></header>
  {fields.map(f=><label key={f.key} className="setting-row"><span>{f.label}<small>{f.help}</small></span>
   <span className="percent"><input className="field" inputMode="numeric" value={draft[f.key]??''} onChange={e=>setDraft(d=>({...d,[f.key]:e.target.value.replace(/\D/g,'').slice(0,f.unit?6:3)}))}/>{f.unit??'%'}</span></label>)}
  <button className="btn primary" disabled={busy||!changed}>Enregistrer</button>
 </form>;
}
