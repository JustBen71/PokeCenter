import type {Express} from 'express';
import {lobbyCreateSchema,lobbyJoinSchema,lobbyUpdateSchema,type Account,type Lobby,type LobbySummary} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import {currentAccount,parseBody,requireAccount,requireAdmin,route} from '../http.js';
import type {PortalDomain} from '../store.js';

/**
 * Lobby endpoints used by the Web. Everyone may join with an invite code; only admins create or edit lobbies.
 * A non-admin only sees the lobbies they belong to, so a code is the only way into a new one.
 */
export function lobbySummary(domain:PortalDomain,lobby:Lobby,viewer:Account):LobbySummary{
 const byId=new Map(domain.accounts.list().map(a=>[a.id,a]));
 const members=domain.lobbies.members(lobby.id).flatMap(m=>{const a=byId.get(m.accountId);return a?[{id:a.id,name:a.name,sprite:a.sprite,admin:a.admin,joinedAt:m.joinedAt}]:[];});
 const joined=members.some(m=>m.id===viewer.id);
 return {id:lobby.id,name:lobby.name,status:lobby.status,createdAt:lobby.createdAt,createdBy:lobby.createdBy,joined,members,...(joined||viewer.admin?{inviteCode:lobby.inviteCode}:{})};
}

export function registerLobbyRoutes(app:Express,domain:PortalDomain,events:{created:(lobby:Lobby)=>void;changed:(lobbyId:string)=>void}){
 const {accounts,lobbies,audit}=domain;
 const summary=(lobby:Lobby,viewer:Account)=>lobbySummary(domain,lobby,viewer);
 const visible=(lobby:Lobby,viewer:Account)=>{
  if(!viewer.admin&&!lobbies.isMember(lobby.id,viewer.id))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  return lobby;
 };

 const auth=requireAccount(id=>accounts.get(id));
 app.get('/api/me',auth,route((_req,res)=>currentAccount(res)));
 app.use('/api/lobbies',auth);
 app.get('/api/lobbies',route((_req,res)=>{
  const viewer=currentAccount(res);
  return lobbies.list().filter(l=>viewer.admin||lobbies.isMember(l.id,viewer.id)).map(l=>summary(l,viewer));
 }));
 app.post('/api/lobbies',route((req,res)=>{
  const viewer=currentAccount(res);requireAdmin(viewer);
  const {name}=parseBody(lobbyCreateSchema,req.body);
  const lobby=lobbies.create({name,createdBy:viewer.id});events.created(lobby);
  audit.record({lobbyId:lobby.id,actorAccountId:viewer.id,category:'LOBBY',action:'lobby.create',status:'SUCCESS',message:`Lobby « ${lobby.name} » créé`});
  res.status(201);return summary(lobby,viewer);
 }));
 // Declared before /:id so "join" is never read as a lobby id.
 app.post('/api/lobbies/join',route((req,res)=>{
  const viewer=currentAccount(res);
  const {code}=parseBody(lobbyJoinSchema,req.body);
  const lobby=lobbies.findByTypedCode(code);
  if(!lobby){
   audit.record({actorAccountId:viewer.id,category:'LOBBY',action:'lobby.join',status:'FAILED',errorCode:'INVALID_INVITE_CODE',message:`${viewer.name} a saisi un code inconnu`});
   throw new DomainError('INVALID_INVITE_CODE','Aucun lobby ne correspond à ce code');
  }
  if(lobby.status==='ARCHIVED')throw new DomainError('CONFLICT','Ce lobby est archivé');
  if(!lobbies.isMember(lobby.id,viewer.id)){
   lobbies.addMember(lobby.id,viewer.id);
   audit.record({lobbyId:lobby.id,actorAccountId:viewer.id,category:'LOBBY',action:'lobby.join',status:'SUCCESS',message:`${viewer.name} a rejoint le lobby`});
   events.changed(lobby.id);
  }
  return summary(lobby,viewer);
 }));
 app.get('/api/lobbies/:id',route((req,res)=>{const viewer=currentAccount(res);return summary(visible(lobbies.require(String(req.params.id)),viewer),viewer);}));
 app.patch('/api/lobbies/:id',route((req,res)=>{
  const viewer=currentAccount(res);requireAdmin(viewer);
  const id=String(req.params.id),patch=parseBody(lobbyUpdateSchema,req.body),before=lobbies.require(id);
  if(patch.name!==undefined)lobbies.rename(id,patch.name);
  if(patch.status!==undefined)lobbies.setStatus(id,patch.status);
  const lobby=lobbies.require(id);
  audit.record({lobbyId:id,actorAccountId:viewer.id,category:'LOBBY',action:'lobby.update',status:'SUCCESS',message:`Lobby « ${lobby.name} » modifié`,
   metadata:{from:{name:before.name,status:before.status},to:{name:lobby.name,status:lobby.status}}});
  events.changed(id);return summary(lobby,viewer);
 }));
}
