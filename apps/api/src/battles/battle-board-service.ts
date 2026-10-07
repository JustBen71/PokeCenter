import {randomInt,randomUUID} from 'node:crypto';
import {battleSpriteIds,boardReward,boardRewardSchema,boardTeamCreateSchema,isLegendary,type BattleEncounter,type BattlePokemonSpec,type BoardRewardStatus,
 type BoardSlot,type BoardSnapshot,type BoardTeam,type BoardTeamStatus,type LobbyNotification} from '@pokerace/shared';
import type Database from 'better-sqlite3';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import type {PortalDomain} from '../store.js';
import type {CurrentGameService} from '../game/current-game-service.js';
import type {TransactionService} from '../money/transaction-service.js';
import type {BattleEncounterService} from './battle-encounter-service.js';
import {validateBattleSpec} from './battle-validator.js';
import {drawParty,type MovesProvider} from './board-draw.js';

type Row={id:string;lobby_id:string;trainer_name:string;trainer_sprite:string;slots_json:string;party_json:string;reward:number;status:BoardTeamStatus;origin:'ADMIN'|'WHEEL';
 created_by:string|null;created_at:string;challenger_id:string|null;encounter_id:string|null;winner_id:string|null;won_at:string|null;reward_status:BoardRewardStatus;reward_attempts:number;reward_command_id:string|null};
const toTeam=(r:Row):BoardTeam=>{
 const party=JSON.parse(r.party_json) as BattlePokemonSpec[];
 return {id:r.id,lobbyId:r.lobby_id,trainer:{name:r.trainer_name,spriteId:r.trainer_sprite as BoardTeam['trainer']['spriteId']},party,slots:JSON.parse(r.slots_json) as BoardSlot[],
  reward:r.reward,suggestedReward:boardReward(party),legendaries:party.filter(p=>isLegendary(p.speciesId)).length,status:r.status,origin:r.origin,createdBy:r.created_by,createdAt:r.created_at,
  challengerId:r.challenger_id,encounterId:r.encounter_id,winnerId:r.winner_id,wonAt:r.won_at,rewardStatus:r.reward_status,attempts:r.reward_attempts};
};
const MAX_REWARD_ATTEMPTS=5;
const fmt=(n:number)=>`${n.toLocaleString('fr-FR')} ₽`;
const levels=(party:BattlePokemonSpec[])=>{const l=party.map(p=>p.level);return Math.min(...l)===Math.max(...l)?`niv. ${l[0]}`:`niv. ${Math.min(...l)}–${Math.max(...l)}`;};

/**
 * Tableau des combats. First come, first served: the first player who accepts reserves the team (atomic) and fights it
 * as a commanded battle in their game; a win pays the reward into the game (retried until paid, never twice), a loss or
 * a cancelled battle puts the team back on the board. The defeat itself is the game's (end of Run).
 */
export class BattleBoardService{
 private readonly paying=new Set<string>();
 constructor(private readonly deps:{domain:PortalDomain;db:Database.Database;battles:BattleEncounterService;currentGame:CurrentGameService;transactions:()=>TransactionService;
  moves:MovesProvider;changed:(lobbyId:string)=>void;notify:(lobbyId:string,n:LobbyNotification)=>void}){}
 private name(id:string|null){return id?this.deps.domain.accounts.get(id)?.name??id:'—';}
 private row(lobbyId:string,id:string){
  const row=this.deps.db.prepare('SELECT * FROM battle_board_teams WHERE lobby_id=? AND id=?').get(lobbyId,id) as Row|undefined;
  if(!row)throw new DomainError('NOT_FOUND','Équipe introuvable au tableau');
  return toTeam(row);
 }
 private audit(t:BoardTeam,action:string,message:string,options:{actorId?:string|null;targetId?:string|null;status?:'SUCCESS'|'INFO'|'FAILED'|'REVIEW';commandId?:string|null}={}){
  this.deps.domain.audit.record({lobbyId:t.lobbyId,actorAccountId:options.actorId??null,targetAccountId:options.targetId??null,category:'BATTLE',action,status:options.status??'SUCCESS',
   commandId:options.commandId??null,message,metadata:{boardTeamId:t.id,trainer:t.trainer.name,reward:t.reward}});
 }
 private set(id:string,fields:Record<string,unknown>,whereStatus?:BoardTeamStatus){
  const keys=Object.keys(fields);
  return this.deps.db.prepare(`UPDATE battle_board_teams SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?${whereStatus?' AND status=?':''}`)
   .run(...keys.map(k=>fields[k]),id,...(whereStatus?[whereStatus]:[])).changes;
 }

 snapshot(lobbyId:string):BoardSnapshot{
  return {teams:(this.deps.db.prepare('SELECT * FROM battle_board_teams WHERE lobby_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200').all(lobbyId) as Row[]).map(toTeam)};
 }
 get(lobbyId:string,id:string){return this.row(lobbyId,id);}

