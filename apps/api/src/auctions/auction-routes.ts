import type {Express} from 'express';
import {DomainError} from '../errors.js';
import {currentAccount,requireAccount,requireAdmin,route} from '../http.js';
import type {Services} from '../services.js';

/** Lobby auctions: members read and bid for themselves; admins generate, close, cancel and copy lots. */
export function registerAuctionRoutes(app:Express,s:Services){
 const {accounts,lobbies}=s.domain;
 const lobby=(id:string,viewer:{id:string;admin:boolean})=>{
  const found=lobbies.require(id);
  if(!viewer.admin&&!lobbies.isMember(found.id,viewer.id))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  return found.id;
 };
 const admin=(res:Parameters<typeof currentAccount>[0])=>{const viewer=currentAccount(res);requireAdmin(viewer);return viewer;};
 app.use('/api/lobbies/:id/auctions',requireAccount(id=>accounts.get(id)));
 app.get('/api/lobbies/:id/auctions',route((req,res)=>s.auctions.snapshot(lobby(String(req.params.id),currentAccount(res)))));
 app.post('/api/lobbies/:id/auctions',route(async(req,res)=>{const viewer=admin(res);res.status(201);return s.auctions.create(lobby(String(req.params.id),viewer),viewer,req.body);}));
 // Everyone bids for their own account only: the bidder is the session account, never a body field.
 app.post('/api/lobbies/:id/auctions/:auctionId/bid',route((req,res)=>{const viewer=currentAccount(res);return s.auctions.bid(lobby(String(req.params.id),viewer),String(req.params.auctionId),viewer,req.body);}));
 app.post('/api/lobbies/:id/auctions/:auctionId/close',route(async(req,res)=>{const viewer=admin(res);return s.auctions.close(lobby(String(req.params.id),viewer),String(req.params.auctionId),viewer);}));
 app.post('/api/lobbies/:id/auctions/:auctionId/cancel',route((req,res)=>{const viewer=admin(res);return s.auctions.cancel(lobby(String(req.params.id),viewer),String(req.params.auctionId),viewer);}));
 app.post('/api/lobbies/:id/auctions/:auctionId/library',route((req,res)=>{const viewer=admin(res);res.status(201);return s.auctions.copyToLibrary(lobby(String(req.params.id),viewer),String(req.params.auctionId),viewer);}));
}
