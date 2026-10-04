import {useEffect,useState} from 'react';
import {avatarUrl,type Account} from '@pokerace/shared';
import {api} from '../api/client';
import {useToast} from '../components/toast-context';
import {AvatarPicker} from './AvatarPicker';
import {lastAccountId} from './storage';

// "Qui es-tu ?" — a deliberately simple choice between friends; roles are enforced by the API.
export function LoginPage({onLogin}:{onLogin:(a:Account)=>void}){
 const toast=useToast();
 const [accounts,setAccounts]=useState<Account[]|null>(null),[selected,setSelected]=useState(lastAccountId()??''),[creating,setCreating]=useState(false);
 const [name,setName]=useState(''),[sprite,setSprite]=useState('brendan'),[admin,setAdmin]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{api<Account[]>('/api/accounts').then(list=>{setAccounts(list);if(list.length===0)setCreating(true);}).catch(e=>{setAccounts([]);toast.error(e);});},[]);
 const chosen=accounts?.find(a=>a.id===selected);
 async function create(e:React.FormEvent){
  e.preventDefault();setBusy(true);
  try{const account=await api<Account>('/api/accounts',{method:'POST',body:{name,sprite,admin}});toast.success(`Bienvenue ${account.name} !`);onLogin(account);}
  catch(error){toast.error(error);}finally{setBusy(false);}
 }
 return <main className="account-entry">
  <section className="account-welcome"><p className="eyebrow">POKÉRACE · ENTRE AMIS</p><h1>{creating?'Nouveau dresseur':'Qui es-tu ?'}</h1><p>Choisis ton compte, ou crée-le en quelques secondes.</p></section>
  <section className="account-box">
   {!creating?<form onSubmit={e=>{e.preventDefault();if(chosen){toast.success(`Bon retour ${chosen.name} !`);onLogin(chosen);}}}>
    <label>Compte<select aria-label="Compte" value={selected} onChange={e=>setSelected(e.target.value)} disabled={!accounts}>
     <option value="">{accounts?'Choisir…':'Chargement…'}</option>
     {accounts?.map(a=><option key={a.id} value={a.id}>{a.name}{a.admin?' · Admin':''}</option>)}
    </select></label>
    {chosen&&<div className="login-chosen"><img className="login-avatar" src={avatarUrl(chosen.sprite)} alt=""/><span>{chosen.name}<small>{chosen.admin?'Administrateur':'Joueur'}</small></span></div>}
    <button className="primary" disabled={!chosen}>Entrer</button>
    <p className="separator">ou</p>
    <button type="button" onClick={()=>setCreating(true)}>Créer un compte</button>
   </form>:<form onSubmit={create}>
    <label>Nom<input value={name} required maxLength={32} autoFocus onChange={e=>setName(e.target.value)} placeholder="Ben, Timéo…"/></label>
    <p className="field-label">Avatar</p>
    <AvatarPicker value={sprite} onChange={setSprite}/>
    <label className="admin-check"><input type="checkbox" checked={admin} onChange={e=>setAdmin(e.target.checked)}/>Administrateur</label>
    <p className="muted">Un administrateur reste un joueur. Il peut en plus créer des lobbies et gérer la course. Après la création, seul un administrateur peut changer un rôle.</p>
    <button className="primary" disabled={busy}>Créer et entrer</button>
    {!!accounts?.length&&<button type="button" disabled={busy} onClick={()=>setCreating(false)}>Retour</button>}
   </form>}
  </section>
 </main>;
}
