import {useEffect,useRef,useState} from 'react';
import {gageHandlerInfo,type WheelResolution,type WheelsSnapshot} from '@pokerace/shared';
import {api} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {TicketIcon} from './TicketIcon';
import {definition,usePassives} from '../passives/passives-data';
import {useBattles} from '../battles/battles-data';
import {battleStatusLabels} from '@pokerace/shared';

const ROW=56,VISIBLE=5,DURATION=3000;
import {launchedHere} from './launched';

/**
 * Vertical wheel shown to the whole lobby. The server already chose the gage: the strip scrolls for ~3 s and
 * stops on it. Then an immediate gage is applied by the admin who launched it; a gage with choices shows its form.
 */
export function WheelOverlay(){
 const {socket,members}=useLive();const {account}=useSession();const {lobby}=useLobby();const toast=useToast();
 const {resolutions}=useLiveTopic<WheelsSnapshot>('wheels',{wheels:[],resolutions:[]});
 const [current,setCurrent]=useState<WheelResolution|null>(null),[phase,setPhase]=useState<'spinning'|'stopped'>('spinning'),[rolling,setRolling]=useState(false);
 const passives=usePassives();const battles=useBattles();
 const [passiveId,setPassiveId]=useState('');
 const [target,setTarget]=useState(''),[slot,setSlot]=useState(0),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{
  if(!socket)return;
  const onSpin=(r:WheelResolution)=>{clearTimeout(timer.current);setCurrent(r);setPhase('spinning');setRolling(false);setTarget(r.targetId??'');setSlot(0);setConfirm(false);setPassiveId('');
   // Start from the top of the strip, then slide to the drawn gage on the next frames.
   setTimeout(()=>setRolling(true),40);
   timer.current=setTimeout(()=>setPhase('stopped'),DURATION+150);};
  // The admin page reopens a pending gage directly on its result.
  const onReopen=(e:Event)=>{const r=(e as CustomEvent<WheelResolution>).detail;setCurrent(r);setPhase('stopped');setRolling(true);setTarget(r.targetId??'');setSlot(0);setConfirm(false);setPassiveId('');};
  socket.on('wheel-spin',onSpin);document.addEventListener('wheel-reopen',onReopen);
  return()=>{socket.off('wheel-spin',onSpin);document.removeEventListener('wheel-reopen',onReopen);clearTimeout(timer.current);};
 },[socket]);
 // Keep the overlay in sync with the stored status (applied, failed, review…).
 const live=current?resolutions.find(r=>r.id===current.id)??current:null;
 const apply=async()=>{
  if(!live)return;setBusy(true);
  try{await api(`/api/lobbies/${lobby.id}/wheel-resolutions/${live.id}/apply`,{method:'POST',body:{...(target?{targetId:target}:{}),...(slot?{slot}:{}),...(confirm?{confirmOutOfBattle:true}:{}),...(steal&&passiveId?{passiveId}:{})}});}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 useEffect(()=>{if(phase==='stopped'&&live?.status==='DRAWN'&&account.admin&&launchedHere.has(live.id)){launchedHere.delete(live.id);void apply();}},[phase,live?.status]);
 const name=(id:string|null)=>members.find(m=>m.id===id)?.name??'—';
 if(!live)return null;
 const winner=26;
 const POKEMON_GAGES=['REMOVE_POKEMON','POKEMON_TRANSFER','POKEMON_LEVEL','MAGIKARP_CURSE'];
 const party=POKEMON_GAGES.includes(live.gage.handler)&&live.gage.params.selector==='choice';
 // Steal: the target's passives that the beneficiary does not own and that are not used up.
 const steal=live.gage.handler==='PASSIVE_STEAL';
 const owned=(id:string)=>passives.owned.filter(o=>o.accountId===id);
 const stealable=steal&&target?owned(target).filter(o=>!owned(live.ownerId).some(m=>m.passiveId===o.passiveId)&&o.progress.consumed!==true):[];
 // A passive lets one player pick the gage among several (Sixième sens, Maître du chaos).
 const choosing=!!live.options;
 const canChoose=choosing&&(account.id===live.chooserId||account.admin);
 const choose=async(gageId:string)=>{setBusy(true);try{await api(`/api/lobbies/${lobby.id}/wheel-resolutions/${live.id}/choose`,{method:'POST',body:{gageId}});}catch(e){toast.error(e);}finally{setBusy(false);}};
 const needsConfirm=[...POKEMON_GAGES,'GIVE_LIBRARY_POKEMON'].includes(live.gage.handler);
 const done=['SUCCESS','FAILED','REVIEW','BLOCKED'].includes(live.status);
 const translate=rolling?-(winner-Math.floor(VISIBLE/2))*ROW:0;
 return <div className="wheel-overlay" role="dialog" aria-modal="true" aria-label={`Roue ${live.wheelName}`}>
  <div className={`wheel-card tone-${live.tone.toLowerCase()}`}>
   <header><TicketIcon tone={live.tone}/><div><p className="eyebrow">{live.wheelName}</p><h2>{name(live.ownerId)}{live.targetId?` → ${name(live.targetId)}`:''}</h2></div></header>
   <div className="wheel-window" style={{height:ROW*VISIBLE}}>
    <span className="pointer left">▶</span><span className="pointer right">◀</span>
    <ul className={`wheel-strip ${phase}`} style={{transform:`translateY(${translate}px)`,transitionDuration:rolling?`${DURATION}ms`:'0ms'}}>
     {live.strip.map((g,i)=><li key={i} className={i===winner&&phase==='stopped'?'winner':''} style={{height:ROW}}>{g}</li>)}
    </ul>
   </div>
   {phase==='stopped'&&<section className="wheel-result">
    {!choosing&&<><h3>{live.gage.name}</h3>
    <p>{live.gage.description||gageHandlerInfo[live.gage.handler]?.help}</p></>}
    {live.status==='BLOCKED'&&<p className="notice">{live.result}</p>}
    {live.gage.handler==='START_BATTLE'&&live.status==='SUCCESS'&&(()=>{
     // The battle created by this gage (latest one of the fighter since the draw): followed live until its result.
     const fighter=live.gage.params.fighter==='TARGET'?live.targetId:live.ownerId;
     const battle=battles.encounters.find(b=>b.accountId===fighter&&b.createdAt>=live.createdAt);
     return battle&&<p className={`battle-banner ${battle.status.toLowerCase()}`}>{battle.status==='WON'?`✅ Victoire contre ${battle.trainer.name}`:battle.status==='LOST'?`❌ Défaite contre ${battle.trainer.name}`:`⚔ Combat contre ${battle.trainer.name} · ${battleStatusLabels[battle.status]}`}</p>;})()}
    {live.result&&live.status!=='BLOCKED'&&<p className={`outcome ${live.status.toLowerCase()}`}>{live.status==='SUCCESS'?'✔':live.status==='REVIEW'?'⚠':'✖'} {live.result}</p>}
    {choosing&&<div className="gage-choice"><p>{canChoose?'Choisis le gage qui s’applique :':`En attente du choix de ${name(live.chooserId)}…`}</p>
     {live.options!.map(g=><button key={g.id} className="btn" disabled={!canChoose||busy} onClick={()=>void choose(g.id)}><strong>{g.name}</strong><small>{g.description||gageHandlerInfo[g.handler]?.help}</small></button>)}</div>}
    {!choosing&&account.admin&&(live.status==='AWAITING_CHOICE'||live.status==='DRAWN')&&<form onSubmit={e=>{e.preventDefault();void apply();}}>
     {live.gage.requiresTarget&&<label>Cible<select className="field" value={target} onChange={e=>{setTarget(e.target.value);setPassiveId('');}}><option value="">Choisir…</option>{members.filter(m=>m.id!==live.ownerId||!['STEAL_MONEY','PASSIVE_STEAL','START_BATTLE','POKEMON_TRANSFER'].includes(live.gage.handler)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
     {steal&&target&&(stealable.length?<label>Passif à voler<select className="field" value={passiveId} onChange={e=>setPassiveId(e.target.value)}><option value="">Choisir…</option>{stealable.map(o=>{const d=definition(o.passiveId);return <option key={o.id} value={o.passiveId}>{d?.name??o.passiveId}</option>;})}</select></label>
      :<p className="muted">{name(target)} n’a aucun passif volable.</p>)}
     {party&&<label>Emplacement<select className="field" value={slot} onChange={e=>setSlot(Number(e.target.value))}><option value={0}>Choisir…</option>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>{n}</option>)}</select></label>}
     {needsConfirm&&<label className="check"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Le joueur n’est pas en combat</label>}
     <button className="btn primary" disabled={busy||(live.gage.requiresTarget&&!target)||(party&&!slot)||(needsConfirm&&!confirm)||(steal&&!passiveId)}>Appliquer</button>
    </form>}
    {!account.admin&&!done&&<p className="muted">En attente de l’administrateur…</p>}
    {/* A refused gage stays pending: the admin may close and reopen or abandon it from the Roues page. */}
    <button className="btn" onClick={()=>setCurrent(null)}>{done||!account.admin?'Fermer':'Fermer (le gage reste en attente)'}</button>
   </section>}
  </div>
 </div>;
}
