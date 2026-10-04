import type {Express} from 'express';
import {z} from 'zod';
import {auditCategorySchema} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import {parseBody,requireAdminAccount,route} from '../http.js';
import type {Services} from '../services.js';

const filterSchema=z.object({
 accountId:z.string().max(64).optional(),category:auditCategorySchema.optional(),
 outcome:z.enum(['success','error']).optional(),commandId:z.string().max(64).optional(),
 from:z.string().datetime().optional(),to:z.string().datetime().optional(),limit:z.coerce.number().int().min(1).max(500).optional()
}).strict();

/** Admin audit trail of a lobby: filters, then the full picture of one entry (transactions, game command). */
export function registerAuditRoutes(app:Express,s:Services){
 const {accounts,lobbies,audit,ledger}=s.domain;
 app.use('/api/lobbies/:id/audit',requireAdminAccount(id=>accounts.get(id)));
 app.get('/api/lobbies/:id/audit',route(req=>{
  const lobbyId=lobbies.require(String(req.params.id)).id;
  const f=parseBody(filterSchema,Object.fromEntries(Object.entries(req.query).filter(([,v])=>v!==''&&v!==undefined)));
  const rows=audit.list({lobbyId,includeGlobal:true,accountId:f.accountId,category:f.category,commandId:f.commandId,from:f.from,to:f.to,limit:f.limit??200});
  // "error" groups every non-successful outcome; "success" keeps successes and informational entries.
  return f.outcome==='error'?rows.filter(r=>['FAILED','REVIEW'].includes(r.status)):f.outcome==='success'?rows.filter(r=>['SUCCESS','INFO'].includes(r.status)):rows;
 }));
 app.get('/api/lobbies/:id/audit/:logId',route(req=>{
  const lobbyId=lobbies.require(String(req.params.id)).id;
  const log=audit.get(String(req.params.logId));
  if(!log||(log.lobbyId!==null&&log.lobbyId!==lobbyId))throw new DomainError('NOT_FOUND','Entrée introuvable');
  const command=log.commandId?s.commands.get(log.commandId)??null:null;
  return {log,command,transactions:log.commandId?ledger.byCommand(log.commandId):[],related:log.commandId?audit.list({lobbyId,commandId:log.commandId}):[]};
 }));
}
