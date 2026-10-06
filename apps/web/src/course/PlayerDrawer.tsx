import {useEffect,useState} from 'react';
import {avatarUrl,runStatusLabels,type Run} from '@pokerace/shared';
import {X} from 'lucide-react';
import {api} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useToast} from '../components/toast-context';
import {NativeClientStatus} from '../NativeClientStatus';
import {PokeDollar} from '../components/PokeDollar';
import {spriteUrl} from '../pokemon/PokemonSheet';
import {clientStateLabels,runActions,type CourseRow} from './course-model';
import {AdminMoneyForm} from './AdminMoneyForm';
import type {OwnedPassive} from '@pokerace/shared';
import {PassiveFacts} from '../passives/PassiveDetail';

const date=(iso:string|null)=>iso?new Date(iso).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'—';

// Side panel with everything about one participant; admins manage the Runs from here.
export function PlayerDrawer({row,passives,onClose,onPokemon}:{row:CourseRow;passives:OwnedPassive[];onClose:()=>void;onPokemon:(p:CourseRow['party'][number])=>void}){
 const {account}=useSession();const {lobby}=useLobby();const toast=useToast();const [busy,setBusy]=useState(false);
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[onClose]);
 const act=async(a:ReturnType<typeof runActions>[number])=>{
  if(a.danger&&!window.confirm(`${a.label} pour ${row.name} ?`))return;
  setBusy(true);
  try{
   const run=a.kind==='create'
    ?await api<Run>(`/api/lobbies/${lobby.id}/runs`,{method:'POST',body:{accountId:row.accountId,start:a.start}})
    :await api<Run>(`/api/lobbies/${lobby.id}/runs/${row.run!.id}/status`,{method:'POST',body:{status:a.status}});
   toast.success(`Run #${run.number} de ${row.name} : ${runStatusLabels[run.status]}`);
  }catch(e){toast.error(e);}finally{setBusy(false);}
 };
 return <div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Détails de ${row.name}`}>
   <header className="drawer-head"><img src={avatarUrl(row.sprite)} alt=""/><div><p className="eyebrow">{row.rank?`RANG #${row.rank}`:'NON CLASSÉ'}</p><h2>{row.name}</h2><small>{clientStateLabels[row.clientState]}</small></div><button className="icon-button" aria-label="Fermer" onClick={onClose}><X size={16}/></button></header>
   <section><h3>Partie</h3><dl className="facts">
    <div><dt>Position</dt><dd>{row.location??'Inconnue'}</dd></div>
    <div><dt>Pokédollars</dt><dd className="money-inline"><PokeDollar size={14}/>{row.money===null?'—':row.money.toLocaleString('fr-FR')}</dd></div>
    <div><dt>Dresseur en jeu</dt><dd>{row.view?.display.state.trainer?.name??'—'}</dd></div>
    <div><dt>Dernière donnée</dt><dd>{date(row.view?.display.receivedAt??null)}</dd></div>
   </dl></section>
   {row.party.length>0&&<section><h3>Équipe</h3><ul className="drawer-party">{row.party.map(p=><li key={p.slot}><button onClick={()=>onPokemon(p)}><img src={spriteUrl(p)} alt=""/><span>{p.nickname||p.speciesName}<small>Niv. {p.level} · {p.currentHp}/{p.maxHp} PV</small></span></button></li>)}</ul></section>}
   <section><h3>Passifs</h3>{passives.length===0?<p className="muted">Aucun passif.</p>:<div className="passive-facts-grid">{passives.map(p=><PassiveFacts key={p.id} owned={p}/>)}</div>}</section>
   <section><h3>Runs</h3>
    {row.runs.length===0?<p className="muted">Aucune Run pour l’instant.</p>:<ol className="run-history">{row.runs.map(r=><li key={r.id} className={r.status.toLowerCase()}><strong>Run #{r.number}</strong><span className={`badge run-${r.status.toLowerCase()}`}>{runStatusLabels[r.status]}</span><small>Début {date(r.startedAt)} · Fin {date(r.endedAt)}</small></li>)}</ol>}
    {account.admin&&<div className="run-actions">{runActions(row.run).map(a=><button key={a.label} className={a.danger?'danger':a.kind==='create'&&a.start||a.status==='RUNNING'?'primary':''} disabled={busy} onClick={()=>void act(a)}>{a.label}</button>)}</div>}
   </section>
   {account.admin&&<section><h3>Corriger les Pokédollars</h3><AdminMoneyForm row={row}/></section>}
   {row.view?.native&&<section><h3>Client Pokérace</h3><NativeClientStatus client={row.view.native} legacyActionsAvailable={row.view.legacyActionsAvailable}/></section>}
  </aside>
 </div>;
}
