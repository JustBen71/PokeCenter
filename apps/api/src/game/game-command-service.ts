import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import type {ErrorCode} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import type {AuditService} from '../audit/audit-service.js';
import type {NativeAck,NativeCommand} from '../native-clients.js';

export type GameCommandName=Extract<NativeCommand['command'],`game.${string}`|'pokemon.purchase'>;
export type GameCommandStatus='SENT'|'COMPLETED'|'FAILED'|'REVIEW'|'RESOLVED_APPLIED'|'RESOLVED_NOT_APPLIED';
export type GameCommandRecord={id:string;lobbyId:string;accountId:string;runId:string|null;actorAccountId:string|null;command:GameCommandName;
 status:GameCommandStatus;errorCode:string|null;result:Record<string,unknown>|null;createdAt:string;updatedAt:string};
export type GameCommandOutcome={commandId:string;status:'COMPLETED'|'FAILED'|'REVIEW';result:Record<string,unknown>;errorCode:string|null};

// Client refusals emitted before anything is written: the game is known to be unchanged.
const REFUSED=new Set(['state_changed','invalid_payload','invalid_pokemon','invalid_slot','invalid_money','party_full','last_pokemon','insufficient_money','money_overflow',
 'writes_disabled','profile_read_only','write_unavailable','purchase_unavailable','unknown_command','command_id_reused','command_cache_full','invalid_command','invalid_command_id','protocol_mismatch','bridge_disconnected','invalid_purchase',
 'not_safe','battle_busy','battle_unavailable','invalid_battle','party_fainted','box_full','box_unavailable','reset_unavailable','archive_failed']);
const domainCode:Record<string,ErrorCode>={state_changed:'GAME_STATE_CHANGED',party_full:'PARTY_FULL',last_pokemon:'LAST_POKEMON',insufficient_money:'INSUFFICIENT_FUNDS',
 writes_disabled:'WRITES_DISABLED',profile_read_only:'WRITES_DISABLED',invalid_pokemon:'INVALID_POKEMON',bridge_disconnected:'GAME_NOT_CONNECTED'};
const messages:Partial<Record<ErrorCode,string>>={
 GAME_STATE_CHANGED:'Le jeu a changé depuis la dernière observation : rien n’a été modifié, réessayez.',
 PARTY_FULL:'L’équipe est déjà complète.',LAST_POKEMON:'Le joueur doit garder au moins un Pokémon.',INSUFFICIENT_FUNDS:'Pas assez de Pokédollars dans le jeu.',
 WRITES_DISABLED:'Les écritures sont désactivées sur le client de ce joueur.',INVALID_POKEMON:'Copie Pokémon refusée par le client.',GAME_NOT_CONNECTED:'BizHawk n’est plus relié au client.'
};
type Row={id:string;lobby_id:string;account_id:string;run_id:string|null;actor_account_id:string|null;command:GameCommandName;status:GameCommandStatus;error_code:string|null;result_json:string|null;created_at:string;updated_at:string};
const toRecord=(r:Row):GameCommandRecord=>({id:r.id,lobbyId:r.lobby_id,accountId:r.account_id,runId:r.run_id,actorAccountId:r.actor_account_id,command:r.command,status:r.status,errorCode:r.error_code,result:r.result_json?JSON.parse(r.result_json):null,createdAt:r.created_at,updatedAt:r.updated_at});

/**
 * The only way the portal changes a game. Features never call the client directly:
 * they take the player lock, check the game context, then `send` a business command here.
 * Every command is persisted with its UUID; an unknown outcome becomes REVIEW and is never retried.
 */
export class GameCommandService{
 constructor(private readonly deps:{
  db:Database.Database;audit:AuditService;
  sender:(lobbyId:string,playerId:string,command:NativeCommand,timeoutMs:number)=>Promise<NativeAck>;
  locks:(lobbyId:string)=>Set<string>;timeoutMs?:number;
 }){}

 // One sensitive action at a time per player; other players are not blocked.
 async withPlayerLock<T>(lobbyId:string,accountId:string,work:()=>Promise<T>):Promise<T>{
  const locks=this.deps.locks(lobbyId);
  if(locks.has(accountId))throw new DomainError('PLAYER_BUSY','Une autre action est en cours sur la partie de ce joueur');
  locks.add(accountId);
  try{return await work();}finally{locks.delete(accountId);}
 }

