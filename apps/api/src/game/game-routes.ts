import type {Express} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DomainError} from '../errors.js';
import {currentAccount,parseBody,requireAdminAccount,route} from '../http.js';
import type {Services} from '../services.js';

const moneyAdjustSchema=z.object({operation:z.enum(['add','remove']),amount:z.number().int().min(1).max(999999),reason:z.string().trim().max(200).optional()}).strict();
const resolveSchema=z.object({applied:z.boolean()}).strict();

/** Admin game actions (Sprint 3): library, party edits, money corrections and REVIEW reconciliation. */
export function registerGameRoutes(app:Express,s:Services,changed:(lobbyId:string,topic:string)=>void){
 const {accounts,lobbies,ledger,audit}=s.domain;
 for(const path of ['/api/library','/api/lobbies/:id/players','/api/lobbies/:id/game-commands'])app.use(path,requireAdminAccount(id=>accounts.get(id)));
 const target=(lobbyId:string,accountId:string)=>{
  lobbies.require(lobbyId);
  if(!lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Ce joueur ne participe pas à ce lobby');
  return accounts.get(accountId)!;
 };

 app.get('/api/library',route(()=>s.library.list()));
 app.post('/api/library',route((req,res)=>{
  const item=s.library.create(req.body,currentAccount(res).id);
  audit.record({actorAccountId:currentAccount(res).id,category:'POKEMON',action:'library.create',status:'SUCCESS',message:`« ${item.label} » ajouté à la bibliothèque`,metadata:{format:item.artifact.format,species:item.artifact.species}});
  res.status(201);return item;
 }));
 app.delete('/api/library/:id',route((req,res)=>{
  const item=s.library.require(String(req.params.id));s.library.delete(item.id);
  audit.record({actorAccountId:currentAccount(res).id,category:'POKEMON',action:'library.delete',status:'SUCCESS',message:`« ${item.label} » retiré de la bibliothèque`});
  return {ok:true};
 }));

 app.post('/api/lobbies/:id/players/:accountId/pokemon',route(async(req,res)=>{
  const lobbyId=String(req.params.id),player=target(lobbyId,String(req.params.accountId));
  return s.pokemon.apply(lobbyId,player.id,currentAccount(res),req.body);
 }));
 app.post('/api/lobbies/:id/players/:accountId/money',route(async(req,res)=>{
  const lobbyId=String(req.params.id),player=target(lobbyId,String(req.params.accountId)),actor=currentAccount(res);
  const {operation,amount,reason}=parseBody(moneyAdjustSchema,req.body);
  const result=await s.transactions.apply({lobbyId,accountId:player.id,actorAccountId:actor.id,idempotencyKey:`admin:${randomUUID()}`,
   legs:[{type:'ADMIN_ADJUSTMENT',amount,source:operation==='add'?'EXTERNAL':'GAME',destination:operation==='add'?'GAME':'EXTERNAL',metadata:reason?{reason}:undefined}],
   audit:{category:'ADMIN',action:`money.${operation}`,message:`${operation==='add'?'Ajout':'Retrait'} de ${amount} ₽ pour ${player.name}${reason?` (${reason})`:''}`}});
  changed(lobbyId,'money');return result;
 }));

 app.get('/api/lobbies/:id/game-commands',route(req=>{
  const status=req.query.status==='REVIEW'?'REVIEW' as const:undefined;
  // moneyTypes names the business operation (bank deposit…) behind a game write, for the admin review list.
  return s.commands.list(lobbies.require(String(req.params.id)).id,status)
   .map(c=>({...c,moneyTypes:[...new Set(ledger.byCommand(c.id).map(t=>t.type))]}));
 }));
 // After checking the game, an admin states whether the uncertain command was applied; linked money rows follow.
 app.post('/api/lobbies/:id/game-commands/:commandId/resolve',route((req,res)=>{
  const lobbyId=String(req.params.id),{applied}=parseBody(resolveSchema,req.body);
  const command=s.commands.get(String(req.params.commandId));
  if(!command||command.lobbyId!==lobbyId)throw new DomainError('NOT_FOUND','Commande introuvable dans ce lobby');
  const resolved=ledger.atomic(()=>{
   const record=s.commands.resolve(command.id,applied,currentAccount(res).id);
   for(const t of ledger.byCommand(command.id))if(t.status==='REVIEW'||t.status==='APPLYING')ledger.transition(t.id,applied?'CONFIRMED':'FAILED');
   s.objectives.commandResolved(command.id,applied);
   s.auctions.commandResolved(command.id,applied);
   s.shop.commandResolved(command.id,applied);
   s.passiveEngine.commandResolved(command.id,applied);
   s.battles.commandResolved(command.id,applied);
   return record;
  });
  changed(lobbyId,'money');return resolved;
 }));
}
