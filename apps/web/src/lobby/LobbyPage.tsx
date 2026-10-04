import {useEffect,useState} from 'react';
import {avatarUrl,type LobbySummary,type LobbyStatus} from '@pokerace/shared';
import {Copy,KeyRound,Plus,RefreshCw,Users} from 'lucide-react';
import {api} from '../api/client';
import {useSession} from '../auth/session-context';
import {ProfileMenu} from '../auth/ProfileMenu';
import {useToast} from '../components/toast-context';

import {lobbyStatusLabels} from './labels';

export function LobbyPage({onEnter}:{onEnter:(lobby:LobbySummary)=>void}){
 const {account}=useSession();const toast=useToast();
 const [lobbies,setLobbies]=useState<LobbySummary[]|null>(null),[code,setCode]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false);
 const load=()=>api<LobbySummary[]>('/api/lobbies').then(setLobbies).catch(e=>{setLobbies([]);toast.error(e);});
 useEffect(()=>{void load();},[account.id]);
 const run=async(work:()=>Promise<void>)=>{setBusy(true);try{await work();}catch(e){toast.error(e);}finally{setBusy(false);}};
 const join=(typed:string)=>run(async()=>{const lobby=await api<LobbySummary>('/api/lobbies/join',{method:'POST',body:{code:typed}});toast.success(`Bienvenue dans « ${lobby.name} »`);setCode('');onEnter(lobby);});
 const create=(e:React.FormEvent)=>{e.preventDefault();void run(async()=>{const lobby=await api<LobbySummary>('/api/lobbies',{method:'POST',body:{name}});toast.success(`Lobby « ${lobby.name} » créé`);setName('');await load();});};
 // An admin opening a lobby they have not joined yet joins it with its code (admins can read it).
 const open=(lobby:LobbySummary)=>lobby.joined?onEnter(lobby):lobby.inviteCode?void join(lobby.inviteCode):undefined;
 const copy=(value:string)=>navigator.clipboard?.writeText(value).then(()=>toast.info('Code copié'),()=>toast.warning('Copie impossible : sélectionne le code à la main'));
 return <main className="account-entry lobby-entry">
  <section className="account-welcome">
   <p className="eyebrow">POKÉRACE · LOBBIES</p><h1>Choisis ta course.</h1>
   <p>Rejoins tes amis avec le code d’invitation, ou ouvre un lobby dont tu fais déjà partie.</p>
   <ProfileMenu/>
  </section>
  <section className="account-box">
   <form className="join-form" onSubmit={e=>{e.preventDefault();if(code.trim())void join(code);}}>
    <h2><KeyRound size={18}/>Rejoindre avec un code</h2>
    <div className="inline-field"><input aria-label="Code d’invitation" value={code} onChange={e=>setCode(e.target.value)} placeholder="Ex. 3FA9C21B" autoComplete="off" spellCheck={false}/><button className="primary" disabled={busy||!code.trim()}>Rejoindre</button></div>
   </form>
   <div className="section-head"><h2><Users size={18}/>{account.admin?'Tous les lobbies':'Mes lobbies'}</h2><button className="icon-button" aria-label="Actualiser" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/></button></div>
   {lobbies===null?<p className="muted">Chargement…</p>:lobbies.length===0?<p className="muted">{account.admin?'Aucun lobby pour l’instant : crée le premier ci-dessous.':'Tu ne fais partie d’aucun lobby. Demande le code à un administrateur.'}</p>:
    <ul className="lobby-list">{lobbies.map(l=><li key={l.id} className="lobby-card">
     <div className="lobby-card-head"><h3>{l.name}</h3><span className={`badge ${l.status.toLowerCase()}`}>{lobbyStatusLabels[l.status]}</span></div>
     <div className="avatars" aria-label={`${l.members.length} participant(s)`}>{l.members.slice(0,8).map(m=><img key={m.id} src={avatarUrl(m.sprite)} alt={m.name} title={m.name}/>)}<span>{l.members.length} participant{l.members.length>1?'s':''}</span></div>
     {l.inviteCode&&<p className="code-line">Code : <code>{l.inviteCode}</code><button type="button" className="icon-button" aria-label="Copier le code" onClick={()=>void copy(l.inviteCode!)}><Copy size={14}/></button></p>}
     <button className="primary" disabled={busy||l.status==='ARCHIVED'} onClick={()=>open(l)}>{l.joined?'Entrer':'Rejoindre et entrer'}</button>
    </li>)}</ul>}
   {account.admin&&<form className="create-form" onSubmit={create}>
    <h2><Plus size={18}/>Créer un lobby</h2>
    <div className="inline-field"><input aria-label="Nom du lobby" required maxLength={64} value={name} onChange={e=>setName(e.target.value)} placeholder="Lobby Octobre"/><button disabled={busy||!name.trim()}>Créer</button></div>
   </form>}
  </section>
 </main>;
}
