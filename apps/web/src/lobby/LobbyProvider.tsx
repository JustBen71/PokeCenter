import {useCallback,useEffect,useState,type ReactNode} from 'react';
import type {LobbySummary} from '@pokerace/shared';
import {api} from '../api/client';
import {useSession} from '../auth/session-context';
import {saveSession,sessionIds} from '../auth/storage';
import {LobbyPage} from './LobbyPage';

import {LobbyContext as Context} from './lobby-context';

// The active lobby is restored after a reload only if the account is still a member.
export function LobbyProvider({children}:{children:ReactNode}){
 const {account}=useSession();
 const [lobby,setLobby]=useState<LobbySummary|null>(null),[restoring,setRestoring]=useState(()=>!!sessionIds().lobbyId);
 const select=useCallback((next:LobbySummary|null)=>{saveSession({accountId:account.id,lobbyId:next?.id??null});setLobby(next);},[account.id]);
 useEffect(()=>{
  const id=sessionIds().lobbyId;if(!id){setRestoring(false);return;}
  api<LobbySummary>(`/api/lobbies/${encodeURIComponent(id)}`).then(l=>select(l.joined?l:null)).catch(()=>select(null)).finally(()=>setRestoring(false));
 },[account.id]);
 const refresh=useCallback(async()=>{if(lobby)setLobby(await api<LobbySummary>(`/api/lobbies/${lobby.id}`));},[lobby?.id]);
 if(restoring)return <main className="account-entry"><p className="muted">Reprise du lobby…</p></main>;
 if(!lobby)return <LobbyPage onEnter={select}/>;
 // Remounting on lobby change resets every page and reconnects Socket.IO to the right course.
 return <Context.Provider value={{lobby,leave:()=>select(null),refresh}}><div key={lobby.id} className="lobby-scope">{children}</div></Context.Provider>;
}
