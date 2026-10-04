import {useState} from 'react';
import {auctionStatusLabels,type AuctionsSnapshot,type LobbyAuction} from '@pokerace/shared';
import {Gavel,Library,Lock,Sparkles,XCircle} from 'lucide-react';
import {api} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {PokeDollar} from '../components/PokeDollar';
import {nativeCan} from '../pokemon/game-actions';
import {statLabels} from '../pokemon/labels';

const fmt=(n:number)=>n.toLocaleString('fr-FR');
const keys=['maxHp','attack','defense','spAttack','spDefense','speed'] as const;
const ivKey=(k:typeof keys[number])=>k==='maxHp'?'hp':k;

function Ranges({auction}:{auction:LobbyAuction}){
 const exact=auction.revealed;
 return <table className="stat-table"><thead><tr><th/><th>Stat</th><th>IV</th><th>EV</th></tr></thead><tbody>{keys.map(k=>{const r=(g:'stats'|'ivs'|'evs',key:string)=>{const v=auction.hints[g][key];return v.min===v.max?String(v.min):`${v.min}–${v.max}`;};
  return <tr key={k}><th>{statLabels[k]}</th><td>{exact?exact.stats[k]:r('stats',k)}</td><td>{exact?exact.ivs[ivKey(k)]:r('ivs',ivKey(k))}</td><td>{exact?exact.evs[ivKey(k)]:r('evs',ivKey(k))}</td></tr>;})}</tbody></table>;
}

