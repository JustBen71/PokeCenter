import {useState} from 'react';
import {depositSplit,moneyTypeLabels,type BankSnapshot} from '@pokerace/shared';
import {ArrowDownToLine,ArrowUpFromLine,Gamepad2,Landmark,Trophy} from 'lucide-react';
import {api,requestId} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {PokeDollar} from '../components/PokeDollar';
import {nativeCan} from '../pokemon/game-actions';
import {MoneyHistory} from './MoneyHistory';

const fmt=(n:number|null)=>n===null?'—':n.toLocaleString('fr-FR');

// Player bank: deposit (taxed, the tax feeds the jackpot) and withdraw, both applied in the game and the ledger.
export function BankPage(){
 const {account}=useSession();const {lobby}=useLobby();const {views,runs}=useLive();const toast=useToast();
 const bank=useLiveTopic<BankSnapshot|null>('bank',null);
 const [deposit,setDeposit]=useState(''),[withdraw,setWithdraw]=useState(''),[busy,setBusy]=useState(false);
 const view=views.find(v=>v.accountId===account.id);
 const gameMoney=view?.display.state.trainer?.money??null;
 const running=runs.some(r=>r.accountId===account.id&&r.status==='RUNNING');
 const blocked=!nativeCan(view,'money.write')?'Ton jeu doit être connecté avec le client Pokérace à jour (écritures activées).':!running?'Une Run doit être en cours pour déplacer de l’argent.':null;
 const split=depositSplit(Number(deposit)||0,bank?.taxPercent??0);
 const send=async(kind:'deposit'|'withdraw',amount:number,reset:()=>void)=>{
  setBusy(true);
  try{await api(`/api/lobbies/${lobby.id}/bank/${kind}`,{method:'POST',body:{amount,requestId:requestId()}});
   toast.success(kind==='deposit'?`${fmt(amount)} ₽ déposés`:`${fmt(amount)} ₽ retirés vers le jeu`);reset();}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 return <section className="bank-page">
  <header className="page-head"><div><p className="eyebrow">ARGENT DU LOBBY</p><h1>Banque</h1><p className="muted">Ton argent en banque te reste même si tu perds une Run.</p></div></header>
  <div className="money-tiles">
   <article className="money-tile"><Gamepad2/><span>Dans le jeu</span><strong><PokeDollar/>{fmt(gameMoney)}</strong>{view&&!view.display.connected&&<small>Dernière valeur connue</small>}</article>
   <article className="money-tile bank"><Landmark/><span>En banque</span><strong><PokeDollar/>{fmt(bank?.balance??null)}</strong></article>
   <article className="money-tile jackpot"><Trophy/><span>Jackpot du lobby</span><strong><PokeDollar/>{fmt(bank?.jackpot??null)}</strong></article>
  </div>
  {blocked&&<p className="notice" role="status">{blocked}</p>}
  <div className="panel-grid">
   <form className="panel" onSubmit={e=>{e.preventDefault();const n=Number(deposit);if(n>0)void send('deposit',n,()=>setDeposit(''));}}>
    <header className="panel-head"><h2><ArrowDownToLine size={18}/> Déposer</h2><small className="muted">Taxe {bank?.taxPercent??'—'} %</small></header>
    <input className="field" inputMode="numeric" aria-label="Montant à déposer" placeholder="Montant ₽" value={deposit} onChange={e=>setDeposit(e.target.value.replace(/\D/g,''))}/>
    {Number(deposit)>0&&<p className="split">Jeu −{fmt(Number(deposit))} ₽ → banque +{fmt(split.bank)} ₽ · jackpot +{fmt(split.tax)} ₽</p>}
    <button className="btn primary" disabled={busy||!!blocked||!Number(deposit)||(gameMoney!==null&&Number(deposit)>gameMoney)}>Déposer</button>
   </form>
   <form className="panel" onSubmit={e=>{e.preventDefault();const n=Number(withdraw);if(n>0)void send('withdraw',n,()=>setWithdraw(''));}}>
    <header className="panel-head"><h2><ArrowUpFromLine size={18}/> Retirer</h2><small className="muted">Sans taxe</small></header>
    <input className="field" inputMode="numeric" aria-label="Montant à retirer" placeholder="Montant ₽" value={withdraw} onChange={e=>setWithdraw(e.target.value.replace(/\D/g,''))}/>
    {Number(withdraw)>0&&<p className="split">Banque −{fmt(Number(withdraw))} ₽ → jeu +{fmt(Number(withdraw))} ₽</p>}
    <button className="btn primary" disabled={busy||!!blocked||!Number(withdraw)||Number(withdraw)>(bank?.balance??0)}>Retirer</button>
   </form>
  </div>
  <section className="panel"><header className="panel-head"><h2>Historique</h2></header><MoneyHistory transactions={bank?.history??[]} labels={moneyTypeLabels}/></section>
 </section>;
}
