import {z} from 'zod';

// A library entry is a versioned artifact: the payload layout depends on `format`, never on assumptions about
// Gen III. New generations add formats instead of stretching the 100-byte party structure.
export const pokemonArtifactFormatSchema=z.enum(['gen3-party-v1','gen3-template-v1']);
export type PokemonArtifactFormat=z.infer<typeof pokemonArtifactFormatSchema>;
export type PokemonArtifactDisplay={speciesId:number;speciesName:string|null;nickname:string|null;level:number;shiny:boolean};
export type PokemonArtifactMeta={format:PokemonArtifactFormat;gameFamily:string;generation:number;species:number;display:PokemonArtifactDisplay;createdBy:string|null};

export const pokemonActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('insert'),artifactId:z.string().min(1).max(64),confirmOutOfBattle:z.boolean()}).strict(),
 z.object({action:z.literal('remove'),slot:z.number().int().min(1).max(6),confirmOutOfBattle:z.boolean()}).strict(),
 z.object({action:z.literal('replace'),slot:z.number().int().min(1).max(6),artifactId:z.string().min(1).max(64),confirmOutOfBattle:z.boolean()}).strict()
]);
export type PokemonAction=z.infer<typeof pokemonActionSchema>;