 async send(input:{lobbyId:string;accountId:string;playerId:string;runId:string|null;actorAccountId:string|null;command:GameCommandName;payload:Record<string,unknown>;commandId?:string}):Promise<GameCommandOutcome>{
  const commandId=input.commandId??randomUUID(),now=nowIso();
  this.deps.db.prepare(`INSERT INTO game_commands(id,lobby_id,account_id,run_id,actor_account_id,command,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'SENT',?,?)`)
   .run(commandId,input.lobbyId,input.accountId,input.runId,input.actorAccountId,input.command,JSON.stringify(input.payload),now,now);
  let outcome:GameCommandOutcome;
  try{
   const ack=await this.deps.sender(input.lobbyId,input.playerId,{type:'COMMAND',protocolVersion:1,commandId,command:input.command,payload:input.payload},this.deps.timeoutMs??15000);
   if(ack.ok)outcome={commandId,status:'COMPLETED',result:ack.result??{},errorCode:null};
   else{const code=ack.error?.code??'unknown_error';outcome={commandId,status:REFUSED.has(code)?'FAILED':'REVIEW',result:{},errorCode:code};}
  }catch{outcome={commandId,status:'REVIEW',result:{},errorCode:'outcome_unknown'};}
  this.deps.db.prepare('UPDATE game_commands SET status=?,error_code=?,result_json=?,updated_at=? WHERE id=?')
   .run(outcome.status,outcome.errorCode,JSON.stringify(outcome.result),nowIso(),commandId);
  this.deps.audit.record({lobbyId:input.lobbyId,actorAccountId:input.actorAccountId,targetAccountId:input.accountId,runId:input.runId,category:'GAME_COMMAND',action:input.command,commandId,
   status:outcome.status==='COMPLETED'?'SUCCESS':outcome.status==='FAILED'?'FAILED':'REVIEW',errorCode:outcome.status==='REVIEW'?'COMMAND_OUTCOME_UNKNOWN':outcome.errorCode?domainCode[outcome.errorCode]??'GAME_COMMAND_FAILED':null,
   message:outcome.status==='COMPLETED'?`Commande ${input.command} confirmée par le jeu`:outcome.status==='FAILED'?`Commande ${input.command} refusée par le client (${outcome.errorCode}) : jeu inchangé`:`Confirmation perdue pour ${input.command} : état du jeu à vérifier`,
   metadata:{command:input.command,clientError:outcome.errorCode}});
  return outcome;
 }

 // Turns a non-completed outcome into the matching stable API error.
 static raise(outcome:GameCommandOutcome):never{
  if(outcome.status==='REVIEW')throw new DomainError('COMMAND_OUTCOME_UNKNOWN','Confirmation perdue : vérifiez l’état du jeu avant toute nouvelle tentative. L’opération est à résoudre par un admin.',{commandId:outcome.commandId,clientError:outcome.errorCode});
  const code=domainCode[outcome.errorCode??'']??'GAME_COMMAND_FAILED';
  throw new DomainError(code,messages[code]??`Le client a refusé la commande (${outcome.errorCode})`,{commandId:outcome.commandId,clientError:outcome.errorCode});
 }

 list(lobbyId:string,status?:GameCommandStatus):GameCommandRecord[]{
  return (this.deps.db.prepare(`SELECT * FROM game_commands WHERE lobby_id=? ${status?'AND status=?':''} ORDER BY created_at DESC LIMIT 200`).all(...(status?[lobbyId,status]:[lobbyId])) as Row[]).map(toRecord);
 }
 get(id:string):GameCommandRecord|undefined{const row=this.deps.db.prepare('SELECT * FROM game_commands WHERE id=?').get(id) as Row|undefined;return row&&toRecord(row);}

 // Manual reconciliation after an admin checked the game: records whether the command was applied.
 resolve(id:string,applied:boolean,actorAccountId:string):GameCommandRecord{
  const command=this.get(id);
  if(!command)throw new DomainError('NOT_FOUND','Commande introuvable');
  if(command.status!=='REVIEW')throw new DomainError('CONFLICT','Cette commande n’attend pas de vérification');
  this.deps.db.prepare('UPDATE game_commands SET status=?,updated_at=? WHERE id=?').run(applied?'RESOLVED_APPLIED':'RESOLVED_NOT_APPLIED',nowIso(),id);
  this.deps.audit.record({lobbyId:command.lobbyId,actorAccountId,targetAccountId:command.accountId,runId:command.runId,category:'ADMIN',action:'game_command.resolve',commandId:id,status:'SUCCESS',
   message:`Commande ${command.command} résolue manuellement : ${applied?'appliquée':'non appliquée'}`});
  return this.get(id)!;
 }
}
