import {avatarUrl} from '@pokerace/shared';
import {useSession} from './Accounts';
import {apiFetch} from './session';
import {useEffect,useState} from 'react';
import {Gavel,Coins,LockKeyhole,Plus,Check,Users} from 'lucide-react';
import type {PublicAuction,PublicPlayer} from '@pokerace/shared';
const money=(value:number)=>`${value.toLocaleString('fr-FR')} ₽`;
const status={open:'Enchère ouverte',settling:'Paiement en cours',sold:'Adjugé !',cancelled:'Annulée',review:'Équipe et solde à vérifier'};
export function Auctions({players}:{players:PublicPlayer[]}){
 const {account}=useSession();
 const [uncertainty,setUncertainty]=useState(25);
 const [auctions,setAuctions]=useState<PublicAuction[]>([]),[busy,setBusy]=useState(false),[generating,setGenerating]=useState(false),[error,setError]=useState(''),[bids,setBids]=useState<Record<string,string>>({});
 const active=auctions.find(a=>['open','settling','review'].includes(a.status))??auctions[0],best=active?.bids.at(-1);
 async function request(path:string,body?:unknown){const res=await apiFetch(path,body===undefined?undefined:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await res.json();if(!res.ok)throw Error(value.error??'Erreur serveur');return value;}
 async function reload(){const d=await request('/api/auctions');setAuctions(d.auctions);setGenerating(d.generating);}
 useEffect(()=>{let stopped=false;const update=async()=>{try{const d=await request('/api/auctions');if(!stopped){setAuctions(d.auctions);setGenerating(d.generating);}}catch(e){if(!stopped)setError(String(e));}};void update();const timer=setInterval(update,2000);return()=>{stopped=true;clearInterval(timer);};},[]);
 async function act(path:string,body:unknown={}){setBusy(true);setError('');try{await request(path,body);}catch(e){setError(String(e));}finally{await reload().catch(e=>setError(String(e)));setBusy(false);}}
 const open=active?.status==='open';
 function seat(p:PublicPlayer){
  const balance=p.state.trainer?.money,count=p.state.trainer?.partyCount;
  const reason=p.playerId!==account.id?'Compte d’un autre joueur':!p.connected?'Hors ligne':!p.state.capabilities?.includes('auction-purchase-v1')||balance===undefined?'Relancez le client':count===undefined||count!==p.state.party.length?'Équipe en attente':count>=6?'Équipe pleine':undefined;
  const own=active?.bids.filter(b=>b.playerId===p.playerId).at(-1),leading=best?.playerId===p.playerId;
  return <article className={`auction-seat ${leading?'leading':''}`} key={p.playerId}>
   <div className="bidder-avatar"><img src={avatarUrl(p.account?.sprite??'brendan')} alt=""/></div><h3>{p.state.playerName??p.playerId}</h3><p className="bidder-balance"><Coins size={16}/>{balance===undefined?'Solde indisponible':money(balance)}</p><small>{count===undefined?'—':`${count}/6 Pokémon`} · {reason??`${6-(count??0)} place(s) libre(s)`}</small>
   {own&&<p className="own-bid">{leading?'Meilleure offre':'Dernière mise'} : {money(own.amount)}</p>}
   <form onSubmit={e=>{e.preventDefault();if(active)void act(`/api/auctions/${active.id}/bid`,{playerId:p.playerId,amount:Number(bids[p.playerId]??((best?.amount??0)+100))});}}><label>Mise de {p.state.playerName??p.playerId}<input aria-label={`Mise de ${p.state.playerName??p.playerId}`} type="number" min={(best?.amount??0)+1} max={balance??0} step={1} required value={bids[p.playerId]??((best?.amount??0)+100)} onChange={e=>setBids(b=>({...b,[p.playerId]:e.target.value}))} disabled={busy||!open||!!reason}/></label><button className="primary" disabled={busy||!open||!!reason}><Gavel size={15}/> Miser</button></form>
  </article>;
 }
 return <section className="auction-page"><header className="progress-heading"><div><p className="eyebrow">LE MARCHÉ DE LA POKÉRACE</p><h1>Enchères</h1><p>Un Pokémon surprise. Vos Pokédollars. À vous de trouver le bon prix.</p></div><div className="auction-create">{account.admin&&<><label>Incertitude : {uncertainty} %<input aria-label="Incertitude" type="range" min={0} max={100} step={5} value={uncertainty} onChange={e=>setUncertainty(Number(e.target.value))}/></label><button className="primary" disabled={busy||generating||!!auctions.find(a=>['open','settling','review'].includes(a.status))} onClick={()=>act('/api/auctions',{uncertainty})}><Plus size={18}/>{busy||generating?'Préparation…':'Nouveau Pokémon'}</button></>}</div></header>
 {!players.some(p=>p.playerId===account.id)&&<p className="muted">Pour participer, démarrez votre client avec ACCOUNT_NAME={account.name}.</p>}
 {error&&<p className="roulette-error" role="alert">{error}</p>}
 <div className="auction-arena"><div className="auction-seats left">{players.filter((_,i)=>i%2===0).map(seat)}</div><section className="auction-lot">
  {active?<><span className={`auction-status ${active.status}`}>{status[active.status]}</span><div className="auction-pedestal"><img src={`/sprites/${active.speciesId}.png`} alt={active.name} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/sprites/fallback.svg';}}/></div><p className="eyebrow">LOT #{active.speciesId.toString().padStart(3,'0')}</p><h2>{active.name}</h2><span className="auction-level">Niveau {active.level}</span><p className="muted">Moyenne arrondie de {active.sampleSize} Pokémon dans {active.participants.length} équipes connectées, figée au tirage.</p><div className="auction-secret"><LockKeyhole size={18}/><span>Fourchettes indicatives ; nature et attaques restent cachées.</span></div>{active.hints&&<section className="auction-hints"><p>Incertitude maximale : {active.uncertainty} %</p><table><thead><tr><th>Caractéristique</th><th>Valeur</th><th>IV</th><th>EV</th></tr></thead><tbody>{[['hp','PV'],['attack','Attaque'],['defense','Défense'],['speed','Vitesse'],['spAttack','Atq. spéciale'],['spDefense','Déf. spéciale']].map(([key,label])=>{const show=(r:{min:number;max:number}|undefined)=>r?`${r.min}–${r.max}`:'—';return <tr key={key}><th>{label}</th><td>{show(active.hints!.stats[key==='hp'?'maxHp':key])}</td><td>{show(active.hints!.ivs[key])}</td><td>{show(active.hints!.evs[key])}</td></tr>;})}</tbody></table></section>}<div className="auction-price"><small>{best?'Meilleure offre':'Prix de départ'}</small><strong>{money(best?.amount??1)}</strong><span>{best?.playerName??'Qui ouvre les enchères ?'}</span></div>
  {open&&account.admin&&<><button className="primary accept-auction" disabled={busy||!best} onClick={()=>best&&act(`/api/auctions/${active.id}/accept`,{playerId:best.playerId,amount:best.amount})}><Check size={18}/>Accepter{best?` · ${money(best.amount)}`:''}</button><button disabled={busy} onClick={()=>act(`/api/auctions/${active.id}/cancel`)}>Annuler l’enchère</button><p className="muted">L’accord est manuel. Seul le gagnant est débité, à l’acceptation, et reçoit le Pokémon.</p></>}
  {active.status==='review'&&account.admin&&<div className="roulette-result review"><p>Une confirmation manque. Vérifiez dans le jeu si le Pokémon est arrivé et si la mise a été débitée. Ces boutons enregistrent votre constat sans modifier le jeu.</p><button disabled={busy} onClick={()=>act(`/api/auctions/${active.id}/reviewed`,{outcome:'sold'})}>Vérifié : reçu et payé</button><button disabled={busy} onClick={()=>act(`/api/auctions/${active.id}/reviewed`,{outcome:'cancelled'})}>Vérifié : achat annulé</button></div>}
  <div className="auction-log" role="status">{active.log.map((line,i)=><p key={i}>{line}</p>)}</div>
  </>:<div className="auction-empty"><Gavel size={58}/><h2>La salle est ouverte</h2><p>Tirez un Pokémon parmi les 386 espèces d’Émeraude pour commencer.</p><p>Ses IV et EV seront aléatoires et ses attaques adaptées à son niveau.</p></div>}
 </section><div className="auction-seats right">{players.filter((_,i)=>i%2===1).map(seat)}</div></div>
 {!players.length&&<p className="muted"><Users size={18}/> Connectez les clients joueurs pour participer.</p>}
 <section className="roulette-panel auction-history"><h2>Le carnet des enchères</h2>{auctions.map(a=><details key={a.id}><summary>{a.name} · Niv. {a.level} · {status[a.status]} · {new Date(a.createdAt).toLocaleString('fr-FR')}</summary>{a.bids.length?a.bids.map((b,i)=><p key={i}>{b.playerName} — {money(b.amount)} · {new Date(b.at).toLocaleTimeString('fr-FR')}</p>):<p>Aucune mise.</p>}</details>)}</section>
 </section>;
}
