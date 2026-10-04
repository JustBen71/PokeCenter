import {useState} from 'react';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useToast} from '../components/toast-context';
import {nativeCan} from '../pokemon/game-actions';
import type {CourseRow} from './course-model';

// Admin correction of in-game Pokédollars: recorded in the ledger and applied by a verified game command.
export function AdminMoneyForm({row}:{row:CourseRow}){
 const {lobby}=useLobby();const toast=useToast();
 const [operation,setOperation]=useState<'add'|'remove'>('add'),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const writable=nativeCan(row.view,'money.write');
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();const value=Number(amount);if(!Number.isInteger(value)||value<1)return;
  setBusy(true);
  try{await api(`/api/lobbies/${lobby.id}/players/${row.accountId}/money`,{method:'POST',body:{operation,amount:value,...(reason.trim()?{reason:reason.trim()}:{})}});
   toast.success(`${operation==='add'?'+':'−'}${value.toLocaleString('fr-FR')} ₽ appliqués dans le jeu de ${row.name}`);setAmount('');setReason('');}
  catch(error){toast.error(error);}finally{setBusy(false);}
 };
 return <form className="admin-money" onSubmit={submit}>
  <div className="inline-row">
   <select aria-label="Opération" value={operation} onChange={e=>setOperation(e.target.value as 'add'|'remove')}><option value="add">Ajouter</option><option value="remove">Retirer</option></select>
   <input aria-label="Montant" inputMode="numeric" placeholder="Montant ₽" value={amount} onChange={e=>setAmount(e.target.value.replace(/\D/g,''))}/>
   <button className="btn primary" disabled={busy||!writable||!amount}>Appliquer</button>
  </div>
  <input aria-label="Motif" placeholder="Motif (facultatif)" maxLength={200} value={reason} onChange={e=>setReason(e.target.value)}/>
  {!writable&&<p className="muted">Le jeu de ce joueur ne permet pas d’écrire l’argent (client hors ligne, jeu non lu ou écritures désactivées).</p>}
 </form>;
}
