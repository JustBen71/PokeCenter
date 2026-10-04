import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {io,type Socket} from 'socket.io-client';
import type {LobbySummary,PublicNativeClient,PublicPlayer,Run} from '@pokerace/shared';
import {apiFetch} from '../api/client';
import {useSession} from '../auth/session-context';
import {useLobby} from '../lobby/lobby-context';
import {playerViews,type PlayerViewModel} from '../native-clients';
import {useToast} from '../components/toast-context';
import type {LobbyNotification} from '@pokerace/shared';

import {LiveContext as Context} from './live-context';

// One Socket.IO connection per lobby feeds every page: teams, native clients, Runs and members.
export function LiveDataProvider({children}:{children:ReactNode}){
 const {account}=useSession();const {lobby}=useLobby();
 const [connected,setConnected]=useState(false),[players,setPlayers]=useState<PublicPlayer[]>([]),[nativeClients,setNativeClients]=useState<PublicNativeClient[]>([]);
 const [runs,setRuns]=useState<Run[]>([]),[members,setMembers]=useState(lobby.members),[socket,setSocket]=useState<Socket|null>(null);
 const nativeEvent=useRef(false);
 const toast=useToast();
 useEffect(()=>{
  apiFetch('/api/native-clients').then(r=>r.ok?r.json():Promise.reject()).then(rows=>{if(!nativeEvent.current)setNativeClients(rows);}).catch(()=>{});
  apiFetch('/api/players').then(r=>r.ok?r.json():Promise.reject()).then(setPlayers).catch(()=>{});
  const s=io('/dashboard',{path:lobby.id==='legacy'?'/socket.io':`/rooms/${lobby.id}/socket.io`,auth:{accountId:account.id}});
  s.on('connect',()=>setConnected(true));s.on('disconnect',()=>setConnected(false));
  s.on('players',setPlayers);s.on('native-clients',rows=>{nativeEvent.current=true;setNativeClients(rows);});
  s.on('runs',setRuns);
  // Lobby-wide results (wheels, jackpot…) reach every viewer.
  s.on('notification',(n:LobbyNotification)=>toast.notify(n.kind,n.message));s.on('lobby',(l:LobbySummary|null)=>{if(l)setMembers(l.members);});
  setSocket(s);
  return()=>{s.close();setSocket(null);};
 },[lobby.id,account.id]);
 const views=useMemo(()=>playerViews(players,nativeClients),[players,nativeClients]);
 return <Context.Provider value={{connected,players,nativeClients,runs,views,members,socket}}>{children}</Context.Provider>;
}
