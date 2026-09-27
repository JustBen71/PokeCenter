import {useSession} from './Accounts';

import {apiFetch} from './session';

import {useEffect,useState} from 'react';

import {Dices,Plus,Save,Trash2,Pencil,Play,ArrowDown} from 'lucide-react';

import type {ActionDescription,Gag,PlayerSelector,PokemonSelector,PublicPlayer,RouletteRun,RouletteEffect,BlockField} from '@pokerace/shared';

type Data={gags:Gag[];runs:RouletteRun[];effects:RouletteEffect[];actions:ActionDescription[]};

const palette=['#ac91ff','#64cbb0','#f1ba68','#68baf1','#ef87b0','#afa9db'];

const defaults=()=>({playerB:{mode:'random'},pokemonA:{mode:'random'},pokemonB:{mode:'random'}});

const fresh=():Omit<Gag,'id'>=>({name:'Nouvel échange',weight:1,enabled:true,action:'pokemon.swap',blocks:defaults()});

const statuses:Record<RouletteRun['status'],string>={queued:'À venir dans la série',preparing:'Préparation du gage',drawn:'Tiré — à appliquer',executing:'Application en cours',completed:'Terminé',cancelled:'Annulé',failed:'Non appliqué / interrompu',review:'Équipes à vérifier'};

