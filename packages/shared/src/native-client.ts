import {decodePokemonCopy} from './pokemon-copy.js';
import {z} from 'zod';
import {progressionData} from './progression-data.js';

export const adapterStatusSchema=z.enum(['no_game','unsupported_system','unknown_rom','rom_identity_unavailable','profile_not_validated','memory_domain_unavailable','ready','read_error']);
export const readCapabilitySchema=z.enum(['trainer.read','money.read','party.read','location.read','progression.read']);
// Write capabilities are announced by clients whose adapter, profile and local settings allow verified writes.
export const writeCapabilitySchema=z.enum(['money.write','party.write','pokemon.insert','pokemon.remove','pokemon.replace']);
const capabilities=z.array(z.union([readCapabilitySchema,writeCapabilitySchema])).max(10).refine(v=>new Set(v).size===v.length);
export const adapterSchema=z.object({id:z.string().max(80).nullable(),status:adapterStatusSchema,profileId:z.string().max(80).nullable(),capabilities}).strict();
const integer=(max:number)=>z.number().int().min(0).max(max);
const slug=z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

// Highest National Dex number of each generation (index = generation).
export const MAX_SPECIES_BY_GENERATION=[0,151,251,386,493,649,721,809,905,1025] as const;
// BizHawk system IDs on which a generation can run (Gen I games also run on GBC/SGB).
export const SYSTEMS_BY_GENERATION:Readonly<Record<number,readonly string[]>>={1:['GB','GBC','SGB'],2:['GBC','GB','SGB'],3:['GBA'],4:['NDS'],5:['NDS'],6:['3DS'],7:['3DS'],8:[],9:[]};
export const GEN3_PARTY_FORMAT='gen3-party-v1';
const isGen3Copy=(raw:string)=>{try{decodePokemonCopy(raw);return true;}catch{return false;}};

// Generation-specific payload needed for writes. The portal UI never reads it:
// only GameAdapters (and the server-side builders of their commands) understand a format.
export const pokemonLiveArtifactSchema=z.object({
 format:z.string().regex(/^gen[1-9]-[a-z0-9-]+-v[0-9]+$/),
 raw:z.string().regex(/^(?:[a-f0-9]{2}){1,1024}$/)
}).strict().refine(a=>a.format!==GEN3_PARTY_FORMAT||/^[a-f0-9]{200}$/.test(a.raw)&&isGen3Copy(a.raw),'Copie Gen III invalide');
export const artifactGeneration=(format:string)=>Number(format.slice(3,4));

// What every generation can show: species, nickname, level, HP, sprite.
const pokemonLiveStateSchema=z.object({
 slot:z.number().int().min(1).max(6),speciesId:z.number().int().min(1).max(MAX_SPECIES_BY_GENERATION[9]),speciesName:z.string().min(1).max(32),
 nickname:z.string().max(32).nullable(),level:z.number().int().min(1).max(100),currentHp:integer(999),maxHp:z.number().int().min(1).max(999),shiny:z.boolean(),
 artifact:pokemonLiveArtifactSchema.optional()
}).strict().refine(p=>p.currentHp<=p.maxHp);

const gameIdentitySchema=z.object({family:z.literal('pokemon'),generation:z.number().int().min(1).max(9),title:slug,language:z.string().regex(/^[a-z]{2}$/),revision:z.string().min(1).max(80)}).strict();
// Gen III exposes map group/number; other generations may only send a label, a region and their own map id.
const locationSchema=z.object({label:z.string().min(1).max(80),region:slug.optional(),mapId:z.string().min(1).max(40).optional(),mapGroup:integer(255).optional(),mapNumber:integer(255).optional()}).strict()
 .refine(l=>(l.mapGroup===undefined)===(l.mapNumber===undefined));
const progressionSchema=z.object({version:z.literal(1),completed:z.array(slug).max(64).refine(ids=>new Set(ids).size===ids.length)}).strict();

/** gameStateVersion 2: generic for Gen I–IX. Gen III specifics live in `artifact` and in the refinements below. */
export const nativeGameStateSchema=z.object({
 gameStateVersion:z.literal(2),
 adapter:adapterSchema.refine(a=>a.status==='ready'&&a.id!==null&&a.profileId!==null),
 game:gameIdentitySchema,
 trainer:z.object({name:z.string().min(1).max(20),money:integer(9999999),playTimeSeconds:integer(35999999),partyCount:integer(6)}).strict(),
 location:locationSchema,
 party:z.array(pokemonLiveStateSchema).max(6),
 progression:progressionSchema,
 capabilities,observedAt:z.string().datetime()
}).strict().superRefine((s,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
 if(s.party.length!==s.trainer.partyCount||!s.party.every((p,i)=>p.slot===i+1))fail('party does not match partyCount/slots');
 if(JSON.stringify(s.capabilities)!==JSON.stringify(s.adapter.capabilities))fail('capabilities differ from adapter');
 if(s.party.some(p=>p.speciesId>MAX_SPECIES_BY_GENERATION[s.game.generation]))fail('species outside this generation');
 if(s.party.some(p=>p.artifact&&artifactGeneration(p.artifact.format)!==s.game.generation))fail('artifact from another generation');
 if(s.game.generation===3){
  if(s.trainer.money>999999)fail('Gen III money is limited to 999999');
  if(s.location.mapGroup===undefined)fail('Gen III location needs mapGroup/mapNumber');
  if(s.game.title==='emerald'&&!s.progression.completed.every(id=>progressionData.objectives.some(o=>o.id===id)))fail('unknown Emerald objective');
 }
});

