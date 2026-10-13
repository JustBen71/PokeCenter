import {useState} from 'react';
import {battleSpriteIds,battleSpriteLabels,boardLegendaryLabels,boardLegendaryModes,boardRewardRules,boardTeamStatusLabels,gen3Items,isLegendary,type BoardBatchInput,
 type BattleSpriteId,type BoardSlot,type BoardSnapshot,type BoardTeam} from '@pokerace/shared';
import {api} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {PokemonSelect} from '../PokemonSelect';
import {PokeDollar} from '../components/PokeDollar';
import names from '../species-fr.json';
import {useMoveNames} from '../pokemon/move-names';
import {spriteUrl} from '../pokemon/PokemonSheet';
import {useBattles} from './battles-data';

const speciesName=(id:number)=>names[String(id) as keyof typeof names]??`#${id}`;
const fmt=(n:number)=>n.toLocaleString('fr-FR');
const fixed=():BoardSlot=>({mode:'FIXED',speciesId:25,level:10,moves:[],heldItem:0,ev:0});
const random=():BoardSlot=>({mode:'RANDOM',minLevel:10,maxLevel:15,legendary:'NO'});
const int=(v:string,min:number,max:number)=>Math.min(max,Math.max(min,Number(v.replace(/\D/g,''))||min));

// One place of a new team: a chosen Pokémon (moves optional) or a draw in a level range.
function SlotEditor({slot,onChange,onRemove}:{slot:BoardSlot;onChange:(s:BoardSlot)=>void;onRemove?:()=>void}){
 return <fieldset className="battle-slot">
  <div className="form-row">
   <label>Place<select className="field" value={slot.mode} onChange={e=>onChange(e.target.value==='FIXED'?fixed():random())}><option value="FIXED">Pokémon choisi</option><option value="RANDOM">Au hasard</option></select></label>
   {slot.mode==='FIXED'?<>
    <label>Niveau<input className="field" inputMode="numeric" value={slot.level} onChange={e=>onChange({...slot,level:int(e.target.value,1,100)})}/></label>
    <label>Attaques (n°, vide = par défaut)<input className="field" value={slot.moves.join(', ')} onChange={e=>onChange({...slot,moves:[...new Set(e.target.value.split(/[,\s]+/).map(Number).filter(m=>m>=1&&m<=354))].slice(0,4)})}/></label>
   </>:<>
    <label>Niveau min<input className="field" inputMode="numeric" value={slot.minLevel} onChange={e=>onChange({...slot,minLevel:int(e.target.value,1,100)})}/></label>
    <label>Niveau max<input className="field" inputMode="numeric" value={slot.maxLevel} onChange={e=>onChange({...slot,maxLevel:int(e.target.value,1,100)})}/></label>
    <label>Légendaire<select className="field" value={slot.legendary} onChange={e=>onChange({...slot,legendary:e.target.value as typeof boardLegendaryModes[number]})}>{boardLegendaryModes.map(m=><option key={m} value={m}>{boardLegendaryLabels[m]}</option>)}</select></label>
   </>}
  </div>
  {slot.mode==='FIXED'&&<PokemonSelect value={slot.speciesId} onChange={speciesId=>onChange({...slot,speciesId})}/>}
  {onRemove&&<div className="row-actions"><button type="button" className="btn danger" onClick={onRemove}>Retirer la place</button></div>}
 </fieldset>;
}

function NewTeam(){
 const {lobby}=useLobby();const toast=useToast();
 const [name,setName]=useState(''),[sprite,setSprite]=useState<BattleSpriteId|''>(''),[slots,setSlots]=useState<BoardSlot[]>([random()]),[reward,setReward]=useState(''),[blind,setBlind]=useState(false),[busy,setBusy]=useState(false);
 const create=async()=>{
  setBusy(true);
  try{
   // The lobby notification announces it to everybody, the author included.
   await api<BoardTeam>(`/api/lobbies/${lobby.id}/board`,{method:'POST',body:{trainer:{...(name.trim()?{name:name.trim()}:{}),...(sprite?{spriteId:sprite}:{})},slots,blind,...(reward.trim()?{reward:Number(reward)}:{})}});
   setSlots([random()]);setReward('');
  }catch(e){toast.error(e);}finally{setBusy(false);}
 };
 const r=boardRewardRules;
 return <section className="panel board-new">
  <header className="panel-head"><h2>Nouvelle équipe</h2><small className="muted">Le hasard est tiré à la création : tout le monde voit l’équipe exacte</small></header>
  <form onSubmit={e=>{e.preventDefault();void create();}}>
   <div className="form-row">
    <label>Nom du dresseur<input className="field" maxLength={7} placeholder="DÉFI" value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Apparence<select className="field" aria-label="Apparence du dresseur" value={sprite} onChange={e=>setSprite(e.target.value as BattleSpriteId)}><option value="">au hasard</option>{battleSpriteIds.map(s=><option key={s} value={s}>{battleSpriteLabels[s]}</option>)}</select></label>
    <label>Récompense (₽)<input className="field" inputMode="numeric" placeholder="calculée" value={reward} onChange={e=>setReward(e.target.value.replace(/\D/g,'').slice(0,6))}/></label>
    <label className="check"><input type="checkbox" checked={blind} onChange={e=>setBlind(e.target.checked)}/> À l’aveugle (les joueurs ne voient que le niveau moyen)</label>
   </div>
   <div className="battle-slots">{slots.map((s,i)=><SlotEditor key={i} slot={s} onChange={n=>setSlots(all=>all.map((x,j)=>j===i?n:x))} onRemove={slots.length>1?()=>setSlots(all=>all.filter((_,j)=>j!==i)):undefined}/>)}
    {slots.length<6&&<button type="button" className="btn" onClick={()=>setSlots(all=>[...all,random()])}>Ajouter une place</button>}</div>
   <p className="muted">Récompense calculée : {r.perLevel} ₽ par niveau, +{r.perExtraPokemon*100} % par Pokémon au-delà du premier, +{fmt(r.perLegendary)} ₽ par légendaire, + la valeur des objets tenus (chaque place tirée au hasard reçoit un objet), ×{r.blind} à l’aveugle, arrondie à {r.round} ₽.</p>
   <button className="btn primary" disabled={busy}>Mettre au tableau</button>
  </form>
 </section>;
}

