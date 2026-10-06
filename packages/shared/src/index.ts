export * from './native-client.js';
export {encodePokemon} from './pokemon-encode.js';
export * from './accounts.js';
export * from './pokemon-builder.js';
export * from './auction.js';
export * from './errors.js';
export * from './lobby.js';
export * from './run.js';
export * from './money.js';
export * from './audit.js';
export * from './game.js';
export * from './pokemon-artifact.js';
export * from './objectives.js';
export * from './bank.js';
export * from './lobby-auction.js';
export * from './wheels.js';
export * from './shop.js';
import { z } from "zod";
export * from './roulette.js';
import {progressionData} from './progression-data.js';
export {progressionData} from './progression-data.js';
import {decodePokemonCopy} from './pokemon-copy.js';
export {decodePokemonCopy} from './pokemon-copy.js';
export const rawPokemonSchema=z.string().regex(/^[a-f0-9]{200}$/).refine(raw=>{try{decodePokemonCopy(raw);return true;}catch{return false;}},'Copie Pokémon invalide');

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 32 * 1024;

export const gameSchema = z.object({
  name: z.literal("pokemon-emerald"),
  language: z.enum(["fr", "en"]).nullable(),
  profileId: z.string().min(1).max(80).nullable(),
  romStatus: z.enum(["recognized", "unknown", "missing"]),
  revision: z.string().max(80).nullable().default(null),
  header: z.object({title:z.string().max(32), gameCode:z.string().max(8), version:z.number().int().min(0).max(255)}).nullable().default(null),
  romSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null)
});

export const pokemonSchema = z.object({
  raw: rawPokemonSchema.nullable().optional(),
  slot: z.number().int().min(1).max(6),
  speciesId: z.number().int().min(1).max(386),
  speciesName: z.string().min(1).max(32),
  nickname: z.string().max(32).nullable().default(null),
  level: z.number().int().min(1).max(100),
  currentHp: z.number().int().min(0).max(999),
  maxHp: z.number().int().min(1).max(999),
  shiny: z.boolean()
}).refine(p => p.currentHp <= p.maxHp, "currentHp must not exceed maxHp");

export const playerStateSchema = z.object({
  events:z.object({trainerBattles:z.number().int().min(0).max(16777215),captures:z.number().int().min(0).max(16777215),trainerLead:z.string().regex(/^[a-f0-9]{16}$/).nullable()}).nullable().optional(),
  capabilities:z.array(z.string().max(40)).max(10).optional(),
  progression:z.object({version:z.literal(1),completed:z.array(z.string().refine(id=>progressionData.objectives.some(o=>o.id===id))).max(64).refine(ids=>new Set(ids).size===ids.length)}).nullable().optional(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  playerName: z.string().trim().min(1).max(32).optional(),
  playerId: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  game: gameSchema,
  trainer: z.object({money:z.number().int().min(0).max(999999).optional(),name:z.string().min(1).max(20),id:z.number().int().min(0).max(65535).optional(),playTimeSeconds:z.number().int().min(0).max(35999999).optional(),partyCount:z.number().int().min(0).max(6).optional()}).nullable(),
  location: z.object({mapGroup:z.number().int().min(0).max(255),mapNumber:z.number().int().min(0).max(255),label:z.string().min(1).max(80)}).nullable(),
  party: z.array(pokemonSchema).max(6).refine(items => new Set(items.map(x=>x.slot)).size === items.length, "duplicate party slot"),
  observedAt: z.string().datetime(),
  diagnostic: z.string().max(500).nullable().default(null)
});

export const agentEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({type:z.literal("state"), data:playerStateSchema}),
  z.object({type:z.literal("heartbeat"), protocolVersion:z.literal(PROTOCOL_VERSION), playerId:z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/), observedAt:z.string().datetime()})
]);

const statSchema=z.number().int().min(1).max(999);
export const pokemonInjectionSchema=z.object({
 playerId:z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),slot:z.number().int().min(1).max(6),
 speciesId:z.number().int().min(1).max(386),nickname:z.string().min(1).max(10),level:z.number().int().min(1).max(100),experience:z.number().int().min(0).max(1640000),
 currentHp:z.number().int().min(0).max(999),stats:z.object({maxHp:statSchema,attack:statSchema,defense:statSchema,speed:statSchema,spAttack:statSchema,spDefense:statSchema}),
 moves:z.array(z.object({id:z.number().int().min(0).max(354),pp:z.number().int().min(0).max(99)})).length(4),
 heldItem:z.number().int().min(0).max(376),abilitySlot:z.number().int().min(0).max(1),nature:z.number().int().min(0).max(24),friendship:z.number().int().min(0).max(255),
 otName:z.string().min(1).max(7),trainerId:z.number().int().min(0).max(65535),secretId:z.number().int().min(0).max(65535),
 ivs:z.object({hp:z.number().int().min(0).max(31),attack:z.number().int().min(0).max(31),defense:z.number().int().min(0).max(31),speed:z.number().int().min(0).max(31),spAttack:z.number().int().min(0).max(31),spDefense:z.number().int().min(0).max(31)}),
 evs:z.object({hp:z.number().int().min(0).max(255),attack:z.number().int().min(0).max(255),defense:z.number().int().min(0).max(255),speed:z.number().int().min(0).max(255),spAttack:z.number().int().min(0).max(255),spDefense:z.number().int().min(0).max(255)}).refine(v=>Object.values(v).reduce((a,b)=>a+b,0)<=510,"EV total exceeds 510"),
 shiny:z.boolean()
}).refine(v=>v.currentHp<=v.stats.maxHp,"currentHp exceeds maxHp");
export type PokemonInjection=z.infer<typeof pokemonInjectionSchema>;
export const restorePokemonSchema=z.object({playerId:z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),slot:z.number().int().min(1).max(6),raw:rawPokemonSchema});
export const removePokemonSchema=restorePokemonSchema.extend({action:z.literal("remove")});
export const libraryInputSchema=z.object({
 label:z.string().trim().min(1).max(80),
 pokemon:pokemonSchema.refine(p=>!!p.raw,'Relancez le client pour activer la copie complète').optional(),
 template:pokemonInjectionSchema.optional(),
 source:z.string().max(100).optional(),
 capturedAt:z.string().datetime().optional()
}).refine(v=>!!v.pokemon!==!!v.template,'Choisissez une copie ou un modèle');
export type LibraryEntry=z.infer<typeof libraryInputSchema>&{id:string;createdAt:string};

export type PlayerState = z.infer<typeof playerStateSchema>;
export type AgentEnvelope = z.infer<typeof agentEnvelopeSchema>;
// Display shape shared by /agent players and native clients of any generation (see nativeDisplayState).
export type PublicPlayer = {account?:import('./accounts.js').Account;playerId:string; connected:boolean; receivedAt:string; lastSeenAt:string; state:Omit<PlayerState,"game"|"location"> & {
  game:Omit<PlayerState["game"],"romSha256"|"name"|"language"> & {name:string;language:string|null};
  location:{label:string;mapGroup?:number;mapNumber?:number;region?:string;mapId?:string}|null}};

export function toPublicPlayer(row:{playerId:string;connected:boolean;receivedAt:string;lastSeenAt:string;state:PlayerState}):PublicPlayer {
  const {romSha256: _secret, ...game} = row.state.game;
  return {...row,state:{...row.state,game}};
}
