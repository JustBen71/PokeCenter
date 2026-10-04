import {createContext,useContext,useEffect,useState} from 'react';
import type {Socket} from 'socket.io-client';
import type {LobbySummary,PublicNativeClient,PublicPlayer,Run} from '@pokerace/shared';
import type {PlayerViewModel} from '../native-clients';

export type Live={
 connected:boolean;players:PublicPlayer[];nativeClients:PublicNativeClient[];runs:Run[];views:PlayerViewModel[];
 members:LobbySummary['members'];socket:Socket|null;
};
export const LiveContext=createContext<Live|null>(null);
export const useLive=()=>{const c=useContext(LiveContext);if(!c)throw Error('LiveDataProvider manquant');return c;};

// Subscribes a page to a portal topic pushed on the dashboard (bank, jackpot…) without opening a second socket.
export function useLiveTopic<T>(topic:string,initial:T):T{
 const {socket}=useLive();const [value,setValue]=useState<T>(initial);
 useEffect(()=>{if(!socket)return;const handler=(v:T)=>setValue(v);socket.on(topic,handler);socket.emit('topic:get',topic);return()=>{socket.off(topic,handler);};},[socket,topic]);
 return value;
}