// gameStateVersion 1 (Pokerace.Client <= 0.1): Emerald only, raw Gen III copy directly on each Pokémon.
const nativePokemonV1Schema=z.object({raw:z.string().regex(/^[a-f0-9]{200}$/).refine(isGen3Copy).optional(),slot:z.number().int().min(1).max(6),speciesId:z.number().int().min(1).max(386),speciesName:z.string().min(1).max(32),nickname:z.string().max(32).nullable(),level:z.number().int().min(1).max(100),currentHp:integer(999),maxHp:z.number().int().min(1).max(999),shiny:z.boolean()}).strict().refine(p=>p.currentHp<=p.maxHp);
export const nativeGameStateV1Schema=z.object({
 gameStateVersion:z.literal(1),
 adapter:adapterSchema.refine(a=>a.status==='ready'&&a.id!==null&&a.profileId!==null),
 game:z.object({family:z.literal('pokemon'),generation:z.literal(3),title:z.literal('emerald'),language:z.enum(['fr','en']),revision:z.string().min(1).max(80)}).strict(),
 trainer:z.object({name:z.string().min(1).max(20),money:integer(999999),playTimeSeconds:integer(35999999),partyCount:integer(6)}).strict(),
 location:z.object({mapGroup:integer(255),mapNumber:integer(255),label:z.string().min(1).max(80)}).strict(),
 party:z.array(nativePokemonV1Schema).max(6),
 progression:z.object({version:z.literal(1),completed:z.array(z.string().refine(id=>progressionData.objectives.some(o=>o.id===id))).max(64).refine(ids=>new Set(ids).size===ids.length)}).strict(),
 capabilities,observedAt:z.string().datetime()
}).strict().refine(s=>s.party.length===s.trainer.partyCount&&s.party.every((p,i)=>p.slot===i+1)&&JSON.stringify(s.capabilities)===JSON.stringify(s.adapter.capabilities));

export type NativeGameState=z.infer<typeof nativeGameStateSchema>;
export type NativeGameStateV1=z.infer<typeof nativeGameStateV1Schema>;
export type PokemonLiveState=NativeGameState['party'][number];
export type GameAdapterState=z.infer<typeof adapterSchema>;

export function upgradeGameStateV1(state:NativeGameStateV1):NativeGameState{
 return {...state,gameStateVersion:2,party:state.party.map(({raw,...pokemon})=>raw?{...pokemon,artifact:{format:GEN3_PARTY_FORMAT,raw}}:pokemon)};
}
/** Exact Gen III party copy (100 bytes as hex) when the client sent one, for Gen III command builders only. */
export const gen3PartyRaw=(pokemon:Pick<PokemonLiveState,'artifact'>|undefined)=>pokemon?.artifact?.format===GEN3_PARTY_FORMAT?pokemon.artifact.raw:undefined;

// Status-only observations deliberately clear the previous game snapshot.
// Version 1 events are still accepted from older clients and upgraded, so consumers only see version 2.
const eventConsistent=(e:{adapter:GameAdapterState;state:{adapter:GameAdapterState}|null})=>e.state===null?e.adapter.status!=='ready':JSON.stringify(e.adapter)===JSON.stringify(e.state.adapter);
const gameStateEventV2Schema=z.object({type:z.literal('GAME_STATE'),protocolVersion:z.literal(1),gameStateVersion:z.literal(2),adapter:adapterSchema,state:nativeGameStateSchema.nullable()}).strict().refine(eventConsistent);
const gameStateEventV1Schema=z.object({type:z.literal('GAME_STATE'),protocolVersion:z.literal(1),gameStateVersion:z.literal(1),adapter:adapterSchema,state:nativeGameStateV1Schema.nullable()}).strict().refine(eventConsistent);
export const gameStateEventSchema=z.union([gameStateEventV2Schema,gameStateEventV1Schema])
 .transform(e=>e.gameStateVersion===2?e:{...e,gameStateVersion:2 as const,state:e.state&&upgradeGameStateV1(e.state)});
export type GameStateEvent=z.output<typeof gameStateEventSchema>;
export type PublicNativeClient={
 accountId:string;playerId:string;playerName:string;ready:boolean;lastSeenAt:string;
 clientVersion:string|null;platform:string|null;emulator:{name:'BizHawk'}|null;
 bridge:{type:'bizhawk';connected:boolean;gameLoaded:boolean;protocolVersion:1|null};
 system:string|null;allowMemoryWrites:boolean;canPurchase?:boolean;adapter:GameAdapterState;gameState:NativeGameState|null;
};
