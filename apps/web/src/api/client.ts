import type {ErrorCode} from '@pokerace/shared';
import {adminToken,sessionIds} from '../auth/storage';

// Portal-wide endpoints; everything else is served by the active lobby under /rooms/<id>.
const GLOBAL=['/api/accounts','/api/rooms','/api/lobbies','/api/me','/api/library','/api/admin'];

export function apiFetch(input:string,init:RequestInit={}){
 const headers=new Headers(init.headers);const {accountId,lobbyId}=sessionIds();
 if(accountId){headers.set('x-account-id',accountId);const token=adminToken(accountId);if(token)headers.set('x-admin-token',token);}
 const global=GLOBAL.some(p=>input===p||input.startsWith(p+'/')||input.startsWith(p+'?'));
 return fetch(lobbyId&&!global?`/rooms/${encodeURIComponent(lobbyId)}${input}`:input,{...init,headers});
}

const messages:Partial<Record<ErrorCode|'NETWORK',string>>={
 NETWORK:'Serveur injoignable. Vérifie que l’API est démarrée.',
 ACCOUNT_REQUIRED:'Choisis ton compte pour continuer.',
 ADMIN_REQUIRED:'Action réservée aux administrateurs.',
 FORBIDDEN:'Tu ne peux pas faire cette action.',
 LAST_ADMIN:'Il doit rester au moins un administrateur.',
 INVALID_INVITE_CODE:'Aucun lobby ne correspond à ce code.',
 NOT_LOBBY_MEMBER:'Rejoins ce lobby avec son code.',
 LOBBY_NOT_FOUND:'Ce lobby n’existe plus.',
 INTERNAL_ERROR:'Erreur interne du serveur.'
};

export class ApiRequestError extends Error{
 constructor(readonly code:ErrorCode|'NETWORK'|'HTTP',message:string,readonly status:number){super(message);this.name='ApiRequestError';}
}

// Accepts the stable envelope {ok:false,error:{code,message}} and the legacy {error:"…"} of older routes.
export function toRequestError(status:number,body:unknown):ApiRequestError{
 const error=(body as {error?:unknown}|null)?.error;
 if(error&&typeof error==='object'&&'code' in error){
  const {code,message}=error as {code:ErrorCode;message?:string};
  return new ApiRequestError(code,message||messages[code]||'Action refusée',status);
 }
 return new ApiRequestError('HTTP',typeof error==='string'&&error?error:`La requête a échoué (${status})`,status);
}

export async function api<T>(path:string,init:{method?:string;body?:unknown}={}):Promise<T>{
 let response:Response;
 try{
  response=await apiFetch(path,{method:init.method??'GET',...(init.body!==undefined?{headers:{'content-type':'application/json'},body:JSON.stringify(init.body)}:{})});
 }catch{throw new ApiRequestError('NETWORK',messages.NETWORK!,0);}
 const body=await response.json().catch(()=>null);
 if(!response.ok)throw toRequestError(response.status,body);
 return body as T;
}

export const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);

// crypto.randomUUID only exists over HTTPS/localhost; getRandomValues works everywhere (the site may be served over plain HTTP).
export function requestId(){
 const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]!&0x0f|0x40;b[8]=b[8]!&0x3f|0x80;
 const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