const itemName=(id:number)=>gen3Items.find(([item])=>item===id)?.[2]??`objet #${id}`;

/** Admin: generates many random teams at once (popup). */
function BatchButton(){
 const {lobby}=useLobby();const toast=useToast();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const [f,setF]=useState<BoardBatchInput>({count:10,minLevel:10,maxLevel:30,spread:3,minSize:3,maxSize:6,legendary:'NO',blindPercent:20});
 const num=(k:keyof BoardBatchInput,min:number,max:number)=><input className="field" type="number" min={min} max={max} required value={f[k] as number} onChange={e=>setF(x=>({...x,[k]:Number(e.target.value)}))}/>;
 const go=async()=>{
  setBusy(true);
  try{const r=await api<{teams:BoardTeam[]}>(`/api/lobbies/${lobby.id}/board/batch`,{method:'POST',body:f});toast.success(`${r.teams.length} combats ajoutés au tableau`);setOpen(false);}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 return <>
  <p><button className="btn" onClick={()=>setOpen(true)}>Générer plusieurs combats…</button></p>
  {open&&<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setOpen(false);}}><form className="dialog board-dialog" onSubmit={e=>{e.preventDefault();void go();}}>
   <h2>Générer des combats</h2>
   <p className="muted">Pour chaque équipe, le premier Pokémon est tiré entre le niveau min et max ; les autres sont à ± l’écart de ce niveau. Chaque Pokémon tient un objet au hasard.</p>
   <label>Nombre de combats{num('count',1,50)}</label>
   <div className="form-row"><label>Niveau min{num('minLevel',1,100)}</label><label>Niveau max{num('maxLevel',1,100)}</label><label>Écart ±{num('spread',0,30)}</label></div>
   <div className="form-row"><label>Pokémon par équipe (min){num('minSize',1,6)}</label><label>(max){num('maxSize',1,6)}</label></div>
   <label>Légendaires<select className="field" value={f.legendary} onChange={e=>setF(x=>({...x,legendary:e.target.value as BoardBatchInput['legendary']}))}>{boardLegendaryModes.map(m=><option key={m} value={m}>{boardLegendaryLabels[m]}</option>)}</select></label>
   <label>Part à l’aveugle (%){num('blindPercent',0,100)}</label>
   <div className="dialog-actions"><button type="button" className="btn" disabled={busy} onClick={()=>setOpen(false)}>Annuler</button><button className="btn primary" disabled={busy||f.minLevel>f.maxLevel||f.minSize>f.maxSize}>{busy?'Génération…':`Générer ${f.count} combats`}</button></div>
  </form></div>}
 </>;
}

