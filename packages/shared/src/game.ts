import {z} from 'zod';
import type {GameAdapterState} from './native-client.js';
import type {Run} from './run.js';

// Business capabilities of a GameAdapter. Features test these, never the emulated system.
export const gameCapabilitySchema=z.enum([
 'trainer.read','money.read','money.write','party.read','party.write',
 'pokemon.insert','pokemon.remove','pokemon.replace','location.read','progression.read'
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
