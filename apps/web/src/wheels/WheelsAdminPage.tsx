import {useEffect,useState} from 'react';
import {gageHandlerInfo,gageHandlers,ticketIcons,wheelToneLabels,type GageHandler,type WheelInput,type WheelResolution,type WheelType,type WheelsSnapshot} from '@pokerace/shared';
import {Pencil,Play,Plus,Trash2} from 'lucide-react';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import type {LibraryItem} from '../pokemon/library-types';
import {TicketIcon} from './TicketIcon';
import {launchedHere} from './launched';

type Draft=WheelInput&{id?:string};
// Untouched default icon follows the tone (purple for hostile wheels); a chosen icon is kept.
const toneIcon=(tone:Draft['tone'])=>tone==='BAD'?'purple-1' as const:'green-1' as const;
const emptyWheel=():Draft=>({name:'',description:'',price:1000,icon:'green-1',tone:'GOOD',enabled:true,gages:[{name:'',description:'',handler:'NOTICE',params:{},weight:1}]});
const defaultParams:Record<GageHandler,Record<string,unknown>>={NOTICE:{},GIVE_MONEY:{amount:500},TAKE_MONEY:{amount:500},STEAL_MONEY:{amount:500},REMOVE_POKEMON:{selector:'random'},
 GIVE_LIBRARY_POKEMON:{artifactId:''},JACKPOT_FIXED:{amount:1000},JACKPOT_PERCENT:{percent:10},JACKPOT_SHARE:{},JACKPOT_EMPTY:{}};
const statusLabels:Record<WheelResolution['status'],string>={DRAWN:'Tiré',AWAITING_CHOICE:'Choix requis',APPLYING:'En cours',SUCCESS:'Appliqué',FAILED:'Échec',REVIEW:'À vérifier',BLOCKED:'Bloqué'};

function GageParams({handler,params,onChange,library}:{handler:GageHandler;params:Record<string,unknown>;onChange:(p:Record<string,unknown>)=>void;library:LibraryItem[]}){
 const number=(key:string,label:string)=><label>{label}<input className="field" inputMode="numeric" value={String(params[key]??'')} onChange={e=>onChange({...params,[key]:Number(e.target.value.replace(/\D/g,''))})}/></label>;
 if(['GIVE_MONEY','TAKE_MONEY','STEAL_MONEY','JACKPOT_FIXED'].includes(handler))return number('amount','Montant ₽');
 if(handler==='JACKPOT_PERCENT')return number('percent','Pourcentage');
 if(handler==='REMOVE_POKEMON')return <label>Pokémon<select className="field" value={String(params.selector)} onChange={e=>onChange({selector:e.target.value})}><option value="random">Au hasard</option><option value="highest">Plus haut niveau</option><option value="lowest">Plus bas niveau</option><option value="choice">Choisi par l’admin</option></select></label>;
 if(handler==='GIVE_LIBRARY_POKEMON')return <label>Pokémon de la bibliothèque<select className="field" value={String(params.artifactId)} onChange={e=>onChange({artifactId:e.target.value})}><option value="">Choisir…</option>{library.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}</select></label>;
 return null;
}

