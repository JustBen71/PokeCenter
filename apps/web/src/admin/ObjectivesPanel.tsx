import {useState} from 'react';
import type {Objective,ObjectivesSnapshot} from '@pokerace/shared';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';

// Lobby objectives: order, reward in Pokédollars and activation. Changes are pushed live to every page.
export function ObjectivesPanel(){
 const {lobby}=useLobby();const toast=useToast();
 const {objectives,completions}=useLiveTopic<ObjectivesSnapshot>('objectives',{objectives:[],completions:[]});
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[busy,setBusy]=useState('');
 const save=async(o:Objective,patch:Partial<Objective>)=>{
  setBusy(o.id);
  try{await api(`/api/lobbies/${lobby.id}/objectives/${o.id}`,{method:'PATCH',body:patch});toast.success(`Objectif « ${o.name} » mis à jour`);setDrafts(d=>{const {[o.id]:_,...rest}=d;return rest;});}
  catch(e){toast.error(e);}finally{setBusy('');}
 };
 const move=(o:Objective,direction:-1|1)=>{
  const i=objectives.indexOf(o),other=objectives[i+direction];if(!other)return;
  void save(o,{order:other.order+direction});
 };
 return <section className="panel objectives-admin">
  <header className="panel-head"><h2>Objectifs et récompenses</h2><small className="muted">{completions.length} objectif(s) atteint(s)</small></header>
  <p className="muted">Une récompense est versée une seule fois par joueur, dans son jeu, quand une Run est en cours.</p>
  <ol className="objective-admin-list">{objectives.map((o,i)=>{const draft=drafts[o.id]??String(o.rewardMoney);const reached=completions.filter(c=>c.objectiveId===o.id).length;
   return <li key={o.id} className={o.enabled?'':'disabled'}>
    <div className="order-buttons"><button className="icon-button" aria-label="Monter" disabled={!!busy||i===0} onClick={()=>move(o,-1)}>↑</button><button className="icon-button" aria-label="Descendre" disabled={!!busy||i===objectives.length-1} onClick={()=>move(o,1)}>↓</button></div>
    <div className="objective-name"><strong>{o.name}</strong><small>{reached} joueur(s)</small></div>
    <label className="reward-field">₽<input inputMode="numeric" aria-label={`Récompense de ${o.name}`} value={draft} onChange={e=>setDrafts(d=>({...d,[o.id]:e.target.value.replace(/\D/g,'')}))}/></label>
    <button className="btn" disabled={busy===o.id||draft===String(o.rewardMoney)||draft===''} onClick={()=>void save(o,{rewardMoney:Number(draft)})}>OK</button>
    <label className="toggle"><input type="checkbox" checked={o.enabled} disabled={busy===o.id} onChange={e=>void save(o,{enabled:e.target.checked})}/>Actif</label>
   </li>;})}</ol>
 </section>;
}