function Block({field,value,onChange,players}:{field:BlockField;value:unknown;onChange:(value:unknown)=>void;players:PublicPlayer[]}) {

 if(field.type==='number')return <input type="number" min={field.min} max={field.max} required value={Number(value??field.default??0)} onChange={e=>onChange(Number(e.target.value))}/>;

 if(field.type==='select')return <select value={String(value??field.default??'')} onChange={e=>onChange(e.target.value)}>{field.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>;

 if(field.type==='spinner')return <p>Le joueur choisi dans « Qui tourne la roue ? »</p>;

 if(field.type==='text')return <textarea maxLength={500} value={String(value??'')} onChange={e=>onChange(e.target.value)} placeholder="Votre gage…" required/>;

 if(field.type==='player'){

  const v=(value??{mode:'random'}) as PlayerSelector;

  return <><select aria-label={field.label} value={v.mode} onChange={e=>onChange({mode:e.target.value,rank:1,playerId:players[0]?.playerId})}><option value="choice">Choisir après le tirage</option><option value="random">Joueur au hasard</option><option value="fixed">Joueur précis</option><option value="first">Premier de la course</option><option value="last">Dernier de la course</option><option value="penultimate">Avant-dernier</option><option value="rank">Position dans le classement</option></select>{v.mode==='fixed'&&<select aria-label={`${field.label} précis`} value={v.playerId??''} required onChange={e=>onChange({...v,playerId:e.target.value})}><option value="">Choisir…</option>{players.map(p=><option key={p.playerId} value={p.playerId}>{p.state.playerName??p.playerId}</option>)}</select>}{v.mode==='rank'&&<input aria-label="Position" type="number" min={1} max={100} value={v.rank??1} onChange={e=>onChange({...v,rank:Number(e.target.value)})}/>}</>;

 }

 const v=(value??{mode:'random'}) as PokemonSelector;

 return <><select aria-label={field.label} value={v.mode} onChange={e=>onChange({mode:e.target.value,slot:1})}><option value="random">Pokémon au hasard</option><option value="highest">Niveau le plus haut</option><option value="lowest">Niveau le plus bas</option><option value="slot">Emplacement précis</option></select>{v.mode==='choice'&&<select aria-label="Qui choisit le Pokémon ?" value={v.by??'spinner'} onChange={e=>onChange({...v,by:e.target.value})}><option value="spinner">Le joueur qui tourne</option><option value="target">Le joueur B</option><option value="vote">Vote des autres joueurs</option></select>}{v.mode==='slot'&&<select aria-label="Emplacement Pokémon" value={v.slot??1} onChange={e=>onChange({...v,slot:Number(e.target.value)})}>{[1,2,3,4,5,6].map(n=><option key={n}>{n}</option>)}</select>}</>;

}

export function Roulette({players}:{players:PublicPlayer[]}) {

 const [clock,setClock]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);const {account}=useSession();const [cardTargets,setCardTargets]=useState<Record<string,string>>({});const [catalogSearch,setCatalogSearch]=useState(''),[category,setCategory]=useState('');

 const [data,setData]=useState<Data>({gags:[],runs:[],effects:[],actions:[]}),[draft,setDraft]=useState(fresh),[editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[current,setCurrent]=useState<RouletteRun|null>(null),[automatic,setAutomatic]=useState(true),[angle,setAngle]=useState(0),[spinnerId,setSpinnerId]=useState(account.id);

 const action=data.actions.find(a=>a.id===draft.action),enabled=data.gags.filter(g=>g.enabled),total=enabled.reduce((sum,g)=>sum+g.weight,0);

 let accumulated=0;const sectors=enabled.map((g,i)=>{const from=accumulated/total*360;accumulated+=g.weight;return {g,color:palette[i%palette.length],from,to:accumulated/total*360};});

 async function request(path:string,options:RequestInit={}){const response=await apiFetch(path,{...options,headers:{'content-type':'application/json'}});const body=await response.json();if(!response.ok)throw new Error(body.error??'Erreur serveur');return body;}

 async function reload(){const value=await request('/api/roulette');setData(value);setCurrent(old=>old?value.runs.find((r:RouletteRun)=>r.id===old.id)??old:old);}

 useEffect(()=>{const refresh=()=>void reload().catch(e=>setError(String(e)));refresh();const timer=setInterval(refresh,3000);return()=>clearInterval(timer);},[]);

 async function task(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await reload();}catch(e){setError(String(e));}finally{setBusy(false);}}

 const patch=(value:Partial<Omit<Gag,'id'>>)=>setDraft(d=>({...d,...value}));

 async function save(event:React.FormEvent){event.preventDefault();await task(async()=>{await request(editing?`/api/roulette/gags/${editing}`:'/api/roulette/gags',{method:editing?'PUT':'POST',body:JSON.stringify(draft)});setEditing(null);setDraft(fresh());});}

 async function run(){await task(async()=>{

  const result:RouletteRun=await request('/api/roulette/draw',{method:'POST',body:JSON.stringify({drawKey:crypto.randomUUID(),spinnerId,autoApply:automatic})});

  const sector=sectors.find(s=>s.g.id===result.gagId);if(sector)setAngle(previous=>previous+1440+((360-(sector.from+sector.to)/2-previous%360+360)%360));

  setCurrent(result);

  // The wheel illustrates the persisted server draw; it never chooses the result.

  await new Promise(resolve=>setTimeout(resolve,2200));

  if(automatic&&result.status==='drawn'&&!result.pending)setCurrent(await request(`/api/roulette/runs/${result.id}/apply`,{method:'POST'}));

 });}

 function choicePanel(run:RouletteRun){const pending=run.pending!;return <div className="gag-choice"><strong>{pending.label}</strong><p>{Object.keys(pending.votes).length} / {pending.actors.length} réponse(s)</p>{pending.actors.includes(account.id)?pending.votes[account.id]?<p>Votre choix est enregistré.</p>:<select aria-label={pending.label} disabled={busy} defaultValue="" onChange={e=>{const value=e.target.value;if(value)void task(async()=>{setCurrent(await request(`/api/roulette/runs/${run.id}/choose`,{method:'POST',body:JSON.stringify({value,key:pending.key})}));});}}><option value="">Sélectionner…</option>{pending.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<p>En attente des joueurs concernés.</p>}{(account.admin||run.spinnerId===account.id)&&<button disabled={busy} onClick={()=>task(async()=>setCurrent(await request(`/api/roulette/runs/${run.id}/cancel`,{method:'POST'})))}>Annuler ce tirage</button>}</div>;}

 return <section className="roulette-page"><header className="progress-heading"><div><p className="eyebrow">LES GAGES DE LA POKÉRACE</p><h1>Roulette</h1><p>Créez vos règles avec des blocs, réglez leurs chances et lancez le tirage quand vous voulez.</p></div><Dices size={44}/></header>

 <div className="roulette-layout"><section className="roulette-panel"><h2>À qui le tour ?</h2><label className="spinner-select">Qui tourne la roue ?<select aria-label="Qui tourne la roue ?" value={spinnerId} disabled={busy||!account.admin} onChange={e=>setSpinnerId(e.target.value)}><option value="">Choisir un joueur…</option>{players.map(p=><option key={p.playerId} value={p.playerId} disabled={!p.connected||p.state.game.romStatus!=='recognized'}>{p.state.playerName??p.playerId}{!p.connected?' · hors ligne':''}</option>)}</select></label><p className="muted">Ce joueur est toujours le joueur A du gage.</p><div className="wheel-frame"><span className="wheel-pointer"/><div className="roulette-wheel" style={{background:sectors.length?`conic-gradient(${sectors.map(s=>`${s.color} ${s.from}deg ${s.to}deg`).join(',')})`:'#252a40',transform:`rotate(${angle}deg)`}}>{sectors.map((s,i)=>{const radians=((s.from+s.to)/2-90)*Math.PI/180;return <span key={s.g.id} style={{left:`${50+35*Math.cos(radians)}%`,top:`${50+35*Math.sin(radians)}%`}}>{i+1}</span>;})}</div><div className="wheel-center"><Dices size={30}/></div></div>

 <button className="primary" disabled={busy||!total||!players.some(p=>p.playerId===spinnerId&&p.connected&&p.state.game.romStatus==='recognized')} onClick={run}><Play size={17}/>{busy?'Tirage / application…':'Lancer la roulette'}</button><label className="auto-apply"><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)} disabled={busy}/> Appliquer automatiquement le gage tiré</label><p className="muted">Déclenchement manuel uniquement. Poids 2 = deux fois plus de chances que poids 1. Un gage impossible échoue sans nouveau tirage.</p>

 {current&&<section className={`roulette-result ${current.status}`} role="status"><small>{statuses[current.status]}</small><h3>{current.name}</h3><p>Roue tournée par {current.spinnerName??'joueur non précisé'}</p><p>{current.summary}</p>{current.log.map((line,i)=><p key={i}>{line}</p>)}{current.pending&&choicePanel(current)}{current.status==='drawn'&&!current.pending&&<><button disabled={busy} onClick={()=>task(async()=>setCurrent(await request(`/api/roulette/runs/${current.id}/apply`,{method:'POST'})))}>Appliquer ce gage</button><button disabled={busy} onClick={()=>task(async()=>setCurrent(await request(`/api/roulette/runs/${current.id}/cancel`,{method:'POST'})))}>Annuler</button></>}</section>}

 </section><section className="roulette-panel"><h2>Gages de la roue · {enabled.length}</h2>{!enabled.length&&<p>Ajoutez des gages depuis le catalogue ci-dessous.</p>}{enabled.map(g=>{const sector=sectors.find(s=>s.g.id===g.id);return <article className="gag-row" key={g.id}><span className="gag-dot" style={{background:sector?.color}}/><div><strong>{g.name}</strong><small>{(g.weight/total*100).toFixed(1)} % · poids {g.weight}</small></div>{account.admin&&<button disabled={busy} title="Retirer de la roue, conserver au catalogue" onClick={()=>task(async()=>{await request(`/api/roulette/gags/${g.id}`,{method:'PUT',body:JSON.stringify({...g,enabled:false})});})}>Retirer</button>}</article>;})}<p className="muted">Retirer un gage conserve ses réglages dans le catalogue. Les égalités de classement et de niveau sont départagées au hasard.</p>
 </section></div>

 <section className="roulette-panel gag-catalogue"><h2>Cartes et effets en cours</h2>{!(data.effects??[]).length&&<p>Les cartes gagnées et les obligations temporaires apparaîtront ici.</p>}<div className="gag-cards">{(data.effects??[]).filter(e=>['active','armed','triggered','review'].includes(e.status)||e.ownerId===account.id).map(effect=><article className="gag-card" key={effect.id}><small>{players.find(p=>p.playerId===effect.ownerId)?.state.playerName??effect.ownerId} · {effect.kind==='suspend'&&effect.status==='active'?'Indisponible':{active:'Disponible / en cours',armed:'Prête à se déclencher',triggered:'Déclenché',used:'Utilisé',expired:'Terminé',review:'À vérifier'}[effect.status]}</small><h3>{effect.name}</h3>{effect.kind==='suspend'&&<div className="suspended-pokemon"><img src={`/sprites/${effect.speciesId}.png`} alt=""/><strong>{effect.pokemonName}</strong>{effect.status==='active'&&<time>{effect.releaseAt&&Date.parse(effect.releaseAt)>clock?`${Math.floor((Date.parse(effect.releaseAt)-clock)/60000)}:${String(Math.floor((Date.parse(effect.releaseAt)-clock)/1000)%60).padStart(2,'0')} restantes`:'Retour en attente'}</time>}</div>}<p>{effect.note}</p>{effect.status==='review'&&effect.kind==='suspend'&&(account.admin||effect.ownerId===account.id)&&<><p>Vérifiez l’équipe et les boîtes dans le jeu avant de choisir.</p><button disabled={busy} onClick={()=>task(async()=>{await request(`/api/roulette/effects/${effect.id}/return-review`,{method:'POST',body:JSON.stringify({outcome:'returned'})});})}>Il est déjà revenu dans l’équipe</button><button disabled={busy} onClick={()=>task(async()=>{await request(`/api/roulette/effects/${effect.id}/return-review`,{method:'POST',body:JSON.stringify({outcome:'retry'})});})}>Il est absent : autoriser le retour</button></>}{effect.status==='review'&&effect.kind!=='suspend'&&(account.admin||effect.ownerId===account.id)&&<button disabled={busy} onClick={()=>task(async()=>{await request(`/api/roulette/effects/${effect.id}/resolve`,{method:'POST'});})}>J’ai vérifié cet effet</button>}{effect.triggerRunId&&<button onClick={()=>{const run=data.runs.find(r=>r.id===effect.triggerRunId);if(run)setCurrent(run);}}>Voir le tirage associé</button>}{effect.ownerId===account.id&&effect.status==='active'&&effect.kind==='reroll'&&<><select aria-label={`Cible de ${effect.name}`} value={cardTargets[effect.id]??''} onChange={e=>setCardTargets(t=>({...t,[effect.id]:e.target.value}))}><option value="">Joueur à faire relancer…</option>{players.filter(p=>p.playerId!==account.id&&p.connected).map(p=><option key={p.playerId} value={p.playerId}>{p.state.playerName??p.playerId}</option>)}</select><button disabled={busy||!cardTargets[effect.id]} onClick={()=>task(async()=>{await request(`/api/roulette/effects/${effect.id}/use`,{method:'POST',body:JSON.stringify({playerId:cardTargets[effect.id]})});})}>Jouer cette carte</button></>}{effect.ownerId===account.id&&effect.status==='active'&&effect.kind==='revive'&&<button disabled={busy} onClick={()=>task(async()=>{const result=await request(`/api/roulette/effects/${effect.id}/use`,{method:'POST'});if(result.run)setCurrent(result.run);})}>Utiliser : ouvrir le vote</button>}</article>)}</div></section>
 <section className="roulette-panel gag-catalogue"><header><div><p className="eyebrow">VOTRE BOÎTE À GAGES</p><h2>Catalogue · {data.gags.length}</h2></div><input aria-label="Chercher un gage" placeholder="Chercher un gage…" value={catalogSearch} onChange={e=>setCatalogSearch(e.target.value)}/><select aria-label="Thématique" value={category} onChange={e=>setCategory(e.target.value)}><option value="">Toutes les thématiques</option>{[...new Set(data.gags.map(g=>g.category||'Personnalisé'))].map(c=><option key={c}>{c}</option>)}</select></header><div className="gag-cards">{data.gags.filter(g=>(!category||(g.category||'Personnalisé')===category)&&`${g.name} ${g.description??''}`.toLocaleLowerCase('fr').includes(catalogSearch.toLocaleLowerCase('fr'))).map(g=><article key={g.id} className="gag-card"><small>{g.category||'Personnalisé'}</small><h3>{g.name}</h3><p>{g.description||data.actions.find(a=>a.id===g.action)?.description}</p>{g.action==='gag.pending'?<p className="gag-pending">À automatiser : {String(g.blocks.reason)}</p>:<span className="gag-ready">{g.action==='gag.notice'?'Consigne entre amis':g.action==='rule.keep'||g.id==='chaos-02'||g.id==='chaos-09'||g.id==='chaos-17'?'Effet et suivi de consigne':'Effet automatisé'} · {g.enabled?'dans la roue':'hors de la roue'}</span>}{account.admin&&<footer><button disabled={busy||g.action==='gag.pending'} onClick={()=>task(async()=>{await request(`/api/roulette/gags/${g.id}`,{method:'PUT',body:JSON.stringify({...g,enabled:!g.enabled})});})}>{g.enabled?'Retirer de la roue':'Ajouter à la roue'}</button><button title="Modifier" aria-label={`Modifier ${g.name}`} onClick={()=>{setEditing(g.id);setDraft({...g});document.querySelector('.block-editor')?.scrollIntoView({behavior:'smooth'});}}><Pencil size={16}/></button><button title="Créer une variante" aria-label={`Dupliquer ${g.name}`} onClick={()=>{setEditing(null);setDraft({...g,name:`${g.name.slice(0,65)} · variante`,enabled:false});document.querySelector('.block-editor')?.scrollIntoView({behavior:'smooth'});}}><Plus size={16}/></button><button title="Supprimer du catalogue" aria-label={`Supprimer ${g.name}`} onClick={()=>task(async()=>{await request(`/api/roulette/gags/${g.id}`,{method:'DELETE'});})}><Trash2 size={16}/></button></footer>}</article>)}</div></section>
 {error&&<p className="roulette-error" role="alert">{error}</p>}

 {account.admin&&<form className="roulette-panel block-editor" onSubmit={save}><header><h2>{editing?'Modifier le gage':'Créer un gage sans code'}</h2><button type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft(fresh());}}><Plus size={17}/> Nouveau</button><button type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft({name:'Pokémon indisponible 10 minutes',category:'Indisponibilité',description:'Un Pokémon quitte temporairement l’équipe et revient après 10 minutes réelles.',weight:1,enabled:false,action:'pokemon.suspend',blocks:{pokemonA:{mode:'choice'},minutes:10}});}}>Indisponibilité de 10 min</button></header><fieldset disabled={busy}><div className="form-grid"><label>Nom du gage<input value={draft.name} maxLength={80} required onChange={e=>patch({name:e.target.value})}/></label><label>Thématique<input list="gag-themes" value={draft.category??'Personnalisé'} maxLength={60} onChange={e=>patch({category:e.target.value})}/><datalist id="gag-themes">{[...new Set(data.gags.map(g=>g.category||'Personnalisé'))].map(c=><option key={c} value={c}/>)}</datalist></label><label>Poids du tirage<input type="number" min={1} max={1000} required value={draft.weight} onChange={e=>patch({weight:Number(e.target.value)})}/></label><label>Action<select aria-label="Action" value={draft.action} onChange={e=>patch({action:e.target.value,blocks:Object.fromEntries((data.actions.find(a=>a.id===e.target.value)?.fields??[]).filter(f=>f.type!=='spinner').map(f=>[f.key,f.default??(f.type==='player'||f.type==='pokemon'?{mode:'random'}:'')]))})}>{data.actions.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label></div><label>Description et règles<textarea value={draft.description??''} maxLength={2000} onChange={e=>patch({description:e.target.value})}/></label><label className="auto-apply"><input type="checkbox" checked={draft.enabled} onChange={e=>patch({enabled:e.target.checked})}/> Ajouter à la roue</label><p className="muted">{action?.description}</p>

 <div className="no-code-flow">{action?.fields.map((field,index)=><div className="flow-step" key={field.key}><div className={`rule-block ${field.type}`}><span className="block-number">{index+1}</span><label>{field.label}<Block field={field} value={draft.blocks[field.key]} onChange={value=>patch({blocks:{...draft.blocks,[field.key]:value}})} players={players}/></label></div><ArrowDown size={18}/></div>)}<div className="rule-block effect"><Dices size={24}/><strong>{action?.label}</strong></div></div><button className="primary" type="submit"><Save size={17}/> Enregistrer le gage</button></fieldset></form>}

 <section className="roulette-panel roulette-history"><h2>Historique des tirages</h2><button disabled={busy} onClick={()=>task(reload)}>Actualiser</button>{data.runs.map(run=><details key={run.id}><summary><span>{statuses[run.status]}</span> {run.name} · {run.spinnerName??'Ancien tirage'} · {new Date(run.createdAt).toLocaleString('fr-FR')}</summary><p>{run.summary}</p>{run.log.map((line,i)=><p key={i}>{line}</p>)}{run.pending&&choicePanel(run)}{run.status==='drawn'&&!run.pending&&(account.admin||run.spinnerId===account.id)&&<><button disabled={busy} onClick={()=>task(async()=>setCurrent(await request(`/api/roulette/runs/${run.id}/apply`,{method:'POST'})))}>Appliquer ce tirage</button><button disabled={busy} onClick={()=>task(async()=>{await request(`/api/roulette/runs/${run.id}/cancel`,{method:'POST'});})}>Annuler ce tirage</button></>}{run.status==='review'&&(account.admin||run.spinnerId===account.id)&&<><p>Consultez les équipes et les copies « Roulette » dans la bibliothèque. Cette action lève seulement le verrou ; elle ne modifie aucun Pokémon.</p><button disabled={busy} onClick={()=>task(async()=>{await request(`/api/roulette/runs/${run.id}/reviewed`,{method:'POST'});})}>J’ai vérifié les équipes</button></>}</details>)}</section>

 </section>;

}

