import type {BattlePokemonSpec,BattleScalingSpec} from '@pokerace/shared';
import {DomainError} from '../errors.js';

const clamp=(level:number)=>Math.min(100,Math.max(1,Math.round(level)));
const average=(levels:number[])=>levels.reduce((n,l)=>n+l,0)/levels.length;

/**
 * Battle difficulty decided by the portal, never by the GameAdapter. Levels move as a block (relative differences
 * kept), clamped to 1..100; moves are kept (KEEP_EXISTING_MOVES). The game recomputes stats and experience from the
 * new level when it creates the opponent, with full HP/PP and no status.
 */
export function scaleParty(party:BattlePokemonSpec[],scaling:BattleScalingSpec,playerLevels:number[]|null):BattlePokemonSpec[]{
 const levels=party.map(p=>p.level);
 const shifted=(target:number,reference:number)=>party.map(p=>({...p,level:clamp(p.level+target-reference)}));
 const needPlayer=()=>{if(!playerLevels?.length)throw new DomainError('BATTLE_SOURCE_UNAVAILABLE','Équipe du joueur inconnue : impossible de calculer les niveaux');return playerLevels;};
 switch(scaling.mode){
  case 'COPY_EXACT':return party.map(p=>({...p}));
  case 'DELTA_LEVEL':return party.map(p=>({...p,level:clamp(p.level+scaling.delta)}));
  case 'MATCH_PLAYER_AVERAGE':return shifted(average(needPlayer())+scaling.delta,average(levels));
  case 'MATCH_PLAYER_HIGHEST':return shifted(Math.max(...needPlayer())+scaling.delta,Math.max(...levels));
  case 'CUSTOM_LEVELS':
   if(scaling.levels!.length!==party.length)throw new DomainError('VALIDATION_FAILED',`Indiquez ${party.length} niveau(x), un par Pokémon`);
   return party.map((p,i)=>({...p,level:clamp(scaling.levels![i])}));
 }
}
export const levelSummary=(levels:number[])=>levels.length?{average:Math.round(average(levels)*10)/10,highest:Math.max(...levels)}:null;
