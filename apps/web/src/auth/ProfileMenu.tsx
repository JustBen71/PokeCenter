import {useEffect,useRef,useState} from 'react';
import {avatarUrl,type Account} from '@pokerace/shared';
import {ChevronDown,DoorOpen,ImageIcon,LogOut,PenLine} from 'lucide-react';
import {api} from '../api/client';
import {useToast} from '../components/toast-context';
import {useSession} from './session-context';
import {AvatarPicker} from './AvatarPicker';
import {PokeDollar} from '../components/PokeDollar';

type Editing='name'|'avatar'|null;

// Top-right identity: avatar, name, role and in-game money; the menu edits the profile or switches account/lobby.
export function ProfileMenu({money,moneyStale,onLeaveLobby}:{money?:number|null;moneyStale?:boolean;onLeaveLobby?:()=>void}){
 const {account,logout,setAccount}=useSession();const toast=useToast();
 const [open,setOpen]=useState(false),[editing,setEditing]=useState<Editing>(null);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[open]);
 const choose=(e:Editing)=>{setOpen(false);setEditing(e);};
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
   <button role="menuitem" onClick={()=>{setOpen(false);logout();}}><LogOut size={16}/>Changer de compte</button>
  </div>}
  {editing&&<ProfileDialog mode={editing} account={account} onClose={()=>setEditing(null)} onSaved={a=>{setAccount(a);setEditing(null);toast.success('Profil mis à jour');}}/>}
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
