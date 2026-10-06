import type Database from 'better-sqlite3';
import {battleTransitions,type BattleEncounter,type BattlePokemonSpec,type BattleResult,type BattleScalingSpec,type BattleSourceType,type BattleSpriteId,type BattleStatus} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';

type Row={id:string;lobby_id:string;account_id:string;run_id:string|null;source_type:BattleSourceType;source_ref_id:string|null;source_label:string;status:BattleStatus;
 trainer_name:string;trainer_sprite:BattleSpriteId;party_json:string;scaling_json:string;command_id:string|null;created_by:string|null;created_at:string;
 started_at:string|null;ended_at:string|null;result_json:string|null;error_code:string|null};
const toEncounter=(r:Row):BattleEncounter=>({id:r.id,lobbyId:r.lobby_id,accountId:r.account_id,runId:r.run_id,sourceType:r.source_type,sourceRefId:r.source_ref_id,sourceLabel:r.source_label,
 status:r.status,trainer:{name:r.trainer_name,spriteId:r.trainer_sprite},party:JSON.parse(r.party_json),scaling:JSON.parse(r.scaling_json),commandId:r.command_id,
 createdBy:r.created_by,createdAt:r.created_at,startedAt:r.started_at,endedAt:r.ended_at,result:r.result_json?JSON.parse(r.result_json):null,errorCode:r.error_code});
const TERMINAL:BattleStatus[]=['WON','LOST','CANCELLED','FAILED'];

/** battle_encounters rows. Every status change goes through `transition`, guarded by the shared state machine. */
export class BattleRepository{
 constructor(private readonly db:Database.Database){}
 get(id:string):BattleEncounter|undefined{const row=this.db.prepare('SELECT * FROM battle_encounters WHERE id=?').get(id) as Row|undefined;return row&&toEncounter(row);}
 require(lobbyId:string,id:string){const e=this.get(id);if(!e||e.lobbyId!==lobbyId)throw new DomainError('NOT_FOUND','Combat introuvable');return e;}
 list(lobbyId:string):BattleEncounter[]{return (this.db.prepare('SELECT * FROM battle_encounters WHERE lobby_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(lobbyId) as Row[]).map(toEncounter);}
 byCommand(commandId:string):BattleEncounter|undefined{const row=this.db.prepare('SELECT * FROM battle_encounters WHERE command_id=?').get(commandId) as Row|undefined;return row&&toEncounter(row);}
 // The queued, in-progress or uncertain battle of a player (at most one, unique index).
 active(lobbyId:string,accountId:string):BattleEncounter|undefined{
  const row=this.db.prepare("SELECT * FROM battle_encounters WHERE lobby_id=? AND account_id=? AND status IN ('WAITING_SAFE_STATE','SENDING','STARTING','RUNNING','REVIEW')").get(lobbyId,accountId) as Row|undefined;
  return row&&toEncounter(row);
 }
 insert(e:{id:string;lobbyId:string;accountId:string;runId:string|null;sourceType:BattleSourceType;sourceRefId:string|null;sourceLabel:string;
  trainer:{name:string;spriteId:BattleSpriteId};party:BattlePokemonSpec[];scaling:BattleScalingSpec;createdBy:string|null}){
  this.db.prepare(`INSERT INTO battle_encounters(id,lobby_id,account_id,run_id,source_type,source_ref_id,source_label,status,trainer_name,trainer_sprite,party_json,options_json,scaling_json,created_by,created_at)
   VALUES(?,?,?,?,?,?,?,'CREATED',?,?,?,?,?,?,?)`).run(e.id,e.lobbyId,e.accountId,e.runId,e.sourceType,e.sourceRefId,e.sourceLabel,e.trainer.name,e.trainer.spriteId,
   JSON.stringify(e.party),JSON.stringify({rewardMode:'GAME_DEFAULT'}),JSON.stringify(e.scaling),e.createdBy,nowIso());
  return this.get(e.id)!;
 }
 /** Moves an encounter from one of `from` to `to`; refused if it changed meanwhile or if the move is not allowed. */
 transition(id:string,to:BattleStatus,patch:{commandId?:string|null;errorCode?:string|null;result?:{outcome:BattleResult;observedAt:string}|null}={}){
  const before=this.get(id);if(!before)throw new DomainError('NOT_FOUND','Combat introuvable');
  if(!battleTransitions[before.status].includes(to))throw new DomainError('CONFLICT',`Un combat ${before.status} ne peut pas passer ${to}`);
  const now=nowIso();
  try{
   const changed=this.db.prepare(`UPDATE battle_encounters SET status=?,command_id=COALESCE(?,command_id),error_code=?,result_json=COALESCE(?,result_json),
    started_at=CASE WHEN ? IN ('STARTING','RUNNING') AND started_at IS NULL THEN ? ELSE started_at END,ended_at=CASE WHEN ? THEN ? ELSE ended_at END WHERE id=? AND status=?`)
    .run(to,patch.commandId??null,patch.errorCode??null,patch.result?JSON.stringify(patch.result):null,to,now,TERMINAL.includes(to)?1:0,now,id,before.status).changes;
   if(!changed)throw new DomainError('CONFLICT','Le combat a changé entre-temps');
  }catch(e){
   if(e instanceof Error&&/UNIQUE constraint failed: battle_encounters/.test(e.message))throw new DomainError('BATTLE_ALREADY_PENDING','Un combat commandité est déjà en attente ou en cours pour ce joueur');
   throw e;
  }
  return {before,after:this.get(id)!};
 }
}
