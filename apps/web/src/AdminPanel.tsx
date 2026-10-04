import {apiFetch} from './api/client';
import {Save} from "lucide-react";
import {useEffect,useState} from "react";
import type {PokemonInjection,PublicPlayer} from "@pokerace/shared";

import {PokemonSelect} from "./PokemonSelect";
import {buildPokemon,type BuiltPokemon} from "./pokemon-builder";

const initialPokemon:PokemonInjection={playerId:"joueur-01",slot:1,speciesId:255,nickname:"POUSSIFEU",level:5,experience:135,currentHp:19,stats:{maxHp:19,attack:11,defense:9,speed:9,spAttack:12,spDefense:10},moves:[{id:10,pp:35},{id:45,pp:40},{id:0,pp:0},{id:0,pp:0}],heldItem:0,abilitySlot:0,nature:0,friendship:70,otName:"POKER",trainerId:12345,secretId:54321,ivs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},shiny:false};
const Num=({label,value,onChange,min=0,max=999,disabled=false}:{label:string,value:number,onChange:(n:number)=>void,min?:number,max?:number,disabled?:boolean})=><label>{label}<input type="number" disabled={disabled} min={min} max={max} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
export function AdminPanel({onSaved}:{onSaved:()=>void}){
 const [open,setOpen]=useState(false),[form,setForm]=useState<PokemonInjection>(initialPokemon),[message,setMessage]=useState("");
 const [mode,setMode]=useState<'manual'|'auto'>('auto');
 const [generated,setGenerated]=useState<{key:string;data:BuiltPokemon}|null>(null);
 const [autoError,setAutoError]=useState(''),[retry,setRetry]=useState(0),[sending,setSending]=useState(false);
 const autoKey=JSON.stringify([form.speciesId,form.level,form.nature,form.ivs,form.evs]);
 const autoReady=mode==='manual'||generated?.key===autoKey;
 useEffect(()=>{
   if(mode!=='auto') return;
   let active=true;
   setGenerated(null);setAutoError('');
   const timer=setTimeout(()=>{
     buildPokemon(form).then(data=>{
       if(!active)return;
       setForm(current=>({...current,stats:data.stats,currentHp:data.stats.maxHp,experience:data.experience,moves:data.moves}));
       setGenerated({key:autoKey,data});
     }).catch(error=>{if(active)setAutoError(error instanceof Error?error.message:'Erreur PokéAPI');});
   },300);
   return ()=>{active=false;clearTimeout(timer);};
 },[mode,autoKey,retry]);
 const patch=(next:Partial<PokemonInjection>)=>setForm(v=>({...v,...next}));
 const submit=async(e:React.FormEvent)=>{
   e.preventDefault();if(!autoReady||sending)return;
   setSending(true);setMessage("Envoi…");
   try {
     const response=await apiFetch("/api/library",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({label:form.nickname,template:form})});
     const body=await response.json();setMessage(response.ok?"Modèle enregistré dans la bibliothèque.":`Erreur : ${body.error}`);if(response.ok)onSaved();
   } catch {setMessage("Connexion au serveur impossible. Vérifiez la bibliothèque avant de réessayer.");}
   finally {setSending(false);}
 };

 return <section className="admin"><button className="admin-toggle" onClick={()=>setOpen(v=>!v)}>{open?"Fermer le créateur":"Créer un Pokémon"}</button>{open&&<form onSubmit={submit}><div className="admin-head"><div><p className="kicker">CRÉATION</p><h2>Créateur de Pokémon</h2><p>Créez un modèle réutilisable. Le joueur et l’emplacement seront choisis à la réinjection.</p></div></div><label>Mode de création<select value={mode} onChange={e=>{setGenerated(null);setMode(e.target.value as 'manual'|'auto');}}><option value="manual">Manuel — toutes les valeurs sont libres</option><option value="auto">Automatique — Pokémon et niveau (Émeraude)</option></select></label>{mode==='auto'&&<div aria-live="polite"><p>Statistiques calculées selon le niveau, la nature, les IV et les EV ci-dessous. PV pleins, expérience au début du niveau. Les quatre dernières attaques apprises par niveau dans Émeraude sont proposées ; vous pouvez les remplacer par d’autres attaques déjà apprises.</p><p>Les CT, tuteurs et attaques par reproduction restent disponibles par identifiant en mode manuel. Passer en manuel conserve les valeurs calculées.</p>{autoError?<p role="alert">{autoError} <button type="button" onClick={()=>setRetry(v=>v+1)}>Réessayer</button></p>:!autoReady?<p>Chargement PokéAPI et calcul…</p>:<p><strong>{generated?.data.name}</strong> — niveau {form.level} · <a href="https://pokeapi.co/docs/v2" target="_blank" rel="noreferrer">Données PokéAPI</a></p>}</div>}<div className="form-grid"><PokemonSelect value={form.speciesId} onChange={speciesId=>patch({speciesId})}/><label>Surnom<input value={form.nickname} maxLength={10} onChange={e=>patch({nickname:e.target.value})}/></label><Num label="Niveau" value={form.level} min={1} max={100} onChange={level=>patch({level})}/><Num disabled={mode==='auto'} label="Expérience" value={form.experience} max={1640000} onChange={experience=>patch({experience})}/><Num disabled={mode==='auto'} label="PV actuels" value={form.currentHp} onChange={currentHp=>patch({currentHp})}/><Num disabled={mode==='auto'} label="PV max" value={form.stats.maxHp} onChange={maxHp=>patch({stats:{...form.stats,maxHp}})}/><Num disabled={mode==='auto'} label="Attaque" value={form.stats.attack} onChange={attack=>patch({stats:{...form.stats,attack}})}/><Num disabled={mode==='auto'} label="Défense" value={form.stats.defense} onChange={defense=>patch({stats:{...form.stats,defense}})}/><Num disabled={mode==='auto'} label="Vitesse" value={form.stats.speed} onChange={speed=>patch({stats:{...form.stats,speed}})}/><Num disabled={mode==='auto'} label="Att. Spé." value={form.stats.spAttack} onChange={spAttack=>patch({stats:{...form.stats,spAttack}})}/><Num disabled={mode==='auto'} label="Déf. Spé." value={form.stats.spDefense} onChange={spDefense=>patch({stats:{...form.stats,spDefense}})}/><Num label="Objet" value={form.heldItem} max={376} onChange={heldItem=>patch({heldItem})}/><Num label="Nature (0–24)" value={form.nature} max={24} onChange={nature=>patch({nature})}/><Num label="Talent (0/1)" value={form.abilitySlot} max={1} onChange={abilitySlot=>patch({abilitySlot})}/><Num label="Bonheur" value={form.friendship} max={255} onChange={friendship=>patch({friendship})}/><label>DO<input value={form.otName} maxLength={7} onChange={e=>patch({otName:e.target.value})}/></label><Num label="ID dresseur" value={form.trainerId} max={65535} onChange={trainerId=>patch({trainerId})}/><Num label="ID secret" value={form.secretId} max={65535} onChange={secretId=>patch({secretId})}/><label className="check"><input type="checkbox" checked={form.shiny} onChange={e=>patch({shiny:e.target.checked})}/> Chromatique</label></div><h3>Attaques</h3><div className="form-grid">{form.moves.map((move,i)=><div className="move" key={i}>{mode==='auto'?<label>Attaque {i+1}<select disabled={!autoReady} value={move.id} onChange={e=>{const chosen=generated?.data.choices.find(m=>m.id===Number(e.target.value));const moves=[...form.moves];moves[i]=chosen?{id:chosen.id,pp:chosen.pp}:{id:0,pp:0};patch({moves});}}><option value={0}>Aucune</option>{generated?.data.choices.map(m=><option key={m.id} value={m.id} disabled={form.moves.some((other,j)=>j!==i&&other.id===m.id)}>{m.name} — niv. {m.level} · {m.pp} PP</option>)}</select></label>:<Num label={`Attaque ${i+1}`} value={move.id} max={354} onChange={id=>{const moves=[...form.moves];moves[i]={...move,id};patch({moves})}}/>}<Num disabled={mode==='auto'} label="PP" value={move.pp} max={99} onChange={pp=>{const moves=[...form.moves];moves[i]={...move,pp};patch({moves})}}/></div>)}</div><h3>IV</h3><div className="form-grid compact">{Object.entries(form.ivs).map(([key,value])=><Num key={key} label={key} value={value} max={31} onChange={n=>patch({ivs:{...form.ivs,[key]:n}})}/>)}</div><h3>EV</h3><div className="form-grid compact">{Object.entries(form.evs).map(([key,value])=><Num key={key} label={key} value={value} max={255} onChange={n=>patch({evs:{...form.evs,[key]:n}})}/>)}</div><div className="admin-actions"><button type="submit" disabled={!autoReady||sending} title="Sauvegarder dans la bibliothèque" aria-label="Sauvegarder dans la bibliothèque"><Save size={18}/></button><span>{message}</span></div></form>}</section>;
}
