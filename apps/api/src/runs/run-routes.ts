import type {Express} from 'express';
import {runCreateSchema,runStatusChangeSchema,runStatusLabels,type Run,type RunJournalEntry} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import {currentAccount,parseBody,requireAccount,requireAdmin,route} from '../http.js';
import type {PortalDomain} from '../store.js';

/**
 * Run management. Every member reads the lobby's Runs; only admins start, end or create them.
 * Each change is audited and pushed to the lobby dashboards so the Course page updates live.
 */
export function registerRunRoutes(app:Express,domain:PortalDomain,publish:(lobbyId:string,runs:Run[])=>void,runChanged:(lobbyId:string,run:Run)=>void=()=>{}){
 const {accounts,lobbies,runs,audit}=domain;
 const member=(lobbyId:string,accountId:string,admin:boolean)=>{
  lobbies.require(lobbyId);
  if(!admin&&!lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
 };
 const changed=(lobbyId:string)=>publish(lobbyId,runs.listForLobby(lobbyId));
 app.use('/api/lobbies/:id/runs',requireAccount(id=>accounts.get(id)));
 app.get('/api/lobbies/:id/runs',route((req,res)=>{
  const viewer=currentAccount(res),lobbyId=String(req.params.id);
  member(lobbyId,viewer.id,viewer.admin);
  return runs.listForLobby(lobbyId);
 }));
 const journalActions=new Set<string>(['run.lost','pokemon.boxed','run.reset','run.reset_failed']);
 app.get('/api/lobbies/:id/runs/journal',route((req,res)=>{
  const viewer=currentAccount(res),lobbyId=String(req.params.id),accountId=String(req.query.accountId??'');
  member(lobbyId,viewer.id,viewer.admin);
  return audit.list({lobbyId,accountId,category:'RUN',limit:200}).filter(l=>l.targetAccountId===accountId&&journalActions.has(l.action))
   .map((l):RunJournalEntry=>({id:l.id,action:l.action as RunJournalEntry['action'],message:l.message,runId:l.runId,at:l.timestamp}));
 }));
 app.post('/api/lobbies/:id/runs',route((req,res)=>{
  const viewer=currentAccount(res),lobbyId=String(req.params.id);requireAdmin(viewer);lobbies.require(lobbyId);
  const {accountId,start}=parseBody(runCreateSchema,req.body);
  const target=accounts.get(accountId);if(!target)throw new DomainError('ACCOUNT_NOT_FOUND','Compte introuvable');
  const run=runs.create(lobbyId,accountId,{start});
  audit.record({lobbyId,actorAccountId:viewer.id,targetAccountId:accountId,runId:run.id,category:'RUN',action:'run.create',status:'SUCCESS',message:`Run #${run.number} de ${target.name} créée (${runStatusLabels[run.status]})`});
  changed(lobbyId);runChanged(lobbyId,run);res.status(201);return run;
 }));
 app.post('/api/lobbies/:id/runs/:runId/status',route((req,res)=>{
  const viewer=currentAccount(res),lobbyId=String(req.params.id);requireAdmin(viewer);
  const {status}=parseBody(runStatusChangeSchema,req.body);
  const before=runs.require(String(req.params.runId));
  if(before.lobbyId!==lobbyId)throw new DomainError('RUN_NOT_FOUND','Run introuvable dans ce lobby');
  const run=runs.transition(before.id,status);
  const name=accounts.get(run.accountId)?.name??run.accountId;
  audit.record({lobbyId,actorAccountId:viewer.id,targetAccountId:run.accountId,runId:run.id,category:'RUN',action:'run.status',status:'SUCCESS',
   message:`Run #${run.number} de ${name} : ${runStatusLabels[before.status]} → ${runStatusLabels[run.status]}`,metadata:{from:before.status,to:run.status}});
  changed(lobbyId);runChanged(lobbyId,run);return run;
 }));
}
