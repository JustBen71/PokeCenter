import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {runTransitions,type Run,type RunStatus} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';

type Row={id:string;lobby_id:string;account_id:string;number:number;status:RunStatus;started_at:string|null;ended_at:string|null;created_at:string;updated_at:string};
const toRun=(r:Row):Run=>({id:r.id,lobbyId:r.lobby_id,accountId:r.account_id,number:r.number,status:r.status,startedAt:r.started_at,endedAt:r.ended_at,createdAt:r.created_at,updatedAt:r.updated_at});
const terminal=(s:RunStatus)=>runTransitions[s].length===0;
// The partial unique index is the last line of defence when two requests race.
const isRunningConflict=(e:unknown)=>e instanceof Error&&/UNIQUE constraint failed: runs\.lobby_id, runs\.account_id/.test(e.message);

export class RunService{
 constructor(private readonly db:Database.Database){}
 get(id:string):Run|undefined{const row=this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as Row|undefined;return row&&toRun(row);}
 require(id:string):Run{const run=this.get(id);if(!run)throw new DomainError('RUN_NOT_FOUND','Run introuvable');return run;}
 // History is newest first; previous attempts are never deleted.
 history(lobbyId:string,accountId:string):Run[]{return (this.db.prepare('SELECT * FROM runs WHERE lobby_id=? AND account_id=? ORDER BY number DESC').all(lobbyId,accountId) as Row[]).map(toRun);}
 listForLobby(lobbyId:string):Run[]{return (this.db.prepare('SELECT * FROM runs WHERE lobby_id=? ORDER BY account_id,number DESC').all(lobbyId) as Row[]).map(toRun);}
 running(lobbyId:string,accountId:string):Run|undefined{const row=this.db.prepare("SELECT * FROM runs WHERE lobby_id=? AND account_id=? AND status='RUNNING'").get(lobbyId,accountId) as Row|undefined;return row&&toRun(row);}
 // The current Run is the RUNNING one, otherwise the latest attempt that has not started yet.
 current(lobbyId:string,accountId:string):Run|undefined{
  const row=this.db.prepare("SELECT * FROM runs WHERE lobby_id=? AND account_id=? AND status IN ('RUNNING','NOT_STARTED') ORDER BY status='RUNNING' DESC,number DESC LIMIT 1").get(lobbyId,accountId) as Row|undefined;
  return row&&toRun(row);
 }

 create(lobbyId:string,accountId:string,options:{start?:boolean}={}):Run{
  if(!this.db.prepare('SELECT 1 FROM lobby_members WHERE lobby_id=? AND account_id=?').get(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Ce joueur ne participe pas à ce lobby');
  const id=randomUUID(),now=nowIso();
  try{
   this.db.transaction(()=>{
    if(options.start&&this.running(lobbyId,accountId))throw new DomainError('RUN_ALREADY_RUNNING','Une Run est déjà en cours pour ce joueur');
    const {next}=this.db.prepare('SELECT COALESCE(MAX(number),0)+1 AS next FROM runs WHERE lobby_id=? AND account_id=?').get(lobbyId,accountId) as {next:number};
    this.db.prepare('INSERT INTO runs(id,lobby_id,account_id,number,status,started_at,ended_at,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?,?)')
     .run(id,lobbyId,accountId,next,options.start?'RUNNING':'NOT_STARTED',options.start?now:null,now,now);
   })();
  }catch(e){if(isRunningConflict(e))throw new DomainError('RUN_ALREADY_RUNNING','Une Run est déjà en cours pour ce joueur');throw e;}
  return this.get(id)!;
 }

 transition(id:string,to:RunStatus):Run{
  const run=this.require(id);
  if(!runTransitions[run.status].includes(to))throw new DomainError('INVALID_RUN_TRANSITION',`Impossible de passer une Run ${run.status} à ${to}`,{from:run.status,to});
  const now=nowIso();
  try{
   const changed=this.db.prepare('UPDATE runs SET status=?,started_at=COALESCE(started_at,?),ended_at=?,updated_at=? WHERE id=? AND status=?')
    .run(to,to==='RUNNING'?now:null,terminal(to)?now:null,now,id,run.status).changes;
   if(changed===0)throw new DomainError('CONFLICT','La Run a été modifiée entre-temps');
  }catch(e){if(isRunningConflict(e))throw new DomainError('RUN_ALREADY_RUNNING','Une Run est déjà en cours pour ce joueur');throw e;}
  return this.get(id)!;
 }
 start(id:string){return this.transition(id,'RUNNING');}
}
