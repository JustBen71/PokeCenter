import type {Express,Response} from 'express';
import {passiveAccountSchema,passiveChoiceSchema,passiveGrantSchema,passiveStartSchema} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import {currentAccount,parseBody,requireAccount,requireAdmin,route} from '../http.js';
import type {Services} from '../services.js';

/** Passives: every member reads them; a player chooses only their own card; everything else is admin. */
export function registerPassiveRoutes(app:Express,s:Services){
 const {accounts,lobbies}=s.domain;
 const base='/api/lobbies/:id/passives';
 const lobby=(id:string,viewer:{id:string;admin:boolean})=>{
  const found=lobbies.require(id);
  if(!viewer.admin&&!lobbies.isMember(found.id,viewer.id))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  return found.id;
 };
 const admin=(res:Response)=>{const viewer=currentAccount(res);requireAdmin(viewer);return viewer;};
 app.use(base,requireAccount(id=>accounts.get(id)));
 app.get(base,route((req,res)=>{const v=currentAccount(res);return s.passives.snapshot(lobby(String(req.params.id),v),v.id);}));
 app.post(`${base}/choose`,route((req,res)=>{
  const v=currentAccount(res),id=lobby(String(req.params.id),v);
  if(!lobbies.isMember(id,v.id))throw new DomainError('NOT_LOBBY_MEMBER','Seul un participant choisit son passif');
  return s.passives.choose(id,v.id,parseBody(passiveChoiceSchema,req.body).passiveId);
 }));
 app.post(`${base}/selection/start`,route((req,res)=>{const v=admin(res),id=lobby(String(req.params.id),v);s.passives.startSelection(id,v.id);return s.passives.snapshot(id,v.id);}));
 app.post(`${base}/race/start`,route((req,res)=>{const v=admin(res),id=lobby(String(req.params.id),v);s.passives.startRace(id,v.id,parseBody(passiveStartSchema,req.body).force);return s.passives.snapshot(id,v.id);}));
 app.post(`${base}/offers/reset`,route((req,res)=>{const v=admin(res),id=lobby(String(req.params.id),v);s.passives.resetOffer(id,parseBody(passiveAccountSchema,req.body).accountId,v.id);return s.passives.snapshot(id,v.id);}));
 app.post(`${base}/offers/cancel-choice`,route((req,res)=>{const v=admin(res),id=lobby(String(req.params.id),v);s.passives.cancelChoice(id,parseBody(passiveAccountSchema,req.body).accountId,v.id);return s.passives.snapshot(id,v.id);}));
 app.patch(`${base}/settings`,route((req,res)=>{const v=admin(res),id=lobby(String(req.params.id),v);s.passives.updateSettings(id,req.body,v.id);return s.passives.snapshot(id,v.id);}));
 app.post(`${base}/grant`,route((req,res)=>{
  const v=admin(res),id=lobby(String(req.params.id),v),{accountId,passiveId}=parseBody(passiveGrantSchema,req.body);
  res.status(201);return s.passives.grant(id,accountId,passiveId,'ADMIN',{actorId:v.id});
 }));
 app.post(`${base}/revoke`,route((req,res)=>{
  const v=admin(res),id=lobby(String(req.params.id),v),{accountId,passiveId}=parseBody(passiveGrantSchema,req.body);
  s.passives.revoke(id,accountId,passiveId,{actorId:v.id,reason:'retrait par un admin'});return {ok:true};
 }));
}
