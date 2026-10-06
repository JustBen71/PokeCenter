import {z} from 'zod';
import {gen3PartyRaw,type GameAdapterState,type NativeGameState} from './native-client.js';
import type {Run} from './run.js';

// Business capabilities of a GameAdapter. Features test these, never the emulated system.
export const gameCapabilitySchema=z.enum([
 'trainer.read','money.read','money.write','party.read','party.write',
 'pokemon.insert','pokemon.remove','pokemon.replace','location.read','progression.read',
 'battle.trainer.start'
]);
export type GameCapability=z.infer<typeof gameCapabilitySchema>;

// What the portal may know about a player's game: no raw memory, no ROM fingerprint.
export type GameContext={
 lobbyId:string;accountId:string;
 client:{connected:boolean;playerId:string|null;bridgeConnected:boolean;gameLoaded:boolean;lastSeenAt:string|null};
 adapter:{status:GameAdapterState['status'];id:string|null;capabilities:GameCapability[]};
 game:{money:number|null;observedAt:string|null;fresh:boolean};
 run:Run|null;
};

// Read-only display of a native GAME_STATE (any generation) in the historical PublicPlayer shape.
// Only common fields are used; the Gen III copy is exposed as `raw` for the Gen III screens that need it.
export function nativeDisplayState(game:NativeGameState){
 return {
  game:{name:`pokemon-${game.game.title}`,language:game.game.language,profileId:game.adapter.profileId,romStatus:'recognized' as const,revision:game.game.revision,header:null},
  trainer:game.trainer,location:game.location,progression:game.progression,
  party:game.party.map(({artifact,...pokemon})=>{const raw=gen3PartyRaw({artifact});return raw?{...pokemon,raw}:pokemon;})
 };
}
