import {useState} from 'react';
import {ticketStatusLabels,type ShopSnapshot,type WheelResolution} from '@pokerace/shared';
import {Play,X} from 'lucide-react';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {TicketIcon} from '../wheels/TicketIcon';
import {launchedHere} from '../wheels/launched';

// Pending wheels bought in the shop, in reception order; the admin launches them one at a time.
export function QueuePanel(){
 const {lobby}=useLobby();const {members}=useLive();const toast=useToast();
 const shop=useLiveTopic<ShopSnapshot|null>('shop',null);
 const [busy,setBusy]=useState(false);
 const name=(id:string|null)=>members.find(m=>m.id===id)?.name??'—';
 const resolve=async(id:string)=>{
  setBusy(true);
  try{const r=await api<WheelResolution>(`/api/lobbies/${lobby.id}/shop/tickets/${id}/resolve`,{method:'POST'});launchedHere.add(r.id);}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 const cancel=async(id:string,label:string)=>{
  if(!window.confirm(`Annuler la roue « ${label} » ?`))return;
  setBusy(true);
  try{await api(`/api/lobbies/${lobby.id}/shop/tickets/${id}/cancel`,{method:'POST'});toast.success('Roue annulée');}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 const queue=shop?.queue??[];
 return <section className="panel">
  <header className="panel-head"><h2>Roues en attente</h2><small className="muted">{queue.filter(t=>t.status==='QUEUED').length} à lancer</small></header>
  {queue.length===0?<p className="muted">Aucune roue en attente.</p>:<ol className="review-list">{queue.map((t,i)=><li key={t.id}>
   <div className="ticket-row"><TicketIcon icon={t.icon} size={32}/><div><strong>{i+1}. {t.wheelName}</strong><small>{name(t.buyerId)}{t.targetId?` → ${name(t.targetId)}`:''} · reçu {new Date(t.queuedAt??t.createdAt).toLocaleString('fr-FR')}</small></div></div>
   {t.status==='QUEUED'?<button className="btn primary" disabled={busy||i>0&&queue[0].status==='QUEUED'} title={i>0?'Résolution dans l’ordre de réception':undefined} onClick={()=>void resolve(t.id)}><Play size={15}/>Lancer</button>:<span className="badge ticket-payment_review">{ticketStatusLabels[t.status]}</span>}
   {t.status==='QUEUED'&&<button className="btn danger" disabled={busy} onClick={()=>void cancel(t.id,t.wheelName)}><X size={15}/>Annuler</button>}
  </li>)}</ol>}
 </section>;
}
