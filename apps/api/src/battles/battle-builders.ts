import {battleSpriteIds,battleTrainerNameSchema,characters,decodePokemonCopy,gen3PartyRaw,nationalSpecies,type BattlePokemonSpec,type BattleSpriteId,type NativeGameState} from '@pokerace/shared';
import {DomainError} from '../errors.js';

const encodable=new Set(Object.values(characters));
const FEMALE_AVATARS=new Set(['may','leaf','lass','beauty']);

/** A trainer name the game can show: characters of its table only, 7 at most, never empty. */
export function trainerName(name:string,fallback='RIVAL'):string{
 const kept=[...name.normalize('NFC').toUpperCase()].filter(c=>encodable.has(c)).join('').trim().slice(0,7).trim();
 return battleTrainerNameSchema.safeParse(kept).success?kept:fallback;
}
// A default sprite of the opponent's gender (from the portal avatar), overridable by the admin or the gage.
export const defaultSprite=(avatar:string|undefined):BattleSpriteId=>FEMALE_AVATARS.has(avatar??'')?'cooltrainer_f':'cooltrainer_m';
export const isSprite=(value:string):value is BattleSpriteId=>(battleSpriteIds as readonly string[]).includes(value);

/**
 * Opponent copy of a live party: exact species, moves, held item and personality (so nature, gender and ability)
 * from the client's Gen III copies. Effort is the average EV (what the Gen III secret-base mechanism stores).
 * Eggs and slots without an exact copy are refused rather than guessed.
 */
export function partyFromGameState(state:NativeGameState,owner:string):BattlePokemonSpec[]{
 const party=state.party.map(p=>{
  const raw=gen3PartyRaw(p);
  if(!raw)throw new DomainError('BATTLE_SOURCE_UNAVAILABLE',`Le client de ${owner} n’envoie pas la copie exacte de ${p.nickname||p.speciesName}`);
  let copy:ReturnType<typeof decodePokemonCopy>;
  try{copy=decodePokemonCopy(raw);}catch{return null;}// egg or unreadable slot
  const speciesId=nationalSpecies.get(copy.internalSpecies);
  const moves=[...new Set(copy.moves.map(m=>m.id).filter(id=>id>0&&id<=354))];
  if(!speciesId||!moves.length)return null;
  const evs=Object.values(copy.evs) as number[];
  return {speciesId,level:copy.level,moves,heldItem:copy.heldItem<=376?copy.heldItem:0,nature:copy.personality%25,
   ev:Math.floor(evs.reduce((n,v)=>n+v,0)/6),personality:copy.personality} satisfies BattlePokemonSpec;
 }).filter((p):p is NonNullable<typeof p>=>p!==null);
 if(!party.length)throw new DomainError('BATTLE_SOURCE_UNAVAILABLE',`Aucun Pokémon utilisable dans l’équipe de ${owner}`);
 return party;
}
