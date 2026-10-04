import {useEffect,useState} from 'react';
import type {Protection,ShopSnapshot} from '@pokerace/shared';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';

const labels:Record<Protection['status'],string>={PENDING_PAYMENT:'Paiement',PAYMENT_REVIEW:'Paiement à vérifier',ACTIVE:'Active',USED:'Utilisée',CANCELLED:'Annulée'};

// Who is protected right now, and which protections were already used.
export function ProtectionsPanel(){
 const {lobby}=useLobby();const {members}=useLive();
 const shop=useLiveTopic<ShopSnapshot|null>('shop',null);
 const [rows,setRows]=useState<(Protection&{accountId:string})[]>([]);
 // Reloaded whenever the shop changes (purchases, blocked wheels).
 useEffect(()=>{api<(Protection&{accountId:string})[]>(`/api/lobbies/${lobby.id}/shop/protections`).then(setRows).catch(()=>{});},[lobby.id,shop]);
 const active=members.map(m=>({m,count:rows.filter(r=>r.accountId===m.id&&r.status==='ACTIVE').length}));
 return <section className="panel">
  <header className="panel-head"><h2>Protections</h2><small className="muted">{rows.filter(r=>r.status==='ACTIVE').length} active(s)</small></header>
  <ul className="protection-list">{active.map(({m,count})=><li key={m.id}><span>{m.name}</span><strong>{count?`🛡 ×${count}`:'—'}</strong></li>)}</ul>
  {rows.some(r=>r.status!=='ACTIVE')&&<details><summary>Historique</summary><ul className="protection-list">{rows.filter(r=>r.status!=='ACTIVE').map(r=><li key={r.id}><span>{members.find(m=>m.id===r.accountId)?.name??'—'}</span><small>{labels[r.status]}{r.usedAt?` · ${new Date(r.usedAt).toLocaleString('fr-FR')}`:''}</small></li>)}</ul></details>}
 </section>;
}
