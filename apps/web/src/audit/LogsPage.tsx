import {useEffect,useState} from 'react';
import {auditCategorySchema,moneyTypeLabels,type AuditLog,type MoneyTransaction} from '@pokerace/shared';
import {RefreshCw,X} from 'lucide-react';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {MoneyHistory} from '../bank/MoneyHistory';

type Details={log:AuditLog;command:{id:string;command:string;status:string;errorCode:string|null;createdAt:string;updatedAt:string}|null;transactions:MoneyTransaction[];related:AuditLog[]};
const statusClass:Record<AuditLog['status'],string>={SUCCESS:'status-confirmed',FAILED:'status-failed',REVIEW:'status-review',PENDING:'status-review',INFO:''};
const time=(iso:string)=>new Date(iso).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'medium'});

// Admin audit trail: who did what, when, with which outcome; one entry opens its transactions and game command.
export function LogsPage(){
 const {lobby}=useLobby();const {members}=useLive();const toast=useToast();
 const [filters,setFilters]=useState({accountId:'',category:'',outcome:'',commandId:'',from:'',to:''});
 const [rows,setRows]=useState<AuditLog[]|null>(null),[open,setOpen]=useState<Details|null>(null);
 const name=(id:string|null)=>id?members.find(m=>m.id===id)?.name??id.slice(0,8):'Système';
 const load=async()=>{
  const query=new URLSearchParams(Object.entries({...filters,from:filters.from?new Date(filters.from).toISOString():'',to:filters.to?new Date(filters.to).toISOString():''}).filter(([,v])=>v));
  try{setRows(await api<AuditLog[]>(`/api/lobbies/${lobby.id}/audit?${query}`));}catch(e){toast.error(e);setRows([]);}
 };
 useEffect(()=>{void load();},[lobby.id,filters.accountId,filters.category,filters.outcome]);
 const details=async(log:AuditLog)=>{try{setOpen(await api<Details>(`/api/lobbies/${lobby.id}/audit/${log.id}`));}catch(e){toast.error(e);}};
 const set=(key:keyof typeof filters)=>(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>setFilters(f=>({...f,[key]:e.target.value}));
 return <section className="logs-page">
  <header className="page-head"><div><p className="eyebrow">ADMIN</p><h1>Logs</h1><p className="muted">Toutes les actions importantes du lobby et des comptes. Aucun secret ni dump mémoire n’y est enregistré.</p></div></header>
  <form className="panel filters" onSubmit={e=>{e.preventDefault();void load();}}>
   <select className="field" aria-label="Joueur" value={filters.accountId} onChange={set('accountId')}><option value="">Tous les joueurs</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
   <select className="field" aria-label="Catégorie" value={filters.category} onChange={set('category')}><option value="">Toutes les catégories</option>{auditCategorySchema.options.map(c=><option key={c} value={c}>{c}</option>)}</select>
   <select className="field" aria-label="Résultat" value={filters.outcome} onChange={set('outcome')}><option value="">Succès et erreurs</option><option value="success">Succès</option><option value="error">Erreurs et vérifications</option></select>
   <input className="field" aria-label="Depuis" type="datetime-local" value={filters.from} onChange={set('from')}/>
   <input className="field" aria-label="Jusqu’à" type="datetime-local" value={filters.to} onChange={set('to')}/>
   <input className="field" aria-label="Identifiant de commande" placeholder="commandId" value={filters.commandId} onChange={set('commandId')}/>
   <button className="btn primary"><RefreshCw size={15}/>Filtrer</button>
  </form>
  {rows===null?<p className="muted">Chargement…</p>:rows.length===0?<p className="muted">Aucune entrée pour ces filtres.</p>:
   <ul className="log-list">{rows.map(l=><li key={l.id}><button onClick={()=>void details(l)}>
    <span className="log-time">{time(l.timestamp)}</span><span className="badge">{l.category}</span>
    <span className="log-message"><strong>{l.message}</strong><small>{name(l.actorAccountId)}{l.targetAccountId&&l.targetAccountId!==l.actorAccountId?` → ${name(l.targetAccountId)}`:''} · {l.action}{l.errorCode?` · ${l.errorCode}`:''}</small></span>
    <span className={`badge ${statusClass[l.status]}`}>{l.status}</span></button></li>)}</ul>}
  {open&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(null);}}><aside className="drawer" role="dialog" aria-modal="true" aria-label="Détail de l’entrée">
   <header className="drawer-head"><div><p className="eyebrow">{open.log.category} · {open.log.status}</p><h2>{open.log.action}</h2><small>{time(open.log.timestamp)}</small></div><button className="icon-button" aria-label="Fermer" onClick={()=>setOpen(null)}><X size={16}/></button></header>
   <section><p>{open.log.message}</p><dl className="facts">
    <div><dt>Acteur</dt><dd>{name(open.log.actorAccountId)}</dd></div><div><dt>Cible</dt><dd>{name(open.log.targetAccountId)}</dd></div>
    <div><dt>Erreur</dt><dd>{open.log.errorCode??'—'}</dd></div><div><dt>Run</dt><dd>{open.log.runId?.slice(0,8)??'—'}</dd></div>
   </dl>{open.log.commandId&&<p className="code-line">commandId <code>{open.log.commandId}</code></p>}</section>
   {open.command&&<section><h3>Commande de jeu</h3><dl className="facts"><div><dt>Commande</dt><dd>{open.command.command}</dd></div><div><dt>État</dt><dd>{open.command.status}</dd></div>
    <div><dt>Envoyée</dt><dd>{time(open.command.createdAt)}</dd></div><div><dt>Dernière mise à jour</dt><dd>{time(open.command.updatedAt)}</dd></div>
    {open.command.errorCode&&<div><dt>Erreur client</dt><dd>{open.command.errorCode}</dd></div>}</dl></section>}
   {open.transactions.length>0&&<section><h3>Transactions</h3><MoneyHistory transactions={open.transactions} labels={moneyTypeLabels} names={name}/></section>}
   {open.related.length>1&&<section><h3>Même commande</h3><ul className="protection-list">{open.related.map(r=><li key={r.id}><span>{r.message}</span><small>{time(r.timestamp)}</small></li>)}</ul></section>}
   {Object.keys(open.log.metadata).length>0&&<section><h3>Données</h3><pre className="metadata">{JSON.stringify(open.log.metadata,null,2)}</pre></section>}
  </aside></div>}
 </section>;
}