function TeamCard({team}:{team:BoardTeam}){
 const {account}=useSession();const {lobby}=useLobby();const {members}=useLive();const toast=useToast();const battles=useBattles();
 const [busy,setBusy]=useState(false);
 const moves=useMoveNames(team.party.flatMap(p=>p.moves).join(','));
 const hidden=team.blind&&team.party.length===0;
 const who=(id:string|null)=>members.find(m=>m.id===id)?.name??'—';
 const base=`/api/lobbies/${lobby.id}/board/${team.id}`;
 const act=async(path:string,done:string,body?:object)=>{setBusy(true);try{await api(`${base}/${path}`,{method:'POST',body});toast.success(done);}catch(e){toast.error(e);}finally{setBusy(false);}};
 const mine=team.challengerId===account.id;
 const encounter=battles.encounters.find(e=>e.id===team.encounterId);
 const waiting=mine&&encounter?.status==='WAITING_SAFE_STATE';
 const challenge=()=>window.confirm(`Affronter ${team.trainer.name} (${hidden?`à l’aveugle, niv. moyen ${team.averageLevel}`:`${team.party.length} Pokémon`}) ?\nVictoire : ${fmt(team.reward)} ₽. Défaite : ta Run est perdue.`)&&void act('challenge',`Défi accepté : le combat démarre dès que tu es libre sur la carte`);
 const changeReward=()=>{const v=window.prompt(`Nouvelle récompense pour ${team.trainer.name} (suggérée : ${fmt(team.suggestedReward)} ₽)`,String(team.reward));if(v!==null&&/^\d{1,6}$/.test(v.trim()))void act('reward','Récompense modifiée',{reward:Number(v.trim())});};
 return <li className={`panel board-team ${team.status.toLowerCase()}`}>
  <header className="board-team-head">
   <div><strong>{team.trainer.name}</strong><small className="muted">{battleSpriteLabels[team.trainer.spriteId]}{team.origin==='WHEEL'?' · tiré par une roue':''}{team.blind?' · 🙈 à l’aveugle':''}</small></div>
   <span className={`badge board-${team.status.toLowerCase()}`}>{boardTeamStatusLabels[team.status]}</span>
  </header>
  {hidden?<p className="battle-banner">🙈 Équipe inconnue · niveau moyen {team.averageLevel}</p>:<ul className="battle-team">{team.party.map((p,i)=><li key={i}>
   <img src={spriteUrl({speciesId:p.speciesId,shiny:false})} alt=""/>
   <span><strong>{speciesName(p.speciesId)}</strong> · niv. {p.level}{isLegendary(p.speciesId)&&<em className="legendary"> ★ légendaire</em>}<small>{p.heldItem?`Tient : ${itemName(p.heldItem)}`:''}</small></span>
  </li>)}</ul>}
  {account.admin&&team.party.some(p=>p.moves.length)&&<details className="muted"><summary>Attaques (admin)</summary>{team.party.map((p,i)=><small key={i} style={{display:'block'}}>{speciesName(p.speciesId)} : {p.moves.map(m=>moves[m]??`#${m}`).join(', ')}</small>)}</details>}
  <p className="board-reward"><PokeDollar size={16}/>{fmt(team.reward)}{team.status==='WON'&&<small className="muted"> · {team.rewardStatus==='PAID'?'versée':team.rewardStatus==='REVIEW'?'à vérifier':'en cours de versement'}</small>}</p>
  {team.status==='CHALLENGED'&&<p className="battle-banner">{mine?(waiting?'Ton combat démarre dès que tu es libre sur la carte':'Ton combat est en cours'):`${who(team.challengerId)} affronte cette équipe`}</p>}
  {team.status==='WON'&&<p className="muted">🏆 Remportée par {who(team.winnerId)}</p>}
  <div className="row-actions">
   {team.status==='OPEN'&&<button className="btn primary" disabled={busy} onClick={challenge}>Affronter</button>}
   {waiting&&<button className="btn" disabled={busy} onClick={()=>window.confirm('Abandonner ce défi ? L’équipe revient au tableau.')&&void act('forfeit','Défi abandonné')}>Abandonner</button>}
   {account.admin&&team.status==='OPEN'&&<>
    {team.slots.some(s=>s.mode==='RANDOM')&&<button className="btn" disabled={busy} onClick={()=>void act('reroll','Nouveau tirage')}>Nouveau tirage</button>}
    <button className="btn" disabled={busy} onClick={changeReward}>Récompense</button>
    <button className="btn danger" disabled={busy} onClick={()=>window.confirm(`Retirer ${team.trainer.name} du tableau ?`)&&void act('withdraw','Équipe retirée')}>Retirer</button>
   </>}
  </div>
 </li>;
}

/** Tableau des combats: open teams first, then the ones in progress, then the history. */
export function BoardPage(){
 const {account}=useSession();
 const {teams}=useLiveTopic<BoardSnapshot>('board',{teams:[]});
 const order={OPEN:0,CHALLENGED:1,WON:2,WITHDRAWN:3};
 const visible=teams.filter(t=>account.admin||t.status!=='WITHDRAWN').sort((a,b)=>order[a.status]-order[b.status]);
 const open=visible.filter(t=>t.status!=='WON'&&t.status!=='WITHDRAWN'),done=visible.filter(t=>t.status==='WON'||t.status==='WITHDRAWN');
 return <section className="board-page">
  <header className="page-head"><div><p className="eyebrow">PREMIER ARRIVÉ, PREMIER SERVI</p><h1>Tableau des combats</h1>
   <p className="muted">Choisis une équipe et affronte-la dans ton jeu : victoire = la récompense, défaite = ta Run est perdue. Le combat démarre dès que tu es libre sur la carte.</p></div></header>
  {account.admin&&<><NewTeam/><BatchButton/></>}
  {open.length===0?<p className="muted">Aucune équipe à affronter pour l’instant.</p>:<ul className="board-grid">{open.map(t=><TeamCard key={t.id} team={t}/>)}</ul>}
  {done.length>0&&<><h2>Historique</h2><ul className="board-grid">{done.map(t=><TeamCard key={t.id} team={t}/>)}</ul></>}
 </section>;
}
