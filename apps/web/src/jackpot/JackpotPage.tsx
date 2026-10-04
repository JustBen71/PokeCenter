import {useState} from 'react';
import {jackpotSourceLabels,moneyTypeLabels,type JackpotSnapshot} from '@pokerace/shared';
import {Trophy} from 'lucide-react';
import {api} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {PokeDollar} from '../components/PokeDollar';
import {MoneyHistory} from '../bank/MoneyHistory';

const fmt=(n:number)=>n.toLocaleString('fr-FR');

// Public lobby pot: current amount, where it comes from and recent movements. Admins can correct it.
export function JackpotPage(){
 const {account}=useSession();const {lobby}=useLobby();const {members}=useLive();const toast=useToast();
 const jackpot=useLiveTopic<JackpotSnapshot|null>('jackpot',null);
 const [operation,setOperation]=useState<'add'|'remove'>('add'),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const max=Math.max(1,...(jackpot?.sources.map(s=>s.amount)??[1]));
 const adjust=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);
  try{await api(`/api/lobbies/${lobby.id}/jackpot/adjust`,{method:'POST',body:{operation,amount:Number(amount),reason}});toast.success('Jackpot ajusté');setAmount('');setReason('');}
  catch(err){toast.error(err);}finally{setBusy(false);}
 };
 return <section className="jackpot-page">
  <header className="page-head"><div><p className="eyebrow">POT COMMUN DU LOBBY</p><h1>Jackpot</h1><p className="muted">Alimenté par les taxes et contributions ; certains gages permettent de le remporter.</p></div></header>
  <article className="jackpot-hero"><Trophy size={44}/><div><small>Montant actuel</small><strong><PokeDollar size={34}/>{jackpot?fmt(jackpot.balance):'—'}</strong>
   {jackpot&&<span>{fmt(jackpot.totalIn)} ₽ reçus · {fmt(jackpot.totalOut)} ₽ redistribués</span>}</div></article>
  <div className="panel-grid">
   <section className="panel"><header className="panel-head"><h2>Sources principales</h2></header>
    {!jackpot?.sources.length?<p className="muted">Aucune contribution pour l’instant.</p>:<ul className="source-bars">{jackpot.sources.map(s=><li key={s.reason}>
     <span>{jackpotSourceLabels[s.reason]??s.reason}</span><div className="bar"><span style={{width:`${Math.round(s.amount/max*100)}%`}}/></div><strong>{fmt(s.amount)} ₽</strong></li>)}</ul>}
   </section>
   {account.admin&&<form className="panel" onSubmit={adjust}><header className="panel-head"><h2>Ajuster le jackpot</h2></header>
    <div className="inline-row"><select className="field" value={operation} onChange={e=>setOperation(e.target.value as 'add'|'remove')}><option value="add">Ajouter</option><option value="remove">Retirer</option></select>
     <input className="field" inputMode="numeric" placeholder="Montant ₽" value={amount} onChange={e=>setAmount(e.target.value.replace(/\D/g,''))}/></div>
    <input className="field" required maxLength={200} placeholder="Motif (obligatoire)" value={reason} onChange={e=>setReason(e.target.value)}/>
    <button className="btn primary" disabled={busy||!Number(amount)||!reason.trim()}>Appliquer</button>
   </form>}
  </div>
  <section className="panel"><header className="panel-head"><h2>Mouvements récents</h2></header>
   <MoneyHistory transactions={jackpot?.recent??[]} labels={moneyTypeLabels} names={id=>members.find(m=>m.id===id)?.name??'Lobby'}/></section>
 </section>;
}