// Admin: wheel types and their gages, manual launches and the follow-up of recent results.
export function WheelsAdminPage(){
 const {lobby}=useLobby();const {members}=useLive();const toast=useToast();
 const {wheels,resolutions}=useLiveTopic<WheelsSnapshot>('wheels',{wheels:[],resolutions:[]});
 const [draft,setDraft]=useState<Draft|null>(null),[library,setLibrary]=useState<LibraryItem[]>([]),[busy,setBusy]=useState(false);
 const [launch,setLaunch]=useState<{wheel:WheelType;owner:string;target:string}|null>(null);
 useEffect(()=>{api<LibraryItem[]>('/api/library').then(setLibrary).catch(()=>{});},[]);
 const path=`/api/lobbies/${lobby.id}`;
 const run=async(work:()=>Promise<unknown>,ok:string)=>{setBusy(true);try{await work();toast.success(ok);return true;}catch(e){toast.error(e);return false;}finally{setBusy(false);}};
 const save=async()=>{if(!draft)return;const {id,...body}=draft;
  if(await run(()=>api(id?`${path}/wheels/${id}`:`${path}/wheels`,{method:id?'PUT':'POST',body}),id?'Roue modifiée':'Roue créée'))setDraft(null);};
 const spin=async()=>{if(!launch)return;setBusy(true);
  try{const r=await api<WheelResolution>(`${path}/wheels/${launch.wheel.id}/spin`,{method:'POST',body:{ownerId:launch.owner,...(launch.target?{targetId:launch.target}:{})}});launchedHere.add(r.id);setLaunch(null);}
  catch(e){toast.error(e);}finally{setBusy(false);}};
 const name=(id:string|null)=>members.find(m=>m.id===id)?.name??'—';
 const patchGage=(i:number,patch:Partial<Draft['gages'][number]>)=>setDraft(d=>d&&{...d,gages:d.gages.map((g,j)=>j===i?{...g,...patch}:g)});
 return <section className="wheels-admin">
  <header className="page-head"><div><p className="eyebrow">ADMIN</p><h1>Roues</h1><p className="muted">Le serveur tire le gage avant l’animation ; chaque gage appelle un effet codé et testé.</p></div>
   <button className="btn primary" onClick={()=>setDraft(emptyWheel())}><Plus size={16}/>Nouvelle roue</button></header>
  <div className="wheel-grid">{wheels.map(w=><article key={w.id} className={`panel wheel-type tone-${w.tone.toLowerCase()} ${w.enabled?'':'disabled'}`}>
   <header className="panel-head"><div className="wheel-title"><TicketIcon icon={w.icon}/><div><h2>{w.name}</h2><small>{wheelToneLabels[w.tone]} · {w.price.toLocaleString('fr-FR')} ₽{w.enabled?'':' · désactivée'}</small></div></div>
    <div className="row-actions"><button className="icon-button" aria-label="Modifier" onClick={()=>setDraft({...w,gages:w.gages.map(({id:_id,requiresTarget:_r,...g})=>g)})}><Pencil size={15}/></button>
     <button className="icon-button" aria-label="Supprimer" onClick={()=>window.confirm(`Supprimer la roue « ${w.name} » ?`)&&void run(()=>api(`${path}/wheels/${w.id}`,{method:'DELETE'}),'Roue supprimée')}><Trash2 size={15}/></button></div></header>
   {w.description&&<p className="muted">{w.description}</p>}
   <ul className="gage-list">{w.gages.map(g=><li key={g.id}><strong>{g.name}</strong><small>{gageHandlerInfo[g.handler].label}{g.weight>1?` · poids ${g.weight}`:''}</small></li>)}</ul>
   <button className="btn" disabled={!w.enabled} onClick={()=>setLaunch({wheel:w,owner:members[0]?.id??'',target:''})}><Play size={15}/>Lancer</button>
  </article>)}</div>
  <section className="panel"><header className="panel-head"><h2>Derniers tirages</h2></header>
   {resolutions.length===0?<p className="muted">Aucun tirage pour l’instant.</p>:<ul className="review-list">{resolutions.map(r=><li key={r.id}>
    <div><strong>{r.wheelName} · {r.gage.name}</strong><small>{name(r.ownerId)}{r.targetId?` → ${name(r.targetId)}`:''} · {new Date(r.createdAt).toLocaleString('fr-FR')} · {statusLabels[r.status]}</small>{r.result&&<small>{r.result}</small>}</div>
    {['DRAWN','AWAITING_CHOICE','REVIEW'].includes(r.status)&&<div className="row-actions">
     {r.status!=='REVIEW'&&<button className="btn" disabled={busy} onClick={()=>{launchedHere.delete(r.id);document.dispatchEvent(new CustomEvent('wheel-reopen',{detail:r}));}}>Ouvrir</button>}
     {r.status==='REVIEW'&&<button className="btn primary" disabled={busy} onClick={()=>void run(()=>api(`${path}/wheel-resolutions/${r.id}/close`,{method:'POST',body:{status:'SUCCESS'}}),'Gage validé')}>Effet constaté</button>}
     <button className="btn danger" disabled={busy} onClick={()=>window.confirm('Abandonner ce gage ?')&&void run(()=>api(`${path}/wheel-resolutions/${r.id}/close`,{method:'POST',body:{status:'FAILED'}}),'Gage abandonné')}>Abandonner</button>
    </div>}
   </li>)}</ul>}
  </section>
  {launch&&<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setLaunch(null);}}><form className="dialog" onSubmit={e=>{e.preventDefault();void spin();}}>
   <h2>Lancer « {launch.wheel.name} »</h2>
   <label>Bénéficiaire<select className="field" value={launch.owner} onChange={e=>setLaunch({...launch,owner:e.target.value})}>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
   <label>Cible (facultative, demandée après le tirage si nécessaire)<select className="field" value={launch.target} onChange={e=>setLaunch({...launch,target:e.target.value})}><option value="">Aucune</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
   <div className="dialog-actions"><button type="button" className="btn" onClick={()=>setLaunch(null)}>Annuler</button><button className="btn primary" disabled={busy||!launch.owner}>Tourner</button></div>
  </form></div>}
  {draft&&<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDraft(null);}}><form className="dialog wheel-editor" onSubmit={e=>{e.preventDefault();void save();}}>
   <h2>{draft.id?'Modifier la roue':'Nouvelle roue'}</h2>
   <div className="form-row"><label>Nom<input className="field" required maxLength={60} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <label>Prix ₽<input className="field" inputMode="numeric" value={draft.price} onChange={e=>setDraft({...draft,price:Number(e.target.value.replace(/\D/g,''))})}/></label></div>
   <label>Description<input className="field" maxLength={300} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
   <div className="form-row"><label>Ton<select className="field" value={draft.tone} onChange={e=>{const tone=e.target.value as Draft['tone'];setDraft({...draft,tone,icon:draft.icon===toneIcon(draft.tone)?toneIcon(tone):draft.icon});}}>{Object.entries(wheelToneLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label className="check"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Active</label></div>
   <fieldset className="icon-picker"><legend>Icône</legend>{ticketIcons.map(i=><button type="button" key={i} aria-pressed={draft.icon===i} onClick={()=>setDraft({...draft,icon:i})}><TicketIcon icon={i} size={34}/></button>)}</fieldset>
   <h3>Gages (même probabilité par défaut)</h3>
   {draft.gages.map((g,i)=><fieldset key={i} className="gage-editor">
    <div className="form-row"><label>Nom<input className="field" required maxLength={80} value={g.name} onChange={e=>patchGage(i,{name:e.target.value})}/></label>
     <label>Effet<select className="field" value={g.handler} onChange={e=>{const h=e.target.value as GageHandler;patchGage(i,{handler:h,params:defaultParams[h]});}}>{gageHandlers.map(h=><option key={h} value={h}>{gageHandlerInfo[h].label}</option>)}</select></label></div>
    <small className="muted">{gageHandlerInfo[g.handler].help}</small>
    <div className="form-row"><GageParams handler={g.handler} params={g.params} library={library} onChange={params=>patchGage(i,{params})}/>
     <label>Poids<input className="field" inputMode="numeric" value={g.weight} onChange={e=>patchGage(i,{weight:Math.max(1,Number(e.target.value.replace(/\D/g,''))||1)})}/></label></div>
    <label>Description<input className="field" maxLength={500} value={g.description} onChange={e=>patchGage(i,{description:e.target.value})}/></label>
    {draft.gages.length>1&&<button type="button" className="btn danger" onClick={()=>setDraft({...draft,gages:draft.gages.filter((_,j)=>j!==i)})}>Retirer ce gage</button>}
   </fieldset>)}
   <button type="button" className="btn" onClick={()=>setDraft({...draft,gages:[...draft.gages,{name:'',description:'',handler:'NOTICE',params:{},weight:1}]})}><Plus size={15}/>Ajouter un gage</button>
   <div className="dialog-actions"><button type="button" className="btn" onClick={()=>setDraft(null)}>Annuler</button><button className="btn primary" disabled={busy}>Enregistrer</button></div>
  </form></div>}
 </section>;
}
