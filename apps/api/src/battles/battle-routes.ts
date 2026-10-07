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
 // Tableau des combats: members read and accept; admins create, draw again, set the reward, withdraw.
 const board='/api/lobbies/:id/board';
 app.use(board,requireAccount(id=>accounts.get(id)));
 app.get(board,route((req,res)=>s.board.snapshot(lobby(String(req.params.id),currentAccount(res)))));
 app.post(board,route(async(req,res)=>{const v=admin(res);const team=await s.board.create(lobby(String(req.params.id),v),req.body,v.id);res.status(201);return team;}));
 app.post(`${board}/:teamId/reroll`,route((req,res)=>{const v=admin(res);return s.board.reroll(lobby(String(req.params.id),v),String(req.params.teamId),v.id);}));
 app.post(`${board}/:teamId/reward`,route((req,res)=>{const v=admin(res);return s.board.setReward(lobby(String(req.params.id),v),String(req.params.teamId),req.body,v.id);}));
 app.post(`${board}/:teamId/withdraw`,route((req,res)=>{const v=admin(res);return s.board.withdraw(lobby(String(req.params.id),v),String(req.params.teamId),v.id);}));
 // The viewer fights for themselves only.
 app.post(`${board}/:teamId/challenge`,route((req,res)=>{const v=currentAccount(res);return s.board.challenge(lobby(String(req.params.id),v),String(req.params.teamId),v.id);}));
 app.post(`${board}/:teamId/forfeit`,route((req,res)=>{const v=currentAccount(res);return s.board.forfeit(lobby(String(req.params.id),v),String(req.params.teamId),v.id);}));
}
