import {avatarUrl,passivePhaseLabels,passiveRarities,passiveRarityLabels,passiveAvailabilityLabels} from '@pokerace/shared';
import {Gem} from 'lucide-react';
import {useSession} from '../auth/session-context';
import {useLive} from '../realtime/live-context';
import {PassiveBadgeRow} from './PassiveBadge';
import {PassiveFacts} from './PassiveDetail';
import {PassiveCard} from './PassiveCard';
import {ownedBy,usePassives} from './passives-data';

// Visible to every member: own passives in detail, everyone's passives, and the catalogue by rarity.
export function PassivesPage(){
 const {account}=useSession();const {members}=useLive();const snapshot=usePassives();
 const mine=ownedBy(snapshot,account.id);
 return <section className="passives-page">
  <header className="page-head"><div><p className="eyebrow">TOUTE LA COURSE</p><h1>Passifs</h1><p className="muted">Bonus permanents et cumulables : ils restent acquis quand une Run est perdue.</p></div>
   <span className={`badge phase-${snapshot.phase.toLowerCase()}`}>{passivePhaseLabels[snapshot.phase]}</span></header>
  <section className="panel">
   <header className="panel-head"><h2>Mes passifs</h2><small className="muted">{mine.length}</small></header>
   {mine.length===0?<p className="muted">{snapshot.phase==='SELECTION'?'Choisis ton passif parmi tes trois cartes.':'Aucun passif pour l’instant.'}</p>
    :<div className="passive-facts-grid">{mine.map(o=><PassiveFacts key={o.id} owned={o}/>)}</div>}
  </section>
  <h2 className="section-title">Tous les joueurs</h2>
  <ul className="passive-players">{members.map(m=>{const owned=ownedBy(snapshot,m.id);const state=snapshot.selection.find(s=>s.accountId===m.id)?.status;
   return <li key={m.id} className="panel">
    <div className="passive-player"><img src={avatarUrl(m.sprite)} alt=""/><strong>{m.name}</strong>{snapshot.phase==='SELECTION'&&<small className="muted">{state==='CHOSEN'?'a choisi':'choisit…'}</small>}</div>
    {owned.length?<PassiveBadgeRow owned={owned} ownerName={m.name} max={99}/>:<p className="muted">Aucun passif</p>}
   </li>;})}</ul>
  <h2 className="section-title">Catalogue</h2>
  {passiveRarities.map(rarity=>{const entries=snapshot.catalog.filter(c=>c.rarity===rarity);if(!entries.length)return null;
   return <section key={rarity}><h3 className="rarity-title"><Gem size={16}/>{passiveRarityLabels[rarity]} <small className="muted">· poids {snapshot.weights[rarity]}</small></h3>
    <div className="passive-cards catalogue">{entries.map(c=><PassiveCard key={c.id} passive={c} muted={c.availability!=='AVAILABLE'||!c.enabled}>
     {(c.availability!=='AVAILABLE'||!c.enabled)&&<small className="passive-availability">{!c.enabled?'Désactivé dans ce lobby':passiveAvailabilityLabels[c.availability]}{c.missing.length?` : ${c.missing.join(', ')}`:''}</small>}
    </PassiveCard>)}</div>
   </section>;})}
 </section>;
}