// Live auction room: everyone bids for themselves, admins generate and close; the real stats appear at the end.
export function AuctionsPage(){
 const {account}=useSession();const {lobby}=useLobby();const {views,runs}=useLive();const toast=useToast();
 const {auctions,generating}=useLiveTopic<AuctionsSnapshot>('auctions',{auctions:[],generating:false});
 const [amount,setAmount]=useState(''),[uncertainty,setUncertainty]=useState(25),[busy,setBusy]=useState(false);
 const current=auctions.find(a=>['OPEN','SETTLING','REVIEW'].includes(a.status));
 const history=auctions.filter(a=>a!==current);
 const view=views.find(v=>v.accountId===account.id);
 const money=view?.display.state.trainer?.money??null;
 const best=current?.bids.at(-1);
 const minimum=(best?.amount??0)+1;
 const why=!nativeCan(view,'money.write')||!nativeCan(view,'pokemon.insert')?'Ton jeu doit être connecté avec le client Pokérace à jour pour miser.'
  :!runs.some(r=>r.accountId===account.id&&r.status==='RUNNING')?'Une Run doit être en cours pour miser.'
  :(view?.display.state.party.length??0)>=6?'Libère un emplacement d’équipe pour miser.':null;
 const run=async(work:()=>Promise<unknown>,success:string)=>{setBusy(true);try{await work();toast.success(success);}catch(e){toast.error(e);}finally{setBusy(false);}};
 const path=`/api/lobbies/${lobby.id}/auctions`;
 const bid=(value:number)=>run(()=>api(`${path}/${current!.id}/bid`,{method:'POST',body:{amount:value}}),`Mise de ${fmt(value)} ₽ enregistrée`).then(()=>setAmount(''));
 return <section className="auction-room">
  <header className="page-head"><div><p className="eyebrow">ENCHÈRES DU LOBBY</p><h1>Enchères</h1><p className="muted">Les vraies caractéristiques restent secrètes : seules des fourchettes sont visibles jusqu’à la fin.</p></div>
   {account.admin&&!current&&<form className="generate" onSubmit={e=>{e.preventDefault();void run(()=>api(path,{method:'POST',body:{uncertainty}}),'Nouveau lot généré');}}>
    <label>Incertitude {uncertainty} %<input type="range" min={0} max={100} step={5} value={uncertainty} onChange={e=>setUncertainty(Number(e.target.value))}/></label>
    <button className="btn primary" disabled={busy||generating}><Sparkles size={16}/>{generating?'Génération…':'Générer un lot'}</button></form>}
  </header>
  {current?<article className="lot">
   <div className="lot-visual"><span className={`badge auction-${current.status.toLowerCase()}`}>{current.bids.length||current.status!=='OPEN'?auctionStatusLabels[current.status]:'En attente de la première mise'}</span>
    <img src={`/sprites/${current.speciesId}.png`} alt=""/><h2>{current.name}</h2><p>Niveau {current.level} · basé sur {current.sampleSize} Pokémon actifs</p>
    <div className="best"><small>Meilleure offre</small><strong><PokeDollar size={20}/>{best?fmt(best.amount):'—'}</strong><span>{best?best.name:'Aucune mise'}</span></div></div>
   <div className="lot-details"><h3><Lock size={15}/> Caractéristiques estimées (±{current.uncertainty} %)</h3><Ranges auction={current}/>
    {current.status==='OPEN'&&<form className="bid-form" onSubmit={e=>{e.preventDefault();const v=Number(amount);if(v>=minimum)void bid(v);}}>
     <div className="inline-row"><input className="field" inputMode="numeric" aria-label="Montant de la mise" placeholder={`${fmt(minimum)} ₽ minimum`} value={amount} onChange={e=>setAmount(e.target.value.replace(/\D/g,''))}/>
      <button className="btn primary" disabled={busy||!!why||Number(amount)<minimum||(money!==null&&Number(amount)>money)}><Gavel size={16}/>Miser</button></div>
     <div className="quick">{[minimum,Math.ceil(minimum*1.1),Math.ceil(minimum*1.25)].filter((v,i,a)=>a.indexOf(v)===i).map(v=><button key={v} type="button" className="btn" disabled={busy||!!why||(money!==null&&v>money)} onClick={()=>void bid(v)}>{fmt(v)} ₽</button>)}</div>
     <small className="muted">{why??`Ton solde en jeu : ${money===null?'—':fmt(money)} ₽`}</small>
    </form>}
    {account.admin&&<div className="row-actions">
     {current.status==='OPEN'&&<button className="btn primary" disabled={busy||!best} onClick={()=>window.confirm(`Clôturer et attribuer à ${best?.name} pour ${fmt(best?.amount??0)} ₽ ?`)&&void run(()=>api(`${path}/${current.id}/close`,{method:'POST'}),'Enchère clôturée : paiement confirmé')}><Gavel size={16}/>Clôturer</button>}
     {current.status==='OPEN'&&<button className="btn danger" disabled={busy} onClick={()=>window.confirm('Annuler cette enchère ?')&&void run(()=>api(`${path}/${current.id}/cancel`,{method:'POST'}),'Enchère annulée')}><XCircle size={16}/>Annuler</button>}
     {current.status==='REVIEW'&&<p className="notice">Confirmation perdue : vérifiez le jeu du gagnant puis résolvez l’opération dans Gestion → Opérations à vérifier.</p>}
    </div>}
    <ol className="bid-list">{[...current.bids].reverse().map(b=><li key={b.amount}><span>{b.name}</span><strong>{fmt(b.amount)} ₽</strong><small>{new Date(b.at).toLocaleTimeString('fr-FR')}</small></li>)}</ol>
    <details className="lot-log"><summary>Journal</summary><ul>{current.log.map((l,i)=><li key={i}>{l}</li>)}</ul></details>
   </div>
  </article>:<section className="empty-state"><Gavel/><h2>Aucune enchère en cours</h2><p>{account.admin?'Génère un lot : son niveau suit la moyenne des Pokémon des joueurs actifs.':'Un administrateur lancera bientôt le prochain lot.'}</p></section>}
  {history.length>0&&<section className="panel auction-history"><header className="panel-head"><h2>Historique</h2></header>{history.map(a=><details key={a.id}>
   <summary><span className={`badge auction-${a.status.toLowerCase()}`}>{auctionStatusLabels[a.status]}</span> {a.name} niv. {a.level}{a.winner?` · ${a.winner.name} pour ${fmt(a.winner.price)} ₽`:''}</summary>
   <Ranges auction={a}/>
   {account.admin&&a.status==='SOLD'&&<button className="btn" disabled={busy} onClick={()=>void run(()=>api(`${path}/${a.id}/library`,{method:'POST'}),'Pokémon copié dans la bibliothèque')}><Library size={15}/>Copier dans la bibliothèque</button>}
  </details>)}</section>}
 </section>;
}
