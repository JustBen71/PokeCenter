import {useEffect,useState} from 'react';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive} from '../realtime/live-context';
import {useToast} from '../components/toast-context';

type Command={id:string;accountId:string;command:string;status:string;errorCode:string|null;createdAt:string};
const commandLabels:Record<string,string>={'game.money.add':'Ajout de Pokédollars','game.money.remove':'Retrait de Pokédollars','game.money.set':'Réglage des Pokédollars',
 'game.pokemon.insert':'Ajout d’un Pokémon','game.pokemon.remove':'Retrait d’un Pokémon','game.pokemon.replace':'Remplacement d’un Pokémon'};

/**
 * Commands whose confirmation was lost. The admin checks the game, then states whether the change happened;
 * linked ledger rows are confirmed or cancelled accordingly. Nothing is ever replayed automatically.
 */
export function ReviewPanel(){
 const {lobby}=useLobby();const {members}=useLive();const toast=useToast();
 const [commands,setCommands]=useState<Command[]|null>(null),[busy,setBusy]=useState(false);
 const load=()=>api<Command[]>(`/api/lobbies/${lobby.id}/game-commands?status=REVIEW`).then(setCommands).catch(e=>{setCommands([]);toast.error(e);});
 useEffect(()=>{void load();},[lobby.id]);
 const resolve=async(c:Command,applied:boolean)=>{
  if(!window.confirm(applied?'Le changement est bien présent dans le jeu ?':'Le changement est absent du jeu ?'))return;
  setBusy(true);
  try{await api(`/api/lobbies/${lobby.id}/game-commands/${c.id}/resolve`,{method:'POST',body:{applied}});toast.success('Opération résolue');await load();}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 return <section className="panel">
  <header className="panel-head"><h2>Opérations à vérifier</h2><button className="btn" disabled={busy} onClick={()=>void load()}>Actualiser</button></header>
  {commands===null?<p className="muted">Chargement…</p>:commands.length===0?<p className="muted">Aucune opération en attente de vérification.</p>:
   <ul className="review-list">{commands.map(c=><li key={c.id}>
    <div><strong>{commandLabels[c.command]??c.command}</strong><small>{members.find(m=>m.id===c.accountId)?.name??c.accountId} · {new Date(c.createdAt).toLocaleString('fr-FR')} · {c.errorCode??'confirmation perdue'}</small><code>{c.id}</code></div>
    <div className="row-actions"><button className="btn primary" disabled={busy} onClick={()=>void resolve(c,true)}>Appliquée</button><button className="btn danger" disabled={busy} onClick={()=>void resolve(c,false)}>Non appliquée</button></div>
   </li>)}</ul>}
 </section>;
}
