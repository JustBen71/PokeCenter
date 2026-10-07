import {passiveCapabilitySchema,type PassiveAvailability,type PassiveCapability,type PassiveDefinition} from '@pokerace/shared';

// Capabilities the existing GameAdapter can really provide (validated profiles). The future ones are never assumed.
export const validatedCapabilities:ReadonlySet<PassiveCapability>=new Set(passiveCapabilitySchema.options);

export const missingCapabilities=(passive:PassiveDefinition,validated=validatedCapabilities)=>passive.requires.filter(c=>!validated.has(c));

/** A passive is offered only if its handler exists on the server and every capability it needs is validated. */
export function availability(passive:PassiveDefinition,implemented:ReadonlySet<string>,validated=validatedCapabilities):PassiveAvailability{
 if(missingCapabilities(passive,validated).length)return 'DISABLED_MISSING_CAPABILITY';
 return implemented.has(passive.id)?'AVAILABLE':'NOT_YET_IMPLEMENTED';
}
