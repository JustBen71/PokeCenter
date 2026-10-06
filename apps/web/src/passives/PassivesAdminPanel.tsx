import {useState} from 'react';
import {passiveAvailabilityLabels,passivePhaseLabels,passiveRarities,passiveRarityLabels,passiveSourceLabels,type PassiveRarity} from '@pokerace/shared';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {definition,ownedBy,progressLines,usePassives} from './passives-data';

const selectionLabels={NO_OFFER:'Sans offre',WAITING:'Choix en attente',CHOSEN:'A choisi'} as const;

/** Gestion → Passifs: selection flow, possessions, rarity weights, catalogue and pending rewards. Every action is audited. */
export function PassivesAdminPanel(){
 const {lobby}=useLobby();const {members}=useLive();const toast=useToast();const snapshot=usePassives();
 const [busy,setBusy]=useState(false),[weights,setWeights]=useState<Record<PassiveRarity,number>|null>(null);
 const [grant,setGrant]=useState({accountId:'',passiveId:''});
 const base=`/api/lobbies/${lobby.id}/passives`;
 const name=(id:string)=>members.find(m=>m.id===id)?.name??id;
 const call=async(path:string,body:object,done:string,method='POST')=>{
  setBusy(true);
  try{await api(`${base}${path}`,{method,body});toast.success(done);return true;}catch(e){toast.error(e);return false;}finally{setBusy(false);}
 };
 const startRace=async()=>{
  const waiting=snapshot.selection.filter(s=>s.status!=='CHOSEN').map(s=>name(s.accountId));
  if(waiting.length&&!window.confirm(`Démarrer sans le choix de ${waiting.join(', ')} ?`))return;
  await call('/race/start',{force:waiting.length>0},'Course lancée');
 };
 const available=snapshot.catalog.filter(c=>c.availability==='AVAILABLE'&&c.enabled);
 const draft=weights??snapshot.weights;
 const disabled=snapshot.catalog.filter(c=>!c.enabled).map(c=>c.id);
 const pending=(snapshot.rewards??[]).filter(r=>r.status==='PENDING'||r.status==='REVIEW'||r.status==='APPLYING');
 return <section className="panel passives-admin">
  <header className="panel-head"><h2>Passifs</h2><span className={`badge phase-${snapshot.phase.toLowerCase()}`}>{passivePhaseLabels[snapshot.phase]}</span></header>
  <div className="run-actions">
   {snapshot.phase==='NONE'&&<button className="primary" disabled={busy} onClick={()=>void call('/selection/start',{},'Sélection des passifs lancée')}>Lancer la course : sélection des passifs</button>}
   {snapshot.phase==='SELECTION'&&<button className="primary" disabled={busy} onClick={()=>void startRace()}>Démarrer la course</button>}
  </div>

  <h3>Joueurs</h3>
  <ul className="passive-admin-players">{members.map(m=>{const state=snapshot.selection.find(s=>s.accountId===m.id)?.status??'NO_OFFER';const owned=ownedBy(snapshot,m.id);
   return <li key={m.id}>
    <div><strong>{m.name}</strong>{snapshot.phase==='SELECTION'&&<span className={`badge selection-${state.toLowerCase()}`}>{selectionLabels[state]}</span>}</div>
    {snapshot.phase==='SELECTION'&&<div className="run-actions">
     <button disabled={busy} onClick={()=>void call('/offers/reset',{accountId:m.id},`Nouvelle offre pour ${m.name}`)}>{state==='NO_OFFER'?'Générer une offre':'Nouvelle offre'}</button>
     {state==='CHOSEN'&&<button disabled={busy} onClick={()=>void call('/offers/cancel-choice',{accountId:m.id},`Choix de ${m.name} annulé`)}>Annuler le choix</button>}
    </div>}
    <ul className="passive-owned-admin">{owned.map(o=>{const def=definition(o.passiveId);return <li key={o.id}>
     <span className={`passive-badge ${def?.rarity.toLowerCase()??''}`}>{def?.name??o.passiveId}</span>
     <small>{passiveSourceLabels[o.source]}{progressLines(o).length?` · ${progressLines(o).join(' · ')}`:''}</small>
     <button className="icon-button" aria-label={`Retirer ${def?.name} à ${m.name}`} disabled={busy} onClick={()=>{if(window.confirm(`Retirer « ${def?.name} » à ${m.name} ?`))void call('/revoke',{accountId:m.id,passiveId:o.passiveId},'Passif retiré');}}>✕</button>
    </li>;})}</ul>
   </li>;})}</ul>

  <form className="form-row" onSubmit={e=>{e.preventDefault();void call('/grant',grant,'Passif attribué').then(ok=>{if(ok)setGrant({accountId:'',passiveId:''});});}}>
   <select className="field" aria-label="Joueur" value={grant.accountId} onChange={e=>setGrant(g=>({...g,accountId:e.target.value}))}><option value="">Joueur…</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
   <select className="field" aria-label="Passif à attribuer" value={grant.passiveId} onChange={e=>setGrant(g=>({...g,passiveId:e.target.value}))}><option value="">Passif…</option>{available.map(c=><option key={c.id} value={c.id}>{passiveRarityLabels[c.rarity]} · {c.name}</option>)}</select>
   <button className="btn" disabled={busy||!grant.accountId||!grant.passiveId}>Attribuer</button>
  </form>

  <h3>Poids des raretés</h3>
  <form className="form-row" onSubmit={e=>{e.preventDefault();void call('/settings',{weights:draft},'Poids enregistrés','PATCH').then(ok=>{if(ok)setWeights(null);});}}>
   {passiveRarities.map(r=><label key={r} className="setting-row percent"><span>{passiveRarityLabels[r]}</span>
    <input className="field" inputMode="numeric" value={draft[r]} onChange={e=>setWeights({...draft,[r]:Number(e.target.value.replace(/\D/g,'')||0)})}/></label>)}
   <button className="btn" disabled={busy||!weights}>Enregistrer</button>
  </form>

  <h3>Catalogue</h3>
  <ul className="passive-catalog-admin">{snapshot.catalog.map(c=><li key={c.id} className={c.availability==='AVAILABLE'?'':'unavailable'}>
   <span className={`passive-badge ${c.rarity.toLowerCase()}`}>{c.name}</span>
   <small>{passiveAvailabilityLabels[c.availability]}{c.requires.length?` · requiert ${c.requires.join(', ')}`:''}{c.missing.length?` · manque ${c.missing.join(', ')}`:''}</small>
   <label className="toggle"><input type="checkbox" checked={c.enabled} disabled={busy} onChange={e=>void call('/settings',{disabled:e.target.checked?disabled.filter(id=>id!==c.id):[...disabled,c.id]},`« ${c.name} » ${e.target.checked?'activé':'désactivé'}`,'PATCH')}/>Actif</label>
  </li>)}</ul>

  <h3>Récompenses en attente</h3>
  {pending.length===0?<p className="muted">Aucune récompense en attente ou à vérifier.</p>:
   <ul className="passive-rewards">{pending.map(r=><li key={r.id}><strong>{name(r.accountId)}</strong> · {definition(r.passiveId)?.name} · {r.type}<span className={`badge status-${r.status.toLowerCase()}`}>{r.status}</span></li>)}</ul>}
 </section>;
}
