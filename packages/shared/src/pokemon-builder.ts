import type {PokemonInjection} from './index.js';

type Resource = {name:string; url:string};
type Names = {name:string; language:Resource}[];
type ApiStat = {base_stat:number; stat:Resource};
export type PokemonData = {
  stats:ApiStat[];
  past_stats:{generation:Resource; stats:ApiStat[]}[];
  moves:{move:Resource; version_group_details:{version_group:Resource; move_learn_method:Resource; level_learned_at:number; order:number|null}[]}[];
};
type MoveData = {id:number; name:string; names:Names; pp:number; past_values:{pp:number|null; version_group:Resource}[]};
export type MoveChoice = {id:number; name:string; pp:number; level:number};
export type BuiltPokemon = {stats:PokemonInjection['stats']; experience:number; moves:PokemonInjection['moves']; choices:MoveChoice[]; name:string};
const statKeys = ['hp','attack','defense','speed','spAttack','spDefense'] as const;
const apiKeys = ['hp','attack','defense','speed','special-attack','special-defense'];
const idOf = (r:Resource) => Number(r.url.match(/\/(\d+)\/?$/)?.[1]);
const french = (names:Names, fallback:string) => names.find(n=>n.language.name==='fr')?.name ?? fallback;
const cache = new Map<string,Promise<unknown>>();
async function api<T>(path:string):Promise<T> {
  if (!cache.has(path)) {
    const request = fetch(`https://pokeapi.co/api/v2/${path}/`, {signal:AbortSignal.timeout(15000)})
      .then(async response => {
        if (!response.ok) throw new Error('PokéAPI indisponible. Réessayez ou choisissez le mode manuel.');
        return response.json();
      }).catch(error=>{cache.delete(path); throw error;});
    cache.set(path,request);
  }
  return cache.get(path)! as Promise<T>;
}

export function calculateStats(data:PokemonData, form:Pick<PokemonInjection,'speciesId'|'level'|'nature'|'ivs'|'evs'>):PokemonInjection['stats'] {
  const base = Object.fromEntries(data.stats.map(s=>[s.stat.name,s.base_stat]));
  // Historical entries contain only changed stats. Apply backwards to generation III.
  for (const past of [...data.past_stats].filter(p=>idOf(p.generation)>=3).sort((a,b)=>idOf(b.generation)-idOf(a.generation))) {
    for (const stat of past.stats) base[stat.stat.name]=stat.base_stat;
  }
  const values = statKeys.map((key,i)=>{
    if (!Number.isInteger(base[apiKeys[i]]) || base[apiKeys[i]]<1) throw new Error('Statistiques PokéAPI incomplètes.');
    const value = Math.floor((2*base[apiKeys[i]]+form.ivs[key]+Math.floor(form.evs[key]/4))*form.level/100);
    if (i===0) return form.speciesId===292 ? 1 : value+form.level+10;
    const up=Math.floor(form.nature/5), down=form.nature%5;
    const percent=up===down ? 100 : i-1===up ? 110 : i-1===down ? 90 : 100;
    return Math.floor((value+5)*percent/100);
  });
  return {maxHp:values[0],attack:values[1],defense:values[2],speed:values[3],spAttack:values[4],spDefense:values[5]};
}

export function emeraldPP(move:MoveData):number {
  // past_values names the version group where a change occurred (Emerald is group 6).
  return [...move.past_values].filter(p=>idOf(p.version_group)>6 && p.pp!==null)
    .sort((a,b)=>idOf(a.version_group)-idOf(b.version_group))[0]?.pp ?? move.pp;
}

export function levelMoves(data:PokemonData, level:number) {
  return data.moves.flatMap(m=>m.version_group_details
    .filter(v=>v.version_group.name==='emerald' && v.move_learn_method.name==='level-up' && v.level_learned_at<=level)
    .map(v=>({id:idOf(m.move),level:v.level_learned_at,order:v.order??0})))
    .filter(m=>m.id>=1 && m.id<=354)
    .sort((a,b)=>a.level-b.level || a.order-b.order || a.id-b.id);
}

/** Gen III stats and experience of a species at a level (PokéAPI), for a level change of an existing Pokémon. */
export async function levelData(speciesId:number, level:number):Promise<{pokemon:PokemonData; experience:number}> {
  const [pokemon,species]=await Promise.all([api<PokemonData>(`pokemon/${speciesId}`),api<{growth_rate:Resource}>(`pokemon-species/${speciesId}`)]);
  const growth=await api<{levels:{level:number; experience:number}[]}>(`growth-rate/${idOf(species.growth_rate)}`);
  const experience=growth.levels.find(l=>l.level===level)?.experience;
  if (experience===undefined) throw new Error('Courbe d’expérience indisponible.');
  return {pokemon,experience};
}

export async function buildPokemon(form:PokemonInjection):Promise<BuiltPokemon> {
  if (!Number.isInteger(form.speciesId) || form.speciesId<1 || form.speciesId>386 || !Number.isInteger(form.level) || form.level<1 || form.level>100) throw new Error('Choisissez une espèce entre 1 et 386 et un niveau entre 1 et 100.');
  if (!Number.isInteger(form.nature) || form.nature<0 || form.nature>24 || Object.values(form.ivs).some(v=>!Number.isInteger(v)||v<0||v>31) || Object.values(form.evs).some(v=>!Number.isInteger(v)||v<0||v>255) || Object.values(form.evs).reduce((a,b)=>a+b,0)>510) throw new Error('Vérifiez la nature, les IV (0–31) et les EV (510 au total).');
  const [pokemon,species]=await Promise.all([
    api<PokemonData>(`pokemon/${form.speciesId}`),
    api<{name:string; names:Names; growth_rate:Resource}>(`pokemon-species/${form.speciesId}`)
  ]);
  const learned=levelMoves(pokemon,form.level);
  const unique=learned.filter((m,i)=>learned.findIndex(n=>n.id===m.id)===i);
  const [growth,choices]=await Promise.all([
    api<{levels:{level:number; experience:number}[]}>(`growth-rate/${idOf(species.growth_rate)}`),
    Promise.all(unique.map(async m=>{
      const move=await api<MoveData>(`move/${m.id}`);
      return {...m,name:french(move.names,move.name),pp:emeraldPP(move)};
    }))
  ]);
  const experience=growth.levels.find(l=>l.level===form.level)?.experience;
  if (experience===undefined || !choices.length) throw new Error('Données Émeraude incomplètes pour ce Pokémon. Utilisez le mode manuel.');
  const moves=choices.slice(-4).map(m=>({id:m.id,pp:m.pp}));
  while(moves.length<4) moves.push({id:0,pp:0});
  return {stats:calculateStats(pokemon,form),experience,moves,choices,name:french(species.names,species.name)};
}
