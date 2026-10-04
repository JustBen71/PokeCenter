import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import type {AuditCategory,AuditLog,AuditStatus,ErrorCode} from '@pokerace/shared';
import {nowIso} from '../db/database.js';

export type NewAuditLog={
 lobbyId?:string|null;actorAccountId?:string|null;targetAccountId?:string|null;runId?:string|null;
 category:AuditCategory;action:string;status:AuditStatus;commandId?:string|null;message:string;errorCode?:ErrorCode|null;metadata?:Record<string,unknown>;
};
export type AuditFilter={includeGlobal?:boolean;lobbyId?:string;accountId?:string;category?:AuditCategory;status?:AuditStatus;commandId?:string;from?:string;to?:string;limit?:number};
type Row={id:string;timestamp:string;lobby_id:string|null;actor_account_id:string|null;target_account_id:string|null;run_id:string|null;category:AuditCategory;
 action:string;status:AuditStatus;command_id:string|null;message:string;error_code:ErrorCode|null;metadata_json:string};

// Secrets, tokens and memory payloads never reach the audit trail, whatever the caller passes.
const forbiddenKey=/token|secret|password|authorization|cookie|raw|memory|dump|romsha|sha256/i;
const MAX_STRING=500,MAX_DEPTH=4,MAX_ITEMS=50;
export function sanitizeMetadata(value:unknown,depth=0):unknown{
 if(typeof value==='string')return value.length>MAX_STRING?value.slice(0,MAX_STRING)+'…':value;
 if(value===null||value===undefined||typeof value==='number'||typeof value==='boolean')return value;
 if(typeof value!=='object')return String(value);
 if(depth>=MAX_DEPTH)return '[truncated]';
 if(Array.isArray(value))return value.slice(0,MAX_ITEMS).map(v=>sanitizeMetadata(v,depth+1));
 const out:Record<string,unknown>={};
 for(const [k,v] of Object.entries(value).slice(0,MAX_ITEMS))out[k]=forbiddenKey.test(k)?'[redacted]':sanitizeMetadata(v,depth+1);
 return out;
}
const toLog=(r:Row):AuditLog=>({id:r.id,timestamp:r.timestamp,lobbyId:r.lobby_id,actorAccountId:r.actor_account_id,targetAccountId:r.target_account_id,runId:r.run_id,
 category:r.category,action:r.action,status:r.status,commandId:r.command_id,message:r.message,errorCode:r.error_code,metadata:JSON.parse(r.metadata_json)});

export class AuditService{
 constructor(private readonly db:Database.Database){}
 record(entry:NewAuditLog):AuditLog{
  const id=randomUUID();
  this.db.prepare(`INSERT INTO audit_logs(id,timestamp,lobby_id,actor_account_id,target_account_id,run_id,category,action,status,command_id,message,error_code,metadata_json)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,nowIso(),entry.lobbyId??null,entry.actorAccountId??null,entry.targetAccountId??null,entry.runId??null,
   entry.category,entry.action.slice(0,80),entry.status,entry.commandId??null,entry.message.slice(0,MAX_STRING),entry.errorCode??null,JSON.stringify(sanitizeMetadata(entry.metadata??{})));
  return toLog(this.db.prepare('SELECT * FROM audit_logs WHERE id=?').get(id) as Row);
 }
 get(id:string):AuditLog|undefined{const row=this.db.prepare('SELECT * FROM audit_logs WHERE id=?').get(id) as Row|undefined;return row&&toLog(row);}
 list(filter:AuditFilter={}):AuditLog[]{
  const where:string[]=[],args:unknown[]=[];
  // Global events (accounts, roles) have no lobby; a lobby view may include them.
  if(filter.lobbyId){where.push(filter.includeGlobal?'(lobby_id=? OR lobby_id IS NULL)':'lobby_id=?');args.push(filter.lobbyId);}
  if(filter.accountId){where.push('(actor_account_id=? OR target_account_id=?)');args.push(filter.accountId,filter.accountId);}
  if(filter.category){where.push('category=?');args.push(filter.category);}
  if(filter.status){where.push('status=?');args.push(filter.status);}
  if(filter.commandId){where.push('command_id=?');args.push(filter.commandId);}
  if(filter.from){where.push('timestamp>=?');args.push(filter.from);}
  if(filter.to){where.push('timestamp<=?');args.push(filter.to);}
  args.push(Math.min(Math.max(filter.limit??100,1),500));
  return (this.db.prepare(`SELECT * FROM audit_logs ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY timestamp DESC,rowid DESC LIMIT ?`).all(...args) as Row[]).map(toLog);
 }
}
