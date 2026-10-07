type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Ids={accountId:string|null;lobbyId:string|null};

// sessionStorage keeps each tab independent (two accounts in two tabs); localStorage restores the
// last session in a new tab or after the browser restarts. "Changer de compte" clears both.
const ACCOUNT='pokerace-account',LOBBY='pokerace-room',REMEMBERED='pokerace-session',LAST='pokerace-last-account';

const safe=<T>(read:()=>T,fallback:T)=>{try{return read();}catch{return fallback;}};
const browser=():{session:StorageLike;local:StorageLike}|null=>typeof window==='undefined'?null:safe(()=>({session:window.sessionStorage,local:window.localStorage}),null);

export function readSession(session:StorageLike,local:StorageLike):Ids{
 const accountId=safe(()=>session.getItem(ACCOUNT),null);
 if(accountId)return {accountId,lobbyId:safe(()=>session.getItem(LOBBY),null)};
 const remembered=safe(()=>JSON.parse(local.getItem(REMEMBERED)??'null') as Ids|null,null);
 return {accountId:typeof remembered?.accountId==='string'?remembered.accountId:null,lobbyId:typeof remembered?.lobbyId==='string'?remembered.lobbyId:null};
}
export function writeSession(session:StorageLike,local:StorageLike,ids:Ids){
 safe(()=>{
  if(ids.accountId)session.setItem(ACCOUNT,ids.accountId);else session.removeItem(ACCOUNT);
  if(ids.lobbyId)session.setItem(LOBBY,ids.lobbyId);else session.removeItem(LOBBY);
  if(ids.accountId){local.setItem(REMEMBERED,JSON.stringify(ids));local.setItem(LAST,ids.accountId);}else local.removeItem(REMEMBERED);
 },undefined);
}

export const sessionIds=():Ids=>{const s=browser();return s?readSession(s.session,s.local):{accountId:null,lobbyId:null};};
export const saveSession=(ids:Ids)=>{const s=browser();if(s)writeSession(s.session,s.local,ids);};
export const lastAccountId=()=>{const s=browser();return s?safe(()=>s.local.getItem(LAST),null):null;};

// Admin session (server password) of one account, kept in this browser until « Quitter le mode admin ».
const ADMIN='pokerace-admin:';
export const adminToken=(accountId:string)=>{const s=browser();return s?safe(()=>s.local.getItem(ADMIN+accountId),null):null;};
export const saveAdminToken=(accountId:string,token:string|null)=>{const s=browser();if(s)safe(()=>token?s.local.setItem(ADMIN+accountId,token):s.local.removeItem(ADMIN+accountId),undefined);};
