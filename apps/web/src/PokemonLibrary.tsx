import {useSession} from './Accounts';
import {apiFetch} from './session';
import {Save,Trash2} from "lucide-react";
import {useEffect,useState} from 'react';
import {decodePokemonCopy,type LibraryEntry,type PublicPlayer} from '@pokerace/shared';
import {AdminPanel} from './AdminPanel';
import speciesNames from './species-fr.json';

export type Capture={pokemon:PublicPlayer['state']['party'][number];source:string;capturedAt:string};
const moveNames=new Map<number,Promise<string>>();
function useMoveNames(ids:string) {
 const [names,setNames]=useState<Record<number,string>>({});
 useEffect(()=>{
  let active=true;setNames({});
  for(const id of ids.split(',').map(Number).filter(Boolean)) {
   if(!moveNames.has(id))moveNames.set(id,fetch(`https://pokeapi.co/api/v2/move/${id}/`,{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(m=>m.names.find((v:{language:{name:string}})=>v.language.name==='fr')?.name??m.name).catch(e=>{moveNames.delete(id);throw e;}));
   moveNames.get(id)!.then(name=>{if(active)setNames(n=>({...n,[id]:name}));}).catch(()=>{});
  }
  return()=>{active=false;};
 },[ids]);
 return names;
}
function LibraryCard({entry,selected,onSelect}:{entry:LibraryEntry;selected:boolean;onSelect:()=>void}) {
 const data=entry.pokemon?.raw?decodePokemonCopy(entry.pokemon.raw):entry.template!;
 const speciesId=entry.pokemon?.speciesId??entry.template!.speciesId;
 const names=useMoveNames(data.moves.map(m=>m.id).join(','));
 return <button className={`library-card ${selected?'selected':''}`} onClick={onSelect} aria-pressed={selected}>
 <img src={`/sprites/${data.shiny?'shiny/':''}${speciesId}.png`} alt={entry.pokemon?.speciesName??speciesNames[String(speciesId) as keyof typeof speciesNames]} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/sprites/fallback.svg';}}/>
 <strong>{entry.label}</strong><small>{entry.pokemon?.speciesName??speciesNames[String(speciesId) as keyof typeof speciesNames]} · Niv. {data.level}{data.shiny?' ✦':''}</small>
 <span className="card-stats">PV {data.currentHp}/{data.stats.maxHp} · ATQ {data.stats.attack} · DÉF {data.stats.defense}<br/>VIT {data.stats.speed} · AS {data.stats.spAttack} · DS {data.stats.spDefense}</span>
 <span className="card-moves">{data.moves.filter(m=>m.id).map(m=>`${names[m.id]??`Attaque #${m.id}`} (${m.pp} PP)`).join(' · ')||'Aucune attaque'}</span>
 <small>{entry.pokemon?'Copie exacte':'Modèle'}</small></button>;
}
function Details({entry}:{entry:Pick<LibraryEntry,'pokemon'|'template'>}) {
 const data=entry.pokemon?.raw?decodePokemonCopy(entry.pokemon.raw):entry.template;
 const names=useMoveNames(data?.moves.map(m=>m.id).join(',')??'');
 if(!data)return <p>Copie complète indisponible. Relancez le client joueur pour charger le nouveau lecteur Lua.</p>;
 return <div className="pokemon-details"><p>Niveau {data.level} · Expérience {data.experience} · PV {data.currentHp}/{data.stats.maxHp} · {data.shiny?'Chromatique':'Non chromatique'}</p>
 <dl>{Object.entries(data.stats).map(([key,value])=><div key={key}><dt>{{maxHp:'PV max',attack:'Attaque',defense:'Défense',speed:'Vitesse',spAttack:'Att. spéciale',spDefense:'Déf. spéciale'}[key]}</dt><dd>{value}</dd></div>)}</dl>
 <h3>Attaques et PP enregistrés</h3><ul>{data.moves.map((m,i)=><li key={i}>{m.id?(names[m.id]??`Attaque n° ${m.id}`):'Aucune'}{m.id?` — ${m.pp} PP`:''}</li>)}</ul>
 <p>Nature n° {data.nature} · Talent {data.abilitySlot} · Objet n° {data.heldItem} · Bonheur {data.friendship}</p>
 <p>DO : {data.otName} · {data.trainerId} / {data.secretId}</p>
 <table><caption>IV et EV</caption><thead><tr><th>Statistique</th><th>IV</th><th>EV</th></tr></thead><tbody>{Object.entries(data.ivs).map(([key,v])=><tr key={key}><th>{key}</th><td>{v}</td><td>{data.evs[key as keyof typeof data.evs]}</td></tr>)}</tbody></table>
 {entry.pokemon&&<p>Copie exacte : identité, langue, origine, PP Plus, rubans et état du Pokémon conservés. Les PV et PP ne sont pas restaurés au maximum.</p>}</div>;
}

export function PokemonLibrary({players,capture,clearCapture}:{players:PublicPlayer[];capture:Capture|null;clearCapture:()=>void}) {
 const {account}=useSession();players=players.filter(p=>account.admin||p.playerId===account.id);
 const [entries,setEntries]=useState<LibraryEntry[]>([]),[selected,setSelected]=useState('');
 const [label,setLabel]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[playerId,setPlayerId]=useState(''),[slot,setSlot]=useState(1);
 const headers={'content-type':'application/json'};
 const entry=entries.find(e=>e.id===selected);
 useEffect(()=>{setLabel(capture?.pokemon.nickname||capture?.pokemon.speciesName||'');setMessage('');},[capture]);
 useEffect(()=>{if(players.length&&!players.some(p=>p.playerId===playerId))setPlayerId(players[0].playerId);},[players,playerId]);
 async function request(path:string,options:RequestInit={}) {
  const response=await apiFetch(path,{...options,headers});const body=await response.json();
  if(!response.ok)throw new Error(body.error??'Échec de la requête');return body;
 }
 useEffect(()=>{void load();},[]);
 async function load() {setBusy(true);try{const rows=await request('/api/library');setEntries(rows);setMessage(rows.length?'':'La bibliothèque est vide.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function saveCapture(){if(!capture?.pokemon.raw)return;setBusy(true);try{
  const saved=await request('/api/library',{method:'POST',body:JSON.stringify({...capture,label})});
  setEntries(await request('/api/library'));setSelected(saved.id);clearCapture();setMessage('Pokémon enregistré avec ses caractéristiques à cet instant.');
 }catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function inject(){if(!entry)return;setBusy(true);try{
  const payload=entry.pokemon?{playerId,slot,raw:entry.pokemon.raw}:{...entry.template,playerId,slot};
  await request('/api/pokemon',{method:'POST',body:JSON.stringify(payload)});setMessage('Réinjection confirmée par mGBA. Sauvegardez dans le jeu pour la conserver.');
 }catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function remove(id:string){setBusy(true);try{await request(`/api/library/${id}`,{method:'DELETE'});setEntries(v=>v.filter(e=>e.id!==id));setSelected('');setMessage('Entrée supprimée.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 return <section className="pokemon-library library-page admin" aria-labelledby="library-title"><header className="library-head"><div><p className="eyebrow">VOS POKÉMON ENREGISTRÉS</p><h1 id="library-title">Bibliothèque Pokémon</h1><p>Consultez vos copies, créez vos modèles et composez les équipes.</p></div></header>
 <button disabled={busy} onClick={load}>Actualiser la bibliothèque</button>
 <p role="status">{message}</p>
 {capture&&<section className="capture"><h3>Enregistrer {capture.pokemon.speciesName}</h3><p>Depuis {capture.source} · données du {new Date(capture.capturedAt).toLocaleString('fr-FR')}. Les données affichées restent celles sélectionnées, même si la partie continue.</p><Details entry={{pokemon:capture.pokemon}}/><label>Nom de l’enregistrement<input maxLength={80} value={label} onChange={e=>setLabel(e.target.value)}/></label><button disabled={busy||!label.trim()||!capture.pokemon.raw} onClick={saveCapture} title="Sauvegarder cette copie" aria-label="Sauvegarder cette copie"><Save size={18}/></button><button onClick={clearCapture}>Annuler</button></section>}
 <div className="library-grid"><nav className="library-cards" aria-label="Pokémon enregistrés">{entries.map(e=><div className="library-card-wrap" key={e.id}><button className="card-delete" disabled={busy} onClick={()=>remove(e.id)} title={`Supprimer ${e.label}`} aria-label={`Supprimer ${e.label}`}><Trash2 size={17}/></button><LibraryCard entry={e} selected={selected===e.id} onSelect={()=>{setSelected(e.id);setMessage('');}}/></div>)}</nav>
 {entry&&<section><h3>{entry.label}</h3><p>{entry.pokemon?.speciesName??speciesNames[String(entry.template?.speciesId) as keyof typeof speciesNames]}{entry.source?` · ${entry.source}`:''}</p><Details entry={entry}/><div className="form-grid"><label>Joueur destinataire<select value={playerId} onChange={e=>setPlayerId(e.target.value)}>{players.map(p=><option key={p.playerId} value={p.playerId}>{p.state.playerName??p.playerId}{p.connected?'':' (hors ligne)'}</option>)}</select></label><label>Emplacement<select value={slot} onChange={e=>setSlot(Number(e.target.value))}>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>{n}</option>)}</select></label></div><p>La réinjection remplace le Pokémon de l’emplacement choisi. Pour ajouter un Pokémon, choisissez le premier emplacement vide.</p><button disabled={busy||!players.find(p=>p.playerId===playerId)?.connected} onClick={inject}>Réinjecter ce Pokémon</button><button disabled={busy} onClick={()=>remove(entry.id)} title="Supprimer de la bibliothèque" aria-label="Supprimer de la bibliothèque"><Trash2 size={18}/></button></section>}</div>
 <AdminPanel players={players} onSaved={()=>void load()}/>
 </section>;
}
