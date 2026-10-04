import {useCallback,useEffect,useState,type ReactNode} from 'react';
import type {Account} from '@pokerace/shared';
import {api} from '../api/client';
import {saveSession,sessionIds} from './storage';
import {LoginPage} from './LoginPage';

import {SessionContext as Context} from './session-context';

// Restores the remembered account with /api/me so a deleted or renamed account is never trusted blindly.
export function SessionProvider({children}:{children:ReactNode}){
 const [account,setAccount]=useState<Account|null>(null),[restoring,setRestoring]=useState(()=>!!sessionIds().accountId);
 useEffect(()=>{
  if(!restoring)return;
  api<Account>('/api/me').then(a=>{saveSession({accountId:a.id,lobbyId:sessionIds().lobbyId});setAccount(a);})
   .catch(()=>saveSession({accountId:null,lobbyId:null})).finally(()=>setRestoring(false));
 },[]);
 // Roles can change on the server: re-read the account when the tab comes back.
 useEffect(()=>{
  if(!account)return;
  const refresh=()=>{if(document.visibilityState==='visible')void api<Account>('/api/me').then(setAccount).catch(()=>{});};
  document.addEventListener('visibilitychange',refresh);return()=>document.removeEventListener('visibilitychange',refresh);
 },[account?.id]);
 const login=useCallback((a:Account)=>{saveSession({accountId:a.id,lobbyId:null});setAccount(a);},[]);
 const logout=useCallback(()=>{saveSession({accountId:null,lobbyId:null});setAccount(null);},[]);
 if(restoring)return <main className="account-entry"><p className="muted">Reprise de la session…</p></main>;
 if(!account)return <LoginPage onLogin={login}/>;
 return <Context.Provider value={{account,logout,setAccount}}>{children}</Context.Provider>;
}
