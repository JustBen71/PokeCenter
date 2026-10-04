import {createContext,useContext} from 'react';
import type {Account} from '@pokerace/shared';

// Kept apart from SessionProvider.tsx: hot reloading a component must never re-create the context.
export type Session={account:Account;logout:()=>void;setAccount:(a:Account)=>void};
export const SessionContext=createContext<Session|null>(null);
export const useSession=()=>{const s=useContext(SessionContext);if(!s)throw Error('Compte non connecté');return s;};
