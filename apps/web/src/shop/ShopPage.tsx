import {useState} from 'react';
import {ticketStatusLabels,wheelToneLabels,type ShopSnapshot,type WheelType} from '@pokerace/shared';
import {Shield,ShoppingBag} from 'lucide-react';
import {api,requestId} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {PokeDollar} from '../components/PokeDollar';
import {nativeCan} from '../pokemon/game-actions';
import {TicketIcon} from '../wheels/TicketIcon';

const fmt=(n:number)=>n.toLocaleString('fr-FR');

// Wheel tickets and protections bought with in-game Pokédollars; tickets wait in a queue resolved by an admin.
export function ShopPage(){
 const {account}=useSession();const {lobby}=useLobby();const {members,views,runs}=useLive();const toast=useToast();
 const shop=useLiveTopic<ShopSnapshot|null>('shop',null);
 const [buying,setBuying]=useState<WheelType|null>(null),[target,setTarget]=useState(''),[busy,setBusy]=useState(false);
 const view=views.find(v=>v.accountId===account.id);const money=view?.display.state.trainer?.money??null;
 const blocked=!nativeCan(view,'money.write')?'Ton jeu doit être connecté avec le client Pokérace à jour pour acheter.':!runs.some(r=>r.accountId===account.id&&r.status==='RUNNING')?'Une Run doit être en cours pour acheter.':null;
 const name=(id:string|null)=>members.find(m=>m.id===id)?.name??'—';
 const run=async(work:()=>Promise<unknown>,ok:string)=>{setBusy(true);try{await work();toast.success(ok);return true;}catch(e){toast.error(e);return false;}finally{setBusy(false);}};
 const buy=async()=>{if(!buying)return;
  if(await run(()=>api(`/api/lobbies/${lobby.id}/shop/tickets`,{method:'POST',body:{wheelId:buying.id,...(target?{targetId:target}:{}),requestId:requestId()}}),`Ticket « ${buying.name} » acheté : il rejoint la file d’attente`))setBuying(null);};
 const active=shop?.protections.filter(p=>p.status==='ACTIVE').length??0;
 if(!shop)return <p className="muted">Chargement de la boutique…</p>;
 return <section className="shop-page">
  <header className="page-head"><div><p className="eyebrow">BOUTIQUE DU LOBBY</p><h1>Boutique</h1><p className="muted">Achète des roues pour toi ou contre un adversaire. Chaque achat est débité dans ton jeu.</p></div>
   <div className="summary"><PokeDollar size={22}/><div><strong>{money===null?'—':fmt(money)}</strong><span>dans ton jeu</span></div><div><strong>{active}</strong><span>protection{active>1?'s':''} active{active>1?'s':''}</span></div></div></header>
  {blocked&&<p className="notice">{blocked}</p>}
  <div className="shop-grid">
   {shop.wheels.map(w=><article key={w.id} className={`panel shop-item tone-${w.tone.toLowerCase()}`}>
    <TicketIcon icon={w.icon} size={64}/>
    <h2>{w.name}</h2><small>{wheelToneLabels[w.tone]}{w.tone==='BAD'?' · à lancer sur un adversaire':''}</small>
    {w.description&&<p className="muted">{w.description}</p>}
    <details><summary>{w.gages.length} gage{w.gages.length>1?'s':''} possible{w.gages.length>1?'s':''}</summary><ul>{w.gages.map(g=><li key={g.id}>{g.name}</li>)}</ul></details>
    <button className="btn primary" disabled={busy||!!blocked||(money!==null&&w.price>money)} onClick={()=>{setBuying(w);setTarget('');}}><ShoppingBag size={15}/>{fmt(w.price)} ₽</button>
   </article>)}
   <article className="panel shop-item protection">
    <Shield size={56}/>
    <h2>Protection</h2><small>Annule la prochaine roue hostile reçue</small>
    <p className="muted">Elle ne bloque que les attaques reçues <strong>après</strong> son achat.</p>
    <button className="btn primary" disabled={busy||!!blocked||(money!==null&&shop.protectionPrice>money)} onClick={()=>window.confirm(`Acheter une protection pour ${fmt(shop.protectionPrice)} ₽ ?`)&&void run(()=>api(`/api/lobbies/${lobby.id}/shop/protections`,{method:'POST',body:{requestId:requestId()}}),'Protection active')}><Shield size={15}/>{fmt(shop.protectionPrice)} ₽</button>
   </article>
  </div>
  <section className="panel"><header className="panel-head"><h2>Mes tickets</h2></header>
   {shop.tickets.length===0?<p className="muted">Aucun ticket pour l’instant.</p>:<ul className="review-list">{[...shop.tickets].reverse().map(t=><li key={t.id}>
    <div className="ticket-row"><TicketIcon icon={t.icon} size={32}/><div><strong>{t.wheelName}</strong><small>{t.buyerId===account.id?(t.targetId?`Contre ${name(t.targetId)}`:'Pour toi'):`Reçu de ${name(t.buyerId)}`} · {new Date(t.createdAt).toLocaleString('fr-FR')}</small></div></div>
    <span className={`badge ticket-${t.status.toLowerCase()}`}>{ticketStatusLabels[t.status]}</span></li>)}</ul>}
  </section>
  {buying&&<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setBuying(null);}}><form className="dialog" onSubmit={e=>{e.preventDefault();void buy();}}>
   <h2>Acheter « {buying.name} »</h2>
   <p>Prix : <strong>{fmt(buying.price)} ₽</strong>, débités dans ton jeu à la confirmation.</p>
   {buying.tone!=='GOOD'&&<label>Cible{buying.tone==='NEUTRAL'?' (facultative)':''}<select className="field" required={buying.tone==='BAD'} value={target} onChange={e=>setTarget(e.target.value)}><option value="">{buying.tone==='BAD'?'Choisir un adversaire…':'Aucune'}</option>{members.filter(m=>m.id!==account.id).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
   <div className="dialog-actions"><button type="button" className="btn" onClick={()=>setBuying(null)}>Annuler</button><button className="btn primary" disabled={busy||(buying.tone==='BAD'&&!target)}>Payer {fmt(buying.price)} ₽</button></div>
  </form></div>}
 </section>;
}
