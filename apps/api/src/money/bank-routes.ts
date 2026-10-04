import type {Express} from 'express';
import {DomainError} from '../errors.js';
import {currentAccount,requireAccount,requireAdmin,route} from '../http.js';
import type {Services} from '../services.js';

/** Bank of the current account, public jackpot and lobby financial settings. */
export function registerBankRoutes(app:Express,s:Services,changed:(lobbyId:string)=>void){
 const {accounts,lobbies,audit}=s.domain;
 const member=(lobbyId:string,accountId:string)=>{
  lobbies.require(lobbyId);
  if(!lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  return lobbyId;
 };
 for(const path of ['/api/lobbies/:id/bank','/api/lobbies/:id/jackpot','/api/lobbies/:id/settings'])app.use(path,requireAccount(id=>accounts.get(id)));
 // A player only operates their own bank; the money never moves for someone else from here.
 app.get('/api/lobbies/:id/bank',route((req,res)=>s.bank.snapshot(member(String(req.params.id),currentAccount(res).id),currentAccount(res).id)));
 app.post('/api/lobbies/:id/bank/deposit',route(async(req,res)=>{
  const lobbyId=member(String(req.params.id),currentAccount(res).id);
  try{return await s.bank.deposit(lobbyId,currentAccount(res).id,req.body);}finally{changed(lobbyId);}
 }));
 app.post('/api/lobbies/:id/bank/withdraw',route(async(req,res)=>{
  const lobbyId=member(String(req.params.id),currentAccount(res).id);
  try{return await s.bank.withdraw(lobbyId,currentAccount(res).id,req.body);}finally{changed(lobbyId);}
 }));
 app.get('/api/lobbies/:id/jackpot',route((req,res)=>{
  const viewer=currentAccount(res),lobbyId=String(req.params.id);
  if(!viewer.admin)member(lobbyId,viewer.id);else lobbies.require(lobbyId);
  return s.jackpot.snapshot(lobbyId);
 }));
 app.post('/api/lobbies/:id/jackpot/adjust',route(async(req,res)=>{
  const viewer=currentAccount(res);requireAdmin(viewer);
  const lobbyId=lobbies.require(String(req.params.id)).id;
  try{return await s.jackpot.adjust(lobbyId,viewer,req.body);}finally{changed(lobbyId);}
 }));
 app.get('/api/lobbies/:id/settings',route((req,res)=>{
  const viewer=currentAccount(res),lobbyId=String(req.params.id);
  if(!viewer.admin)member(lobbyId,viewer.id);else lobbies.require(lobbyId);
  return lobbies.settings(lobbyId);
 }));
 app.patch('/api/lobbies/:id/settings',route((req,res)=>{
  const viewer=currentAccount(res);requireAdmin(viewer);
  const lobbyId=lobbies.require(String(req.params.id)).id,before=lobbies.settings(lobbyId);
  const after=lobbies.updateSettings(lobbyId,req.body??{});
  audit.record({lobbyId,actorAccountId:viewer.id,category:'ADMIN',action:'lobby.settings',status:'SUCCESS',message:'Paramètres financiers du lobby modifiés',metadata:{from:before,to:after}});
  changed(lobbyId);return after;
 }));
}
