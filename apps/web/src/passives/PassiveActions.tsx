import {useState} from 'react';
import {passiveRarityLabels,type OwnedPassive,type PassiveActInput} from '@pokerace/shared';
import {api} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {useLive} from '../realtime/live-context';
import {useToast} from '../components/toast-context';
import {definition,isConsumed,usePassives} from './passives-data';

/** Explicit uses of a passive, for its holder (or an admin acting for them). The server checks everything again. */
export function PassiveActions({owned}:{owned:OwnedPassive}){
 const {account}=useSession();const {lobby}=useLobby();const {members,views}=useLive();const toast=useToast();const snapshot=usePassives();
 const [busy,setBusy]=useState(false),[target,setTarget]=useState(''),[pick,setPick]=useState(''),[slot,setSlot]=useState(0),[safe,setSafe]=useState(false),[move,setMove]=useState(0);
 const mine=owned.accountId===account.id;
 if(!mine&&!account.admin)return null;
 const p=owned.progress,others=members.filter(m=>m.id!==owned.accountId);
 const act=async(body:Omit<PassiveActInput,'accountId'>,confirm?:string)=>{
  if(confirm&&!window.confirm(confirm))return;
  setBusy(true);
  // The result is announced to the whole lobby by the server: no second local toast.
  try{await api(`/api/lobbies/${lobby.id}/passives/${owned.passiveId}/act`,{method:'POST',body:{...body,...(mine?{}:{accountId:owned.accountId})}});}
  catch(e){toast.error(e);}finally{setBusy(false);}
 };
 const party=views.find(v=>v.accountId===owned.accountId)?.display.state.party??[];
 const pokemonSelect=<select className="field" aria-label="Pokémon" value={slot} onChange={e=>setSlot(Number(e.target.value))}><option value={0}>Pokémon…</option>{party.map(m=><option key={m.slot} value={m.slot}>{m.nickname||m.speciesName} · niv. {m.level}</option>)}</select>;
 const playerSelect=<select className="field" aria-label="Joueur" value={target} onChange={e=>{setTarget(e.target.value);setPick('');}}><option value="">Joueur…</option>{others.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>;
 switch(owned.passiveId){
  case 'usurper':{
   if(isConsumed(owned))return null;
   const copyable=snapshot.owned.filter(o=>o.accountId===target&&definition(o.passiveId)?.rarity!=='LEGENDARY'&&!snapshot.owned.some(m=>m.accountId===owned.accountId&&m.passiveId===o.passiveId));
   return <div className="passive-actions">{playerSelect}
    <select className="field" aria-label="Passif à copier" value={pick} onChange={e=>setPick(e.target.value)} disabled={!target}><option value="">Passif…</option>{copyable.map(o=><option key={o.id} value={o.passiveId}>{definition(o.passiveId)?.name}</option>)}</select>
    <button className="btn primary" disabled={busy||!target||!pick} onClick={()=>void act({action:'copy',targetId:target,passiveId:pick},'Usurpateur ne s’utilise qu’une fois. Copier ce passif ?')}>Copier</button></div>;
  }
  case 'fate-link':
   if(p.partner)return null;
   return <div className="passive-actions">{playerSelect}<button className="btn primary" disabled={busy||!target} onClick={()=>void act({action:'link',targetId:target},'Le lien est définitif. Confirmer ?')}>Se lier</button></div>;
  case 'champion-crown':{
   const offer=Array.isArray(p.offer)?p.offer as string[]:[];
   if(!offer.length||!mine)return null;
   return <div className="passive-actions">{offer.map(id=>{const d=definition(id);return d&&<button key={id} className="btn" disabled={busy} title={d.description} onClick={()=>void act({action:'choose',passiveId:id})}>{passiveRarityLabels[d.rarity]} · {d.name}</button>;})}</div>;
  }
  case 'paradox':
   if(isConsumed(owned))return null;
   return <div className="passive-actions"><button className="btn primary" disabled={busy} onClick={()=>void act({action:'undo'},'Paradoxe ne s’utilise qu’une fois : annuler la dernière action négative réversible ?')}>Annuler la dernière action négative</button></div>;
  case 'bound-soul':{
   return <div className="passive-actions">
    {mine&&<><select className="field" aria-label="Pokémon à lier" value={slot} onChange={e=>setSlot(Number(e.target.value))}><option value={0}>Pokémon…</option>{party.map(m=><option key={m.slot} value={m.slot}>{m.nickname||m.speciesName} · niv. {m.level}</option>)}</select>
     <button className="btn" disabled={busy||!slot} onClick={()=>void act({action:'bind',slot})}>{p.bound?'Lier à la place':'Lier'}</button></>}
    {account.admin&&p.ready===true&&<><label className="check"><input type="checkbox" checked={safe} onChange={e=>setSafe(e.target.checked)}/>Le joueur n’est pas en combat</label>
     <button className="btn primary" disabled={busy||!safe} onClick={()=>void act({action:'reinject',confirmOutOfBattle:true})}>Réinjecter</button></>}
   </div>;
  }
  case 'alchemist':{
   const natures=Array.isArray(p.natures)?p.natures as number[]:[],labels=(p.natureNames as string[]|undefined)??[];
   if(p.used||!natures.length)return null;
   return <div className="passive-actions">{pokemonSelect}{natures.map((n,i)=><button key={n} className="btn" disabled={busy||!slot}
    onClick={()=>void act({action:'nature',slot,nature:n},`Alchimiste ne sert qu’une fois par Run. Nature ${labels[i]} pour ce Pokémon ?`)}>{labels[i]}</button>)}</div>;
  }
  case 'unstable-dna':
   if(!Number(p.charges))return null;
   return <div className="passive-actions">{pokemonSelect}<button className="btn primary" disabled={busy||!slot} onClick={()=>void act({action:'iv',slot})}>+{definition(owned.passiveId)?.params.gain??2} sur une IV</button></div>;
  case 'mutagen':{
   const offer=p.offer as {moves:{id:number;name:string}[];known:(string|null)[];pokemon:string}|null|undefined;
   if(p.used)return null;
   if(!offer)return <div className="passive-actions">{pokemonSelect}<button className="btn" disabled={busy||!slot} onClick={()=>void act({action:'offer',slot},'Mutagène ne sert qu’une fois par Run : l’offre est tirée pour ce Pokémon. Continuer ?')}>Proposer 3 attaques</button></div>;
   return <div className="passive-actions">
    <select className="field" aria-label="Attaque remplacée" value={move} onChange={e=>setMove(Number(e.target.value))}>{offer.known.map((k,i)=><option key={i} value={i}>{k?`Remplacer ${k}`:'Emplacement libre'}</option>)}</select>
    {offer.moves.map(m=><button key={m.id} className="btn" disabled={busy} onClick={()=>void act({action:'mutate',moveIndex:move,moveId:m.id},`${offer.pokemon} apprend ${m.name}${offer.known[move]?` à la place de ${offer.known[move]}`:''} ?`)}>{m.name}</button>)}
   </div>;
  }
  default:return null;
 }
}
