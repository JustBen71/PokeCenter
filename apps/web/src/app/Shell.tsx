import {useEffect,useState,type ReactNode} from 'react';
import {Menu,Radio,Trophy,X} from 'lucide-react';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useLive} from '../realtime/live-context';
import {ProfileMenu} from '../auth/ProfileMenu';
import {routes,type RouteId} from './routes';


// Header (lobby, Pokédollars, profile, live state) + sidebar; on narrow screens the sidebar becomes a drawer.
export function Shell({route,children}:{route:RouteId;children:ReactNode}){
 const {account}=useSession();const {lobby,leave}=useLobby();const {views,connected}=useLive();
 const [menuOpen,setMenuOpen]=useState(false);
 useEffect(()=>setMenuOpen(false),[route]);
 const mine=views.find(v=>v.accountId===account.id);
 const money=mine?.display.state.trainer?.money??null;
 const nav=(admin:boolean)=>routes.filter(r=>!!r.admin===admin).map(r=><a key={r.id} href={r.hash} aria-current={route===r.id?'page':undefined}><r.icon size={18}/>{r.label}</a>);
 return <div className="shell">
  <header className="top">
   <button className="icon-button menu-toggle" aria-label={menuOpen?'Fermer le menu':'Ouvrir le menu'} aria-expanded={menuOpen} onClick={()=>setMenuOpen(o=>!o)}>{menuOpen?<X size={18}/>:<Menu size={18}/>}</button>
   <div className="brand"><span><Trophy/></span><div><strong>Pokérace</strong><small title={lobby.inviteCode?`Code d’invitation : ${lobby.inviteCode}`:undefined}>{lobby.name}</small></div></div>
   <div className="top-right">
    <div className={`live ${connected?'':'lost'}`} title={connected?'Données en direct':'Reconnexion au serveur…'}><Radio/><span>{connected?'DIRECT':'RECONNEXION'}</span></div>
    <ProfileMenu money={money} moneyStale={!!mine&&!mine.display.connected} onLeaveLobby={leave}/>
   </div>
  </header>
  <div className="shell-body">
   <nav className={`sidebar ${menuOpen?'open':''}`} aria-label="Menu principal">
    {nav(false)}
    {account.admin&&<><p className="nav-section">ADMIN</p>{nav(true)}</>}
    {lobby.inviteCode&&<p className="nav-code">Code du lobby<code>{lobby.inviteCode}</code></p>}
   </nav>
   {menuOpen&&<div className="sidebar-scrim" onClick={()=>setMenuOpen(false)}/>}
   <main className="page">{children}</main>
  </div>
 </div>;
}
