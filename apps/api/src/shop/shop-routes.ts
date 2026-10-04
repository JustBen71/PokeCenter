import type {Express} from 'express';
import {DomainError} from '../errors.js';
import {currentAccount,requireAccount,requireAdmin,route} from '../http.js';
import type {Services} from '../services.js';

/** Shop for members (tickets, protections) and the admin queue of pending wheels. */
export function registerShopRoutes(app:Express,s:Services){
 const {accounts,lobbies}=s.domain;
 const member=(id:string,accountId:string)=>{
  const lobbyId=lobbies.require(id).id;
  if(!lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  return lobbyId;
 };
 app.use('/api/lobbies/:id/shop',requireAccount(id=>accounts.get(id)));
 app.get('/api/lobbies/:id/shop',route((req,res)=>{const v=currentAccount(res);return s.shop.snapshot(member(String(req.params.id),v.id),v.id);}));
 // The buyer is always the session account.
 app.post('/api/lobbies/:id/shop/tickets',route(async(req,res)=>{const v=currentAccount(res);res.status(201);return s.shop.buyTicket(member(String(req.params.id),v.id),v,req.body);}));
 app.post('/api/lobbies/:id/shop/protections',route(async(req,res)=>{const v=currentAccount(res);res.status(201);return s.shop.buyProtection(member(String(req.params.id),v.id),v,req.body);}));
 app.get('/api/lobbies/:id/shop/protections',route((req,res)=>{
  const v=currentAccount(res);requireAdmin(v);
  return s.shop.allProtections(lobbies.require(String(req.params.id)).id);
 }));
 app.post('/api/lobbies/:id/shop/tickets/:ticketId/resolve',route((req,res)=>{
  const v=currentAccount(res);requireAdmin(v);
  return s.shop.resolveTicket(lobbies.require(String(req.params.id)).id,String(req.params.ticketId),v);
 }));
}
