import {api} from './api/client';
import {useLobby} from './lobby/lobby-context';
import {useLive} from './realtime/live-context';
import {useToast} from './components/toast-context';
import {confirmOutOfBattle,nativeCan,partyAction} from './pokemon/game-actions';
import type {LibraryItem} from './pokemon/library-types';
import {Save,Trash2} from "lucide-react";
import {useEffect,useState} from 'react';
import {decodePokemonCopy,type LibraryEntry,type PublicPlayer} from '@pokerace/shared';
import {AdminPanel} from './AdminPanel';
import speciesNames from './species-fr.json';
import {useMoveNames} from './pokemon/move-names';

export type Capture={pokemon:PublicPlayer['state']['party'][number];source:string;capturedAt:string};
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

export function PokemonLibrary({capture,clearCapture}:{capture:Capture|null;clearCapture:()=>void}) {
 const {lobby}=useLobby();const {views,members}=useLive();const toast=useToast();
 const [entries,setEntries]=useState<LibraryItem[]>([]),[selected,setSelected]=useState('');
 const [label,setLabel]=useState(''),[busy,setBusy]=useState(false),[target,setTarget]=useState(''),[slot,setSlot]=useState(0);
 const entry=entries.find(e=>e.id===selected);
 const view=views.find(v=>v.accountId===target);const party=view?.display.state.party??[];
 const run=async(work:()=>Promise<void>)=>{setBusy(true);try{await work();}catch(e){toast.error(e);}finally{setBusy(false);}};
 const load=()=>run(async()=>{setEntries(await api<LibraryItem[]>('/api/library'));});
 useEffect(()=>{setLabel(capture?.pokemon.nickname||capture?.pokemon.speciesName||'');},[capture]);
 useEffect(()=>{if(members.length&&!members.some(m=>m.id===target))setTarget(members[0].id);},[members,target]);
 useEffect(()=>{void load();},[]);
 const saveCapture=()=>run(async()=>{if(!capture?.pokemon.raw)return;
  const saved=await api<LibraryItem>('/api/library',{method:'POST',body:{...capture,label}});
  setEntries(await api<LibraryItem[]>('/api/library'));setSelected(saved.id);clearCapture();toast.success('Pokémon enregistré avec ses caractéristiques à cet instant.');});
 const remove=(id:string)=>run(async()=>{await api(`/api/library/${id}`,{method:'DELETE'});setEntries(v=>v.filter(e=>e.id!==id));setSelected('');toast.success('Entrée supprimée.');});
 const native=nativeCan(view,slot===0?'pokemon.insert':'pokemon.replace'),legacy=!!view?.legacyActionsAvailable;
 const name=members.find(m=>m.id===target)?.name??'ce joueur';
 const inject=()=>run(async()=>{if(!entry)return;
  if(!confirmOutOfBattle(name,slot===0?`Ajouter « ${entry.label} » à l’équipe de ${name} ?`:`Remplacer l’emplacement ${slot} de ${name} par « ${entry.label} » ?`))return;
  if(native){await partyAction(lobby.id,target,slot===0?{action:'insert',artifactId:entry.id}:{action:'replace',slot,artifactId:entry.id});toast.success('Écriture confirmée par le jeu. Sauvegardez dans le jeu pour la conserver.');return;}
  // Former mGBA agent: the copy or the template is sent as before.
  const legacySlot=slot===0?party.length+1:slot;
  const payload=entry.pokemon?{playerId:view!.display.playerId,slot:legacySlot,raw:entry.pokemon.raw}:{...entry.template,playerId:view!.display.playerId,slot:legacySlot};
  await api('/api/pokemon',{method:'POST',body:payload});toast.success('Réinjection confirmée par mGBA. Sauvegardez dans le jeu pour la conserver.');});
 return <section className="pokemon-library library-page admin" aria-labelledby="library-title"><header className="library-head"><div><p className="eyebrow">ADMIN · COPIES ET MODÈLES</p><h1 id="library-title">Bibliothèque Pokémon</h1><p>Copies exactes, modèles créés et réinjection dans les équipes. La bibliothèque est commune à tous les lobbies.</p></div></header>
 <button disabled={busy} onClick={()=>void load()}>Actualiser la bibliothèque</button>
 {!entries.length&&!busy&&<p className="muted">La bibliothèque est vide : sauvegardez un Pokémon depuis sa fiche ou créez-en un ci-dessous.</p>}
 {capture&&<section className="capture"><h3>Enregistrer {capture.pokemon.speciesName}</h3><p>Depuis {capture.source} · données du {new Date(capture.capturedAt).toLocaleString('fr-FR')}. Les données affichées restent celles sélectionnées, même si la partie continue.</p><Details entry={{pokemon:capture.pokemon}}/><label>Nom de l’enregistrement<input maxLength={80} value={label} onChange={e=>setLabel(e.target.value)}/></label><button disabled={busy||!label.trim()||!capture.pokemon.raw} onClick={()=>void saveCapture()} title="Sauvegarder cette copie" aria-label="Sauvegarder cette copie"><Save size={18}/></button><button onClick={clearCapture}>Annuler</button></section>}
 <div className="library-grid"><nav className="library-cards" aria-label="Pokémon enregistrés">{entries.map(e=><div className="library-card-wrap" key={e.id}><button className="card-delete" disabled={busy} onClick={()=>void remove(e.id)} title={`Supprimer ${e.label}`} aria-label={`Supprimer ${e.label}`}><Trash2 size={17}/></button><LibraryCard entry={e} selected={selected===e.id} onSelect={()=>setSelected(e.id)}/></div>)}</nav>
 {entry&&<section><h3>{entry.label}</h3><p>{entry.pokemon?.speciesName??speciesNames[String(entry.template?.speciesId) as keyof typeof speciesNames]}{entry.source?` · ${entry.source}`:''} · format {entry.artifact.format}</p><Details entry={entry}/>
  <div className="form-grid"><label>Joueur destinataire<select value={target} onChange={e=>setTarget(e.target.value)}>{members.map(m=>{const v=views.find(x=>x.accountId===m.id);return <option key={m.id} value={m.id}>{m.name}{v?.display.connected?'':' (hors ligne)'}</option>;})}</select></label>
  <label>Action<select value={slot} onChange={e=>setSlot(Number(e.target.value))}><option value={0}>Ajouter à l’équipe ({party.length}/6)</option>{party.map(p=><option key={p.slot} value={p.slot}>Remplacer l’emplacement {p.slot} · {p.nickname||p.speciesName}</option>)}</select></label></div>
  <p className="muted">{native?'Écriture vérifiée par le client Pokérace (BizHawk).':legacy?'Écriture par l’ancien agent mGBA.':'Le jeu de ce joueur ne permet pas cette écriture (client hors ligne ou capacité absente).'}</p>
  <button disabled={busy||(!native&&!legacy)||(slot===0&&party.length>=6)} onClick={()=>void inject()}>{slot===0?'Ajouter ce Pokémon':'Remplacer ce Pokémon'}</button><button disabled={busy} onClick={()=>void remove(entry.id)} title="Supprimer de la bibliothèque" aria-label="Supprimer de la bibliothèque"><Trash2 size={18}/></button></section>}</div>
 <AdminPanel onSaved={()=>void load()}/>
 </section>;
}
