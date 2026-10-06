import {battleEncounterSpecSchema,speciesInternal,type BattleEncounterSpec} from '@pokerace/shared';
import {DomainError} from '../errors.js';

/**
 * Final check of what will be sent to a game, even for a spec built by the server itself: Zod bounds plus the
 * Gen III limits the schema cannot express. Nothing raw (bytes, addresses) ever comes from the Web.
 */
export function validateBattleSpec(value:unknown):BattleEncounterSpec{
 const parsed=battleEncounterSpecSchema.safeParse(value);
 if(!parsed.success)throw new DomainError('VALIDATION_FAILED',parsed.error.issues[0]?.message??'Combat invalide',{issues:parsed.error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});
 for(const [i,p] of parsed.data.party.entries()){
  if(!speciesInternal[p.speciesId])throw new DomainError('VALIDATION_FAILED',`Pokémon ${i+1} : espèce absente de la troisième génération`);
 }
 return parsed.data;
}