 /** Admin (or wheel): draws the team once, so what everybody sees is exactly what will be fought. */
 async create(lobbyId:string,body:unknown,actorId:string|null,origin:'ADMIN'|'WHEEL'='ADMIN'){
  this.deps.domain.lobbies.require(lobbyId);
  const input=parseBody(boardTeamCreateSchema,body);
  const party=await drawParty(input.slots,this.deps.moves);
  const trainer={name:input.trainer.name??'DÉFI',spriteId:input.trainer.spriteId??battleSpriteIds[randomInt(battleSpriteIds.length)]!};
  validateBattleSpec({encounterId:randomUUID(),trainer,party});
  const id=randomUUID();
  this.deps.db.prepare(`INSERT INTO battle_board_teams(id,lobby_id,trainer_name,trainer_sprite,slots_json,party_json,reward,status,origin,created_by,created_at)
   VALUES(?,?,?,?,?,?,?,'OPEN',?,?,?)`).run(id,lobbyId,trainer.name,trainer.spriteId,JSON.stringify(input.slots),JSON.stringify(party),input.reward??boardReward(party),origin,actorId,nowIso());
  const team=this.row(lobbyId,id);
  this.audit(team,'board.created',`Tableau : ${team.trainer.name} (${party.length} Pokémon, ${levels(party)}${team.legendaries?`, ${team.legendaries} légendaire(s)`:''}) — récompense ${fmt(team.reward)}`,{actorId});
  this.deps.notify(lobbyId,{kind:'info',message:`🗡 Nouveau combat au tableau : ${team.trainer.name} (${party.length} Pokémon, ${levels(party)}) — ${fmt(team.reward)}`});
  this.deps.changed(lobbyId);
  return team;
 }

 /** New draw of the random places (open team only). A reward left at the suggestion follows the new team. */
 async reroll(lobbyId:string,id:string,actorId:string){
  const team=this.row(lobbyId,id);
  if(team.status!=='OPEN')throw new DomainError('CONFLICT','Seule une équipe disponible peut être tirée à nouveau');
  const party=await drawParty(team.slots,this.deps.moves);
  const reward=team.reward===team.suggestedReward?boardReward(party):team.reward;
  if(!this.set(id,{party_json:JSON.stringify(party),reward},'OPEN'))throw new DomainError('CONFLICT','L’équipe vient d’être prise');
  const after=this.row(lobbyId,id);
  this.audit(after,'board.rerolled',`Tableau : ${after.trainer.name} tirée à nouveau (${levels(party)}) — récompense ${fmt(after.reward)}`,{actorId});
  this.deps.changed(lobbyId);
  return after;
 }
 setReward(lobbyId:string,id:string,body:unknown,actorId:string){
  const {reward}=parseBody(boardRewardSchema,body),team=this.row(lobbyId,id);
  if(!this.set(id,{reward},'OPEN'))throw new DomainError('CONFLICT','La récompense ne change plus une fois l’équipe prise');
  this.audit(team,'board.reward_changed',`Tableau : récompense de ${team.trainer.name} ${fmt(team.reward)} → ${fmt(reward)}`,{actorId});
  this.deps.changed(lobbyId);
  return this.row(lobbyId,id);
 }
 withdraw(lobbyId:string,id:string,actorId:string){
  const team=this.row(lobbyId,id);
  if(!this.set(id,{status:'WITHDRAWN'},'OPEN'))throw new DomainError('CONFLICT','Seule une équipe disponible peut être retirée');
  this.audit(team,'board.withdrawn',`Tableau : ${team.trainer.name} retirée`,{actorId,status:'INFO'});
  this.deps.changed(lobbyId);
  return this.row(lobbyId,id);
 }

