import {useState} from 'react';
import {battleScalingLabels,battleScalingModes,battleSourceLabels,battleSpriteIds,battleSpriteLabels,battleStatusLabels,levelMoves,
 type BattleBuilder,type BattleEncounter,type BattlePokemonSpec,type BattlePreview,type BattleScalingSpec,type BattleSpriteId,type PokemonData} from '@pokerace/shared';
import {api} from '../api/client';
import {useLobby} from '../lobby/lobby-context';
import {useLive} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {PokemonSelect} from '../PokemonSelect';
import names from '../species-fr.json';
import {natureNames} from '../pokemon/labels';
import {useMoveNames} from '../pokemon/move-names';
import {spriteUrl} from '../pokemon/PokemonSheet';
import {statusClass,useBattles} from './battles-data';

type BuilderType=BattleBuilder['type'];
const builderLabels:Record<BuilderType,string>={MIRROR:'Miroir (sa propre équipe)',OTHER_PLAYER:'Équipe d’un joueur',LEADER:'Équipe du #1',CUSTOM:'Équipe personnalisée'};
const speciesName=(id:number)=>names[String(id) as keyof typeof names]??`#${id}`;
const blank=():BattlePokemonSpec=>({speciesId:25,level:10,moves:[84],heldItem:0,nature:0,ev:0});

// Final team as the game will receive it: sprite, species, level, nature, moves.
function Team({party}:{party:BattlePokemonSpec[]}){
 const moves=useMoveNames(party.flatMap(p=>p.moves).join(','));
 return <ul className="battle-team">{party.map((p,i)=><li key={i}>
  <img src={spriteUrl({speciesId:p.speciesId,shiny:false})} alt=""/>
  <span><strong>{speciesName(p.speciesId)}</strong> · niv. {p.level}<small>{natureNames[p.nature]} · {p.moves.map(m=>moves[m]??`#${m}`).join(', ')}{p.heldItem?` · objet #${p.heldItem}`:''}{p.ev?` · EV ${p.ev}`:''}</small></span>
 </li>)}</ul>;
}

