import type {Express} from 'express';
import {DomainError} from '../errors.js';
import {currentAccount,requireAccount,requireAdmin,route} from '../http.js';
import type {Services} from '../services.js';

/** Members read the lobby objectives and who reached them; admins edit names, order, rewards and activation. */
export function registerObjectiveRoutes(app:Express,s:Services){
 const {accounts,lobbies}=s.domain;
 app.use('/api/lobbies/:id/objectives',requireAccount(id=>accounts.get(id)));
 app.get('/api/lobbies/:id/objectives',route((req,res)=>{
  const lobbyId=lobbies.require(String(req.params.id)).id,viewer=currentAccount(res);
  if(!viewer.admin&&!lobbies.isMember(lobbyId,viewer.id))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  return s.objectives.snapshot(lobbyId);
 }));
 app.patch('/api/lobbies/:id/objectives/:objectiveId',route((req,res)=>{
  const viewer=currentAccount(res);requireAdmin(viewer);
  return s.objectives.update(lobbies.require(String(req.params.id)).id,String(req.params.objectiveId),req.body,viewer.id);
 }));
}
