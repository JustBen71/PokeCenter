import {useMemo,useState} from 'react';
import {avatarUrl,runStatusLabels} from '@pokerace/shared';
import {Gamepad2,MapPin,Users} from 'lucide-react';
import {useLive,useLiveTopic} from '../realtime/live-context';
import type {ObjectivesSnapshot} from '@pokerace/shared';
import {PokeDollar} from '../components/PokeDollar';
import {spriteUrl} from '../pokemon/PokemonSheet';
import {clientStateLabels,courseRows,type CourseRow} from './course-model';
import {PlayerDrawer} from './PlayerDrawer';
import {PassiveBadgeRow} from '../passives/PassiveBadge';
import {ownedBy,usePassives} from '../passives/passives-data';

type Pokemon=CourseRow['party'][number];

// Main dashboard: one card per participant, live through Socket.IO. Details open in place (drawer / sheet).
export function CoursePage({onPokemon}:{onPokemon:(row:CourseRow,pokemon:Pokemon)=>void}){
 const {members,views,runs}=useLive();
 const {objectives}=useLiveTopic<ObjectivesSnapshot>('objectives',{objectives:[],completions:[]});
 const passives=usePassives();
 const rows=useMemo(()=>courseRows(members,views,runs,objectives),[members,views,runs,objectives]);
 const [selected,setSelected]=useState<string|null>(null);
 const active=rows.find(r=>r.accountId===selected)??null;
 const playing=rows.filter(r=>r.clientState==='playing').length;
 return <section className="course-page">
  <header className="page-head"><div><p className="eyebrow">COURSE EN DIRECT</p><h1>Course</h1><p className="muted">Équipes, positions et Pokédollars mis à jour en temps réel.</p></div>
   <div className="summary"><Users/><div><strong>{rows.length}</strong><span>participant{rows.length>1?'s':''}</span></div><div><strong>{playing}</strong><span>en jeu</span></div></div></header>
  {rows.length===0?<section className="empty-state"><Gamepad2/><h2>En attente des dresseurs</h2><p>Les participants du lobby apparaîtront ici.</p></section>:
   <div className="course-grid">{rows.map(row=><article key={row.accountId} className={`course-card ${row.clientState}`}>
    <button className="course-card-head" onClick={()=>setSelected(row.accountId)} aria-label={`Détails de ${row.name}`}>
     <span className="course-rank">{row.rank?`#${row.rank}`:'—'}</span>
     <img src={avatarUrl(row.sprite)} alt=""/>
     <span className="course-id"><strong>{row.name}</strong><small>{row.run?`Run #${row.run.number} · ${runStatusLabels[row.run.status]}`:'Aucune Run'}</small></span>
     <span className={`client-pill ${row.clientState}`}>{clientStateLabels[row.clientState]}</span>
    </button>
    <div className="course-facts">
     <span><MapPin size={14}/>{row.location??'Position inconnue'}</span>
     <span className="money-inline"><PokeDollar size={14}/>{row.money===null?'—':row.money.toLocaleString('fr-FR')}</span>
    </div>
    {row.clientState==='offline'&&<p className="stale">Dernières données reçues : le jeu est déconnecté.</p>}
    <div className="party six">{Array.from({length:6},(_,i)=>{const p=row.party.find(m=>m.slot===i+1);
     if(!p)return <div key={i} className="slot empty"><div className="pokeball"/></div>;
     const hp=Math.round(p.currentHp/p.maxHp*100);
     return <button key={i} className={`slot ${p.currentHp===0?'fainted':''}`} onClick={()=>onPokemon(row,p)} aria-label={`Fiche de ${p.nickname||p.speciesName}`}>
      <img src={spriteUrl(p)} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/sprites/fallback.svg';}} alt=""/>
      <span className="mon"><strong>{p.nickname||p.speciesName}</strong>{p.nickname&&<small>{p.speciesName}</small>}<small>Niv. {p.level}</small>
       <span className="hp"><span style={{width:`${hp}%`}} className={hp<25?'low':hp<50?'mid':''}/></span><small>{p.currentHp}/{p.maxHp} PV</small></span>
     </button>;})}</div>
    <PassiveBadgeRow owned={ownedBy(passives,row.accountId)} ownerName={row.name}/>
   </article>)}</div>}
  {active&&<PlayerDrawer row={active} passives={ownedBy(passives,active.accountId)} onClose={()=>setSelected(null)} onPokemon={p=>onPokemon(active,p)}/>}
 </section>;
}