// One custom opponent slot. Default moves: the last four Emerald level-up moves (PokéAPI), as the library creator.
function SlotEditor({mon,onChange,onRemove}:{mon:BattlePokemonSpec;onChange:(m:BattlePokemonSpec)=>void;onRemove?:()=>void}){
 const toast=useToast();const [loading,setLoading]=useState(false);
 const number=(value:string,min:number,max:number)=>Math.min(max,Math.max(min,Number(value.replace(/\D/g,''))||min));
 const defaults=async()=>{
  setLoading(true);
  try{
   const r=await fetch(`https://pokeapi.co/api/v2/pokemon/${mon.speciesId}/`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error();
   const learned=levelMoves(await r.json() as PokemonData,mon.level);
   const ids=[...new Set(learned.map(m=>m.id))].slice(-4);
   if(ids.length)onChange({...mon,moves:ids});
  }catch{toast.error(new Error('PokéAPI indisponible : saisissez les attaques par leur numéro.'));}finally{setLoading(false);}
 };
 return <fieldset className="battle-slot">
  <PokemonSelect value={mon.speciesId} onChange={speciesId=>onChange({...mon,speciesId})}/>
  <div className="form-row">
   <label>Niveau<input className="field" inputMode="numeric" value={mon.level} onChange={e=>onChange({...mon,level:number(e.target.value,1,100)})}/></label>
   <label>Nature<select className="field" value={mon.nature} onChange={e=>onChange({...mon,nature:Number(e.target.value)})}>{natureNames.map((n,i)=><option key={n} value={i}>{n}</option>)}</select></label>
   <label>Attaques (n°)<input className="field" value={mon.moves.join(', ')} onChange={e=>onChange({...mon,moves:[...new Set(e.target.value.split(/[,\s]+/).map(Number).filter(m=>m>=1&&m<=354))].slice(0,4)})}/></label>
   <label>Objet (n°)<input className="field" inputMode="numeric" value={mon.heldItem} onChange={e=>onChange({...mon,heldItem:number(e.target.value,0,376)})}/></label>
   <label>EV<input className="field" inputMode="numeric" value={mon.ev} onChange={e=>onChange({...mon,ev:number(e.target.value,0,255)})}/></label>
  </div>
  <div className="row-actions"><button type="button" className="btn" disabled={loading} onClick={()=>void defaults()}>Attaques par défaut</button>{onRemove&&<button type="button" className="btn danger" onClick={onRemove}>Retirer</button>}</div>
 </fieldset>;
}

/** Gestion → Combat commandité: build, preview exactly what the game will receive, launch, follow. */
export function BattleAdminPanel(){
 const {lobby}=useLobby();const {members}=useLive();const toast=useToast();const {encounters}=useBattles();
 const [accountId,setAccountId]=useState(''),[builder,setBuilder]=useState<BuilderType>('MIRROR'),[opponentId,setOpponentId]=useState('');
 const [party,setParty]=useState<BattlePokemonSpec[]>([blank()]);
 const [scaling,setScaling]=useState<BattleScalingSpec>({mode:'COPY_EXACT',delta:0}),[levels,setLevels]=useState('');
 const [name,setName]=useState(''),[sprite,setSprite]=useState<BattleSpriteId|''>('');
 const [preview,setPreview]=useState<BattlePreview|null>(null),[busy,setBusy]=useState(false);
 const base=`/api/lobbies/${lobby.id}/battles`;
 const who=(id:string|null)=>members.find(m=>m.id===id)?.name??'—';
 const body=()=>({accountId,
  builder:builder==='OTHER_PLAYER'?{type:builder,opponentId}:builder==='CUSTOM'?{type:builder,party}:{type:builder},
  scaling:scaling.mode==='CUSTOM_LEVELS'?{...scaling,levels:levels.split(/[,\s]+/).map(Number).filter(Boolean)}:scaling,
  trainer:{...(name.trim()?{name:name.trim()}:{}),...(sprite?{spriteId:sprite}:{})}});
 const run=async(work:()=>Promise<void>)=>{setBusy(true);try{await work();}catch(e){toast.error(e);}finally{setBusy(false);}};
 const doPreview=()=>run(async()=>setPreview(await api<BattlePreview>(`${base}/preview`,{method:'POST',body:body()})));
 const launch=()=>run(async()=>{
  const created=await api<BattleEncounter>(base,{method:'POST',body:body()});
  await api(`${base}/${created.id}/start`,{method:'POST'});
  toast.success(`Combat de ${who(accountId)} contre ${created.trainer.name} lancé : il démarrera dès que son jeu sera sur la carte`);setPreview(null);
 });
 const cancel=(e:BattleEncounter)=>window.confirm(`Annuler le combat de ${who(e.accountId)} contre ${e.trainer.name} ?`)&&void run(async()=>{await api(`${base}/${e.id}/cancel`,{method:'POST'});toast.success('Combat annulé');});
 const ready=!!accountId&&(builder!=='OTHER_PLAYER'||!!opponentId);
 const changed=()=>setPreview(null);
 return <section className="panel battle-admin">
  <header className="panel-head"><h2>Combat commandité</h2><small className="muted">Vrai combat de dresseur dans la partie du joueur</small></header>
  <p className="muted">Le combat part dès que le joueur est libre sur la carte (sinon il attend). XP, argent, K.O. et défaite suivent les règles du jeu.</p>
  <form onSubmit={e=>{e.preventDefault();void doPreview();}} onChange={changed}>
   <div className="form-row">
    <label>Joueur<select className="field" aria-label="Joueur qui combat" value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Choisir…</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    <label>Adversaire<select className="field" aria-label="Équipe adverse" value={builder} onChange={e=>setBuilder(e.target.value as BuilderType)}>{Object.entries(builderLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    {builder==='OTHER_PLAYER'&&<label>Équipe de<select className="field" aria-label="Joueur copié" value={opponentId} onChange={e=>setOpponentId(e.target.value)}><option value="">Choisir…</option>{members.filter(m=>m.id!==accountId).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
   </div>
   {builder==='CUSTOM'&&<div className="battle-slots">{party.map((mon,i)=><SlotEditor key={i} mon={mon} onChange={m=>{setParty(p=>p.map((x,j)=>j===i?m:x));changed();}} onRemove={party.length>1?()=>{setParty(p=>p.filter((_,j)=>j!==i));changed();}:undefined}/>)}
    {party.length<6&&<button type="button" className="btn" onClick={()=>{setParty(p=>[...p,blank()]);changed();}}>Ajouter un Pokémon</button>}</div>}
   <div className="form-row">
    <label>Niveaux<select className="field" aria-label="Mode de niveaux" value={scaling.mode} onChange={e=>setScaling({...scaling,mode:e.target.value as BattleScalingSpec['mode']})}>{battleScalingModes.map(m=><option key={m} value={m}>{battleScalingLabels[m]}</option>)}</select></label>
    {['DELTA_LEVEL','MATCH_PLAYER_AVERAGE','MATCH_PLAYER_HIGHEST'].includes(scaling.mode)&&<label>± niveaux<input className="field" aria-label="Écart de niveaux" value={scaling.delta} onChange={e=>setScaling({...scaling,delta:Math.max(-99,Math.min(99,Number(e.target.value)||0))})}/></label>}
    {scaling.mode==='CUSTOM_LEVELS'&&<label>Niveaux (un par Pokémon)<input className="field" placeholder="35, 36, 37" value={levels} onChange={e=>setLevels(e.target.value)}/></label>}
    <label>Nom du dresseur<input className="field" maxLength={7} placeholder="automatique" value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Apparence<select className="field" aria-label="Apparence du dresseur" value={sprite} onChange={e=>setSprite(e.target.value as BattleSpriteId)}><option value="">automatique</option>{battleSpriteIds.map(s=><option key={s} value={s}>{battleSpriteLabels[s]}</option>)}</select></label>
   </div>
   <button className="btn" disabled={busy||!ready}>Prévisualiser</button>
  </form>

  {preview&&<div className="battle-preview">
   <h3>{who(accountId).toUpperCase()} <span>VS</span> {preview.spec.trainer.name}</h3>
   <p className="muted">{battleSourceLabels[preview.sourceType]} · {preview.sourceLabel} · {battleSpriteLabels[preview.spec.trainer.spriteId]} · {battleScalingLabels[preview.scaling.mode]}{preview.scaling.delta?` (${preview.scaling.delta>0?'+':''}${preview.scaling.delta})`:''}</p>
   {preview.playerLevels&&<p className="muted">Moyenne de {who(accountId)} : {preview.playerLevels.average} · source : {preview.sourceLevels.join(' / ')}</p>}
   <Team party={preview.spec.party}/>
   <button className="btn primary" disabled={busy} onClick={()=>void launch()}>Lancer le combat</button>
  </div>}

  <h3>Combats</h3>
  {encounters.length===0?<p className="muted">Aucun combat commandité.</p>:<ul className="battle-list">{encounters.slice(0,20).map(e=><li key={e.id}>
   <div><strong>{who(e.accountId)} VS {e.trainer.name}</strong><small>{battleSourceLabels[e.sourceType]} · {e.party.map(p=>p.level).join(' / ')} · {new Date(e.createdAt).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}</small></div>
   <span className={`badge ${statusClass(e)}`}>{battleStatusLabels[e.status]}</span>
   {['CREATED','WAITING_SAFE_STATE','REVIEW'].includes(e.status)&&<button className="btn danger" disabled={busy} onClick={()=>cancel(e)}>Annuler</button>}
  </li>)}</ul>}
 </section>;
}
