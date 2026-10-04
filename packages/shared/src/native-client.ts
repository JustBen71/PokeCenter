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
const nativePokemonSchema=z.object({raw:z.string().regex(/^[a-f0-9]{200}$/).refine(v=>{try{decodePokemonCopy(v);return true;}catch{return false;}}).optional(),slot:z.number().int().min(1).max(6),speciesId:z.number().int().min(1).max(386),speciesName:z.string().min(1).max(32),nickname:z.string().max(32).nullable(),level:z.number().int().min(1).max(100),currentHp:integer(999),maxHp:z.number().int().min(1).max(999),shiny:z.boolean()}).strict().refine(p=>p.currentHp<=p.maxHp);
export const nativeGameStateSchema=z.object({
 gameStateVersion:z.literal(1),
 adapter:adapterSchema.refine(a=>a.status==='ready'&&a.id!==null&&a.profileId!==null),
 game:z.object({family:z.literal('pokemon'),generation:z.literal(3),title:z.literal('emerald'),language:z.enum(['fr','en']),revision:z.string().min(1).max(80)}).strict(),
 trainer:z.object({name:z.string().min(1).max(20),money:integer(999999),playTimeSeconds:integer(35999999),partyCount:integer(6)}).strict(),
 location:z.object({mapGroup:integer(255),mapNumber:integer(255),label:z.string().min(1).max(80)}).strict(),
 party:z.array(nativePokemonSchema).max(6),
 progression:z.object({version:z.literal(1),completed:z.array(z.string().refine(id=>progressionData.objectives.some(o=>o.id===id))).max(64).refine(ids=>new Set(ids).size===ids.length)}).strict(),
 capabilities,observedAt:z.string().datetime()
}).strict().refine(s=>s.party.length===s.trainer.partyCount&&s.party.every((p,i)=>p.slot===i+1)&&JSON.stringify(s.capabilities)===JSON.stringify(s.adapter.capabilities));

// Status-only observations deliberately clear the previous game snapshot.
export const gameStateEventSchema=z.object({type:z.literal('GAME_STATE'),protocolVersion:z.literal(1),gameStateVersion:z.literal(1),adapter:adapterSchema,state:nativeGameStateSchema.nullable()}).strict().refine(e=>e.state===null?e.adapter.status!=='ready':JSON.stringify(e.adapter)===JSON.stringify(e.state.adapter));
export type NativeGameState=z.infer<typeof nativeGameStateSchema>;
export type GameAdapterState=z.infer<typeof adapterSchema>;
export type PublicNativeClient={
 accountId:string;playerId:string;playerName:string;ready:boolean;lastSeenAt:string;
 clientVersion:string|null;platform:string|null;emulator:{name:'BizHawk'}|null;
 bridge:{type:'bizhawk';connected:boolean;gameLoaded:boolean;protocolVersion:1|null};
 system:string|null;allowMemoryWrites:boolean;canPurchase?:boolean;adapter:GameAdapterState;gameState:NativeGameState|null;
};
