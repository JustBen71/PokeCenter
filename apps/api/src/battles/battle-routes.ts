import type {Express,Response} from 'express';
import {DomainError} from '../errors.js';
import {currentAccount,requireAccount,requireAdmin,route} from '../http.js';
import type {Services} from '../services.js';

/**
 * Commanded battles. Members read them; only admins preview, create, start or cancel one: a player can never send
 * a BattleEncounterSpec. Wheels (and later passives) create them server-side.
 */
export function registerBattleRoutes(app:Express,s:Services){
 const {accounts,lobbies}=s.domain;
 const base='/api/lobbies/:id/battles';
 const lobby=(id:string,viewer:{id:string;admin:boolean})=>{
  const found=lobbies.require(id);
  if(!viewer.admin&&!lobbies.isMember(found.id,viewer.id))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  return found.id;
 };
 const admin=(res:Response)=>{const viewer=currentAccount(res);requireAdmin(viewer);return viewer;};
 app.use(base,requireAccount(id=>accounts.get(id)));
 app.get(base,route((req,res)=>s.battles.snapshot(lobby(String(req.params.id),currentAccount(res)))));
 // Declared before /:battleId so "preview" is never read as an id.
 app.post(`${base}/preview`,route((req,res)=>{const v=admin(res);return s.battles.prepare(lobby(String(req.params.id),v),req.body);}));
 app.post(base,route((req,res)=>{const v=admin(res);res.status(201);return s.battles.createFrom(lobby(String(req.params.id),v),req.body,v.id,{queue:false});}));
 app.get(`${base}/:battleId`,route((req,res)=>s.battles.get(lobby(String(req.params.id),currentAccount(res)),String(req.params.battleId))));
 app.post(`${base}/:battleId/start`,route((req,res)=>{const v=admin(res);return s.battles.queue(lobby(String(req.params.id),v),String(req.params.battleId),v.id);}));
 app.post(`${base}/:battleId/cancel`,route((req,res)=>{const v=admin(res);return s.battles.cancel(lobby(String(req.params.id),v),String(req.params.battleId),v.id);}));
}
