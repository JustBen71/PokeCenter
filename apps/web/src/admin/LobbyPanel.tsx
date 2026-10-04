import {useState} from 'react';
import {avatarUrl,type LobbyStatus,type LobbySummary} from '@pokerace/shared';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {lobbyStatusLabels} from '../lobby/labels';

// Lobby identity: name, status, invite code and participants.
export function LobbyPanel(){
 const {lobby,refresh}=useLobby();const {members}=useLive();const toast=useToast();
 const [name,setName]=useState(lobby.name),[busy,setBusy]=useState(false);
 const save=async(patch:{name?:string;status?:LobbyStatus})=>{
  setBusy(true);
  try{await api<LobbySummary>(`/api/lobbies/${lobby.id}`,{method:'PATCH',body:patch});await refresh();toast.success('Lobby mis à jour');}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 return <section className="panel">
  <header className="panel-head"><h2>Lobby</h2><span className={`badge ${lobby.status.toLowerCase()}`}>{lobbyStatusLabels[lobby.status]}</span></header>
  <form className="inline-row" onSubmit={e=>{e.preventDefault();if(name.trim()&&name!==lobby.name)void save({name:name.trim()});}}>
   <input className="field" aria-label="Nom du lobby" maxLength={64} value={name} onChange={e=>setName(e.target.value)}/><button className="btn" disabled={busy||!name.trim()||name===lobby.name}>Renommer</button>
  </form>
  <label className="setting-row"><span>Statut<small>Un lobby archivé ne peut plus être rejoint.</small></span>
   <select className="field" value={lobby.status} disabled={busy} onChange={e=>void save({status:e.target.value as LobbyStatus})}>{Object.entries(lobbyStatusLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <p className="code-line">Code d’invitation : <code>{lobby.inviteCode}</code></p>
  <div className="avatars">{members.map(m=><img key={m.id} src={avatarUrl(m.sprite)} alt={m.name} title={`${m.name}${m.admin?' · admin':''}`}/>)}<span>{members.length} participant{members.length>1?'s':''}</span></div>
 </section>;
}
