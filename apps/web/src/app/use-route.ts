import {useEffect,useState} from 'react';
import {useSession} from '../auth/session-context';
import {routeFromHash,type RouteId} from './routes';

// Current page from the URL hash; admin pages fall back to Course for players.
export function useRoute():RouteId{
 const {account}=useSession();
 const [route,setRoute]=useState(()=>routeFromHash(window.location.hash,account.admin));
 useEffect(()=>{const go=()=>{setRoute(routeFromHash(window.location.hash,account.admin));window.scrollTo(0,0);};window.addEventListener('hashchange',go);go();return()=>window.removeEventListener('hashchange',go);},[account.admin]);
 return route;
}
