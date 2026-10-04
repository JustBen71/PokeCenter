import {useEffect} from 'react';
import {decodePokemonCopy,type PublicPlayer} from '@pokerace/shared';
import {X} from 'lucide-react';
import {useMoveNames} from './move-names';
import {natureNames,statLabels} from './labels';

type Pokemon=PublicPlayer['state']['party'][number];
type Action={label:string;icon?:React.ReactNode;onClick:()=>void;disabled?:boolean;title?:string;danger?:boolean};

export const spriteUrl=(p:{speciesId:number;shiny:boolean})=>`/sprites/${p.shiny?'shiny/':''}${p.speciesId}.png`;

// Detailed sheet of one party Pokémon. Extra details come from the exact copy when the client sends it.
export function PokemonSheet({pokemon,owner,onClose,actions=[]}:{pokemon:Pokemon;owner:string;onClose:()=>void;actions?:Action[]}){
 const decoded=(()=>{try{return pokemon.raw?decodePokemonCopy(pokemon.raw):null;}catch{return null;}})();
 const names=useMoveNames(decoded?.moves.map(m=>m.id).join(',')??'');
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[onClose]);
 const hp=Math.round(pokemon.currentHp/pokemon.maxHp*100);
 return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <article className="dialog pokemon-sheet" role="dialog" aria-modal="true" aria-label={`Fiche de ${pokemon.nickname||pokemon.speciesName}`}>
   <button className="icon-button close" aria-label="Fermer" onClick={onClose}><X size={16}/></button>
   <header>
    <img src={spriteUrl(pokemon)} onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src='/sprites/fallback.svg';}} alt=""/>
    <div><p className="eyebrow">{owner} · emplacement {pokemon.slot}</p><h2>{pokemon.nickname||pokemon.speciesName}{pokemon.shiny&&<span className="shiny" title="Chromatique"> ✦</span>}</h2>
     <p>{pokemon.nickname?`${pokemon.speciesName} · `:''}Niv. {pokemon.level}</p>
     <div className="hp big"><span style={{width:`${hp}%`}} className={hp<25?'low':hp<50?'mid':''}/></div><small>{pokemon.currentHp} / {pokemon.maxHp} PV</small></div>
   </header>
   {decoded?<>
    <table className="stat-table"><thead><tr><th/><th>Stat</th><th>IV</th><th>EV</th></tr></thead><tbody>
     {(['maxHp','attack','defense','spAttack','spDefense','speed'] as const).map(k=>{const key=k==='maxHp'?'hp':k;return <tr key={k}><th>{statLabels[k]}</th><td>{decoded.stats[k]}</td><td>{decoded.ivs[key]}</td><td>{decoded.evs[key]}</td></tr>;})}
    </tbody></table>
    <h3>Attaques</h3>
    <ul className="moves">{decoded.moves.filter(m=>m.id).map((m,i)=><li key={i}><span>{names[m.id]??`Attaque n° ${m.id}`}</span><small>{m.pp} PP</small></li>)}</ul>
    <dl className="facts"><div><dt>Nature</dt><dd>{natureNames[decoded.nature]??decoded.nature}</dd></div><div><dt>Dresseur d’origine</dt><dd>{decoded.otName} · {String(decoded.trainerId).padStart(5,'0')}</dd></div><div><dt>Bonheur</dt><dd>{decoded.friendship}</dd></div><div><dt>Expérience</dt><dd>{decoded.experience.toLocaleString('fr-FR')}</dd></div></dl>
   </>:<p className="muted">Détails complets indisponibles : le client n’envoie pas encore la copie exacte de ce Pokémon.</p>}
   {actions.length>0&&<footer className="sheet-actions">{actions.map(a=><button key={a.label} className={a.danger?'danger':''} disabled={a.disabled} title={a.title} onClick={a.onClick}>{a.icon}{a.label}</button>)}</footer>}
  </article>
 </div>;
}
