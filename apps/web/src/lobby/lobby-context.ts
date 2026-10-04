import {createContext,useContext} from 'react';
import type {LobbySummary} from '@pokerace/shared';

export type LobbyContextValue={lobby:LobbySummary;leave:()=>void;refresh:()=>Promise<void>};
export const LobbyContext=createContext<LobbyContextValue|null>(null);
export const useLobby=()=>{const c=useContext(LobbyContext);if(!c)throw Error('Aucun lobby actif');return c;};