 /** A player accepts: the team is reserved for them (first come, first served) and fought as soon as their game is free. */
 challenge(lobbyId:string,id:string,accountId:string){
  const team=this.row(lobbyId,id),who=this.name(accountId);
  if(team.status!=='OPEN')throw new DomainError('CONFLICT',team.status==='CHALLENGED'?'Un autre joueur affronte déjà cette équipe':'Cette équipe n’est plus disponible');
  if(!this.deps.domain.lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  // A Run in progress and a game able to take the battle; one commanded battle at a time.
  this.deps.currentGame.requireState(lobbyId,accountId,{capabilities:['battle.trainer.start']});
  if(this.deps.battles.active(lobbyId,accountId))throw new DomainError('BATTLE_ALREADY_PENDING','Un combat est déjà en attente ou en cours pour vous');
  if(!this.set(id,{status:'CHALLENGED',challenger_id:accountId},'OPEN'))throw new DomainError('CONFLICT','Un autre joueur vient de prendre cette équipe');
  try{
   const created=this.deps.battles.create(lobbyId,accountId,{trainer:team.trainer,party:team.party},{type:'BOARD_TEAM',refId:team.id,label:`Tableau : ${team.trainer.name}`,scaling:{mode:'COPY_EXACT',delta:0}},accountId);
   this.set(id,{encounter_id:created.id});
   this.audit(team,'board.challenged',`${who} relève le défi de ${team.trainer.name} (récompense ${fmt(team.reward)})`,{actorId:accountId,targetId:accountId});
   this.deps.notify(lobbyId,{kind:'info',message:`⚔ ${who} relève le défi de ${team.trainer.name} au tableau`});
   this.deps.battles.queue(lobbyId,created.id,accountId);
  }catch(error){this.set(id,{status:'OPEN',challenger_id:null,encounter_id:null},'CHALLENGED');this.deps.changed(lobbyId);throw error;}
  this.deps.changed(lobbyId);
  return this.row(lobbyId,id);
 }
 /** The challenger gives up before the battle starts: the team goes back on the board. */
 forfeit(lobbyId:string,id:string,accountId:string){
  const team=this.row(lobbyId,id);
  if(team.status!=='CHALLENGED'||team.challengerId!==accountId||!team.encounterId)throw new DomainError('FORBIDDEN','Vous n’affrontez pas cette équipe');
  this.deps.battles.cancel(lobbyId,team.encounterId,accountId);// → ended() puts it back
  return this.row(lobbyId,id);
 }

 /** Battle engine hook: a win keeps the team for its winner and pays; anything else puts it back on the board. */
 ended(e:BattleEncounter){
  if(e.sourceType!=='BOARD_TEAM'||!e.sourceRefId)return;
  const team=this.row(e.lobbyId,e.sourceRefId),who=this.name(e.accountId);
  if(team.status!=='CHALLENGED'||team.encounterId!==e.id)return;
  if(e.status==='WON'){
   this.set(team.id,{status:'WON',winner_id:e.accountId,won_at:nowIso(),reward_status:team.reward>0?'PENDING':'NONE'},'CHALLENGED');
   this.audit(team,'board.won',`${who} a vaincu ${team.trainer.name} au tableau${team.reward?` : ${fmt(team.reward)} à verser`:''}`,{targetId:e.accountId});
   this.deps.notify(e.lobbyId,{kind:'success',message:`🏆 ${who} a vaincu ${team.trainer.name} au tableau${team.reward?` : +${fmt(team.reward)}`:''}`});
   void this.pay(e.lobbyId,e.accountId).catch(error=>console.error('Board reward:',error));
  }else{
   this.set(team.id,{status:'OPEN',challenger_id:null,encounter_id:null},'CHALLENGED');
   const lost=e.status==='LOST';
   this.audit(team,lost?'board.lost':'board.released',`${who} ${lost?'a perdu contre':'n’affronte plus'} ${team.trainer.name} : l’équipe revient au tableau`,{targetId:e.accountId,status:'INFO'});
   this.deps.notify(e.lobbyId,{kind:lost?'warning':'info',message:lost?`💀 ${who} a perdu contre ${team.trainer.name} : l’équipe revient au tableau`:`${team.trainer.name} revient au tableau`});
  }
  this.deps.changed(e.lobbyId);
 }

 /** Rewards won and not paid yet (game offline, busy…): retried on each observation of the winner's game. */
 async pay(lobbyId:string,accountId:string){
  const rows=this.deps.db.prepare("SELECT * FROM battle_board_teams WHERE lobby_id=? AND winner_id=? AND reward_status='PENDING' AND reward_attempts<?").all(lobbyId,accountId,MAX_REWARD_ATTEMPTS) as Row[];
  for(const team of rows.map(toTeam)){
   if(this.paying.has(team.id))continue;
   this.paying.add(team.id);
   try{
    const result=await this.deps.transactions().apply({lobbyId,accountId,actorAccountId:null,idempotencyKey:`board:${team.id}:attempt-${team.attempts}`,
     legs:[{type:'BATTLE_REWARD',amount:team.reward,source:'EXTERNAL',destination:'GAME',metadata:{boardTeamId:team.id}}],
     audit:{category:'BATTLE',action:'board.reward',message:`Tableau : ${fmt(team.reward)} pour ${this.name(accountId)} (victoire contre ${team.trainer.name})`}});
    this.set(team.id,{reward_status:result.status==='CONFIRMED'?'PAID':result.status==='REVIEW'?'REVIEW':'PENDING',reward_command_id:result.commandId,reward_attempts:team.attempts+(result.status==='FAILED'?1:0)});
   }catch(error){
    // Game offline, no Run, busy player: still pending. A lost confirmation waits for an admin.
    const code=error instanceof DomainError?error.code:'INTERNAL_ERROR';
    if(code==='COMMAND_OUTCOME_UNKNOWN')this.set(team.id,{reward_status:'REVIEW',reward_command_id:String(error instanceof DomainError?error.details?.commandId??'':'')});
    else if(['GAME_STATE_CHANGED','GAME_COMMAND_FAILED','INSUFFICIENT_FUNDS','VALIDATION_FAILED'].includes(code))this.set(team.id,{reward_attempts:team.attempts+1});
   }finally{this.paying.delete(team.id);this.deps.changed(lobbyId);}
  }
 }
 commandResolved(commandId:string,applied:boolean){
  const row=this.deps.db.prepare("SELECT * FROM battle_board_teams WHERE reward_command_id=? AND reward_status='REVIEW'").get(commandId) as Row|undefined;
  if(row){this.set(row.id,{reward_status:applied?'PAID':'PENDING',reward_attempts:row.reward_attempts+(applied?0:1)});this.deps.changed(row.lobby_id);}
 }
}
