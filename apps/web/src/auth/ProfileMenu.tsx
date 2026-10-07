import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {avatarUrl,type Account} from '@pokerace/shared';
import {ChevronDown,DoorOpen,ImageIcon,LogOut,PenLine,ShieldCheck,ShieldOff} from 'lucide-react';
import {api} from '../api/client';
import {useToast} from '../components/toast-context';
import {useSession} from './session-context';
import {AvatarPicker} from './AvatarPicker';
import {saveAdminToken} from './storage';
import {PokeDollar} from '../components/PokeDollar';

type Editing='name'|'avatar'|'admin'|null;

// Top-right identity: avatar, name, role and in-game money; the menu edits the profile or switches account/lobby.
export function ProfileMenu({money,moneyStale,onLeaveLobby}:{money?:number|null;moneyStale?:boolean;onLeaveLobby?:()=>void}){
 const {account,logout,setAccount}=useSession();const toast=useToast();
 const [open,setOpen]=useState(false),[editing,setEditing]=useState<Editing>(null);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[open]);
 const choose=(e:Editing)=>{setOpen(false);setEditing(e);};
 // With a server password, the admin role is a session of this browser (« Se connecter en admin »).
 const [passwordRequired,setPasswordRequired]=useState(false);
 useEffect(()=>{void api<{passwordRequired:boolean}>('/api/admin/session').then(r=>setPasswordRequired(r.passwordRequired)).catch(()=>{});},[]);
 const leaveAdmin=async()=>{setOpen(false);saveAdminToken(account.id,null);setAccount(await api<Account>('/api/me'));toast.success('Mode administrateur quitté');};
 return <div className="profile" ref={root}>
  {money!==undefined&&<span className={`money ${moneyStale?'stale':''}`} title={money===null?'Jeu non connecté':moneyStale?'Dernière valeur connue — jeu non connecté':'Pokédollars dans le jeu'}>
   <PokeDollar/>{money===null?'—':money.toLocaleString('fr-FR')}
  </span>}
  <button className="profile-button" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>
   <img src={avatarUrl(account.sprite)} alt=""/>
   <span>{account.name}<small>{account.admin?'Administrateur':'Joueur'}</small></span>
   <ChevronDown size={16}/>
  </button>
  {open&&<div className="profile-menu" role="menu">
   <button role="menuitem" onClick={()=>choose('name')}><PenLine size={16}/>Changer de nom</button>
   <button role="menuitem" onClick={()=>choose('avatar')}><ImageIcon size={16}/>Changer d’avatar</button>
   {onLeaveLobby&&<button role="menuitem" onClick={()=>{setOpen(false);onLeaveLobby();}}><DoorOpen size={16}/>Changer de lobby</button>}
   {passwordRequired&&(account.admin
    ?<button role="menuitem" onClick={()=>void leaveAdmin()}><ShieldOff size={16}/>Quitter le mode admin</button>
    :<button role="menuitem" onClick={()=>choose('admin')}><ShieldCheck size={16}/>Se connecter en admin</button>)}
   <button role="menuitem" onClick={()=>{setOpen(false);logout();}}><LogOut size={16}/>Changer de compte</button>
  </div>}
  {/* Rendered in <body>: the top bar's backdrop-filter would otherwise confine position:fixed to the bar (the dialog overflowed above the screen). */}
  {editing&&createPortal(<>
  {editing==='admin'&&<AdminDialog account={account} onClose={()=>setEditing(null)} onDone={a=>{setAccount(a);setEditing(null);toast.success('Connecté en administrateur');}}/>}
  {editing&&editing!=='admin'&&<ProfileDialog mode={editing} account={account} onClose={()=>setEditing(null)} onSaved={a=>{setAccount(a);setEditing(null);toast.success('Profil mis à jour');}}/>}
  </>,document.body)}
 </div>;
}

function ProfileDialog({mode,account,onClose,onSaved}:{mode:'name'|'avatar';account:Account;onClose:()=>void;onSaved:(a:Account)=>void}){
 const toast=useToast();
 const [name,setName]=useState(account.name),[sprite,setSprite]=useState(account.sprite),[busy,setBusy]=useState(false);
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[onClose]);
 async function save(e:React.FormEvent){
  e.preventDefault();setBusy(true);
  try{onSaved(await api<Account>(`/api/accounts/${account.id}`,{method:'PATCH',body:mode==='name'?{name}:{sprite}}));}
  catch(error){toast.error(error);}finally{setBusy(false);}
 }
 return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <form className="dialog" role="dialog" aria-modal="true" aria-label={mode==='name'?'Changer de nom':'Changer d’avatar'} onSubmit={save}>
   <h2>{mode==='name'?'Changer de nom':'Changer d’avatar'}</h2>
   {mode==='name'?<label>Nom<input value={name} required maxLength={32} autoFocus onChange={e=>setName(e.target.value)}/></label>:<AvatarPicker value={sprite} onChange={setSprite}/>}
   <div className="dialog-actions"><button type="button" onClick={onClose} disabled={busy}>Annuler</button><button className="primary" disabled={busy}>Enregistrer</button></div>
  </form>
 </div>;
}

function AdminDialog({account,onClose,onDone}:{account:Account;onClose:()=>void;onDone:(a:Account)=>void}){
 const toast=useToast();const [password,setPassword]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[onClose]);
 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);
  try{
   const {token}=await api<{token:string}>('/api/admin/session',{method:'POST',body:{password}});
   saveAdminToken(account.id,token);onDone(await api<Account>('/api/me'));
  }catch(error){toast.error(error);}finally{setBusy(false);}
 }
 return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <form className="dialog" role="dialog" aria-modal="true" aria-label="Se connecter en admin" onSubmit={submit}>
   <h2>Se connecter en admin</h2>
   <p className="muted">Mot de passe administrateur du serveur. Le rôle reste actif 7 jours sur ce navigateur, pour ce compte.</p>
   <label>Mot de passe<input type="password" value={password} required autoFocus autoComplete="current-password" onChange={e=>setPassword(e.target.value)}/></label>
   <div className="dialog-actions"><button type="button" onClick={onClose} disabled={busy}>Annuler</button><button className="primary" disabled={busy||!password}>Se connecter</button></div>
  </form>
 </div>;
}
