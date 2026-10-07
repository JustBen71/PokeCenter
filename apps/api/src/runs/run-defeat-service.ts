import type {GameEvent,LobbyNotification,NativeGameState,Run} from '@pokerace/shared';
import type {PortalDomain} from '../store.js';
import {DomainError} from '../errors.js';
import type {CurrentGameService} from '../game/current-game-service.js';
import type {GameCommandService} from '../game/game-command-service.js';

type Cause=Extract<GameEvent,{kind:'PLAYER_DEFEATED'}>['data']['cause'];
const causeLabels:Record<Cause,string>={WHITE_OUT:'équipe K.O., renvoyé au Centre Pokémon',BATTLE_LOST:'combat perdu',PARTY_FAINTED:'équipe K.O.'};
type Moved={slot:number;speciesName:string;nickname:string|null;level:number;box:number;place:number};

/**
 * End of Run decided by the game itself. Any defeat ends the Run (LOST), a new Run starts, and the game is reset
 * without its save (the client archives the 3 last lost games first). While the Run goes on, every fainted Pokémon
 * of a party still standing is sent to the PC box. Nothing here knows a memory address.
 */
export class RunDefeatService{
 private readonly boxing=new Set<string>();
 // Party refused for good (PC full…): not sent again until the party changes.
 private readonly refused=new Map<string,string>();
 constructor(private readonly deps:{domain:PortalDomain;currentGame:CurrentGameService;commands:GameCommandService;
  changed:(lobbyId:string)=>void;runChanged:(lobbyId:string,run:Run)=>void;notify:(lobbyId:string,n:LobbyNotification)=>void;resetDelayMs?:number}){}
 private name(id:string){return this.deps.domain.accounts.get(id)?.name??id;}
 /**
  * After a defeat, the lost game stays « lost » until a new game is seen (reset done, or the player started one):
  * the same fainted team must never end the next Run (client restarted, server restarted, reset failed).
  * Read from the audit trail so it survives a server restart.
  */
 private awaitingNewGame(lobbyId:string,accountId:string){
  const last=this.deps.domain.db.prepare(`SELECT action FROM audit_logs WHERE lobby_id=? AND target_account_id=? AND category='RUN'
   AND action IN ('run.lost','run.new_game') ORDER BY timestamp DESC,rowid DESC LIMIT 1`).get(lobbyId,accountId) as {action:string}|undefined;
  return last?.action==='run.lost';
 }

 /** Called once per PLAYER_DEFEATED event (deduplicated by eventId before reaching here). */
 defeated(lobbyId:string,accountId:string,cause:Cause){
  const {runs,audit}=this.deps.domain,who=this.name(accountId),run=runs.running(lobbyId,accountId);
  if(this.awaitingNewGame(lobbyId,accountId)){
   audit.record({lobbyId,targetAccountId:accountId,category:'RUN',action:'run.defeat_ignored',status:'INFO',message:`Défaite de ${who} ignorée : c’est encore la partie déjà perdue (en attente d’une nouvelle partie)`,metadata:{cause}});
   return;
  }
  if(!run){
   audit.record({lobbyId,targetAccountId:accountId,category:'RUN',action:'run.defeat_ignored',status:'INFO',message:`Défaite de ${who} détectée dans le jeu (${causeLabels[cause]}) hors Run en cours : rien n’est changé`,metadata:{cause}});
   return;
  }
  const lost=runs.transition(run.id,'LOST');
  audit.record({lobbyId,targetAccountId:accountId,runId:lost.id,category:'RUN',action:'run.lost',status:'INFO',
   message:`Run #${lost.number} de ${who} perdue dans le jeu (${causeLabels[cause]})`,metadata:{cause,automatic:true}});
  const next=runs.create(lobbyId,accountId,{start:true});
  audit.record({lobbyId,targetAccountId:accountId,runId:next.id,category:'RUN',action:'run.create',status:'SUCCESS',message:`Run #${next.number} de ${who} lancée automatiquement après la défaite`});
  this.deps.changed(lobbyId);
  this.deps.notify(lobbyId,{kind:'warning',message:`💀 ${who} a perdu sa Run #${lost.number} : le jeu redémarre, Run #${next.number} lancée`});
  // A few seconds so the player sees the defeat in the game before it reboots.
  // The Run events (passives « Run perdue », « Deuxième souffle »…) wait for the reset: a reward written now would
  // land in the game about to be erased; once reset, it stays pending until the new game can be read.
  setTimeout(()=>void this.reset(lobbyId,accountId,lost,next).catch(error=>console.error('Run reset:',error))
   .finally(()=>{this.deps.runChanged(lobbyId,lost);this.deps.runChanged(lobbyId,next);}),this.deps.resetDelayMs??4000);
 }

 private async reset(lobbyId:string,accountId:string,lost:Run,next:Run){
  const {audit}=this.deps.domain,who=this.name(accountId);
  const failed=(message:string,errorCode:string,commandId?:string)=>{
   audit.record({lobbyId,targetAccountId:accountId,runId:next.id,category:'RUN',action:'run.reset_failed',status:'FAILED',commandId,metadata:{code:errorCode},message:`${message} : ${who} doit relancer une nouvelle partie à la main`});
   this.deps.notify(lobbyId,{kind:'error',message:`✖ Redémarrage automatique du jeu de ${who} impossible : nouvelle partie à lancer à la main`});
  };
  let context;
  try{context=this.deps.currentGame.requireState(lobbyId,accountId,{capabilities:['game.reset'],requireRun:false,requireFresh:false});}
  catch{return failed('Jeu non connecté ou client sans redémarrage automatique','reset_unavailable');}
  // Sent once: an unknown outcome is never retried (it would erase the new game).
  const outcome=await this.deps.commands.withPlayerLock(lobbyId,accountId,()=>this.deps.commands.send({lobbyId,accountId,playerId:context.playerId,runId:lost.id,actorAccountId:null,command:'game.reset',payload:{lostRunId:lost.id}}))
   .catch(()=>null);
  if(!outcome)return failed('Une autre action était en cours sur le jeu','PLAYER_BUSY');
  if(outcome.status!=='COMPLETED')return failed(`Redémarrage refusé ou non confirmé (${outcome.errorCode})`,outcome.errorCode??'unknown_error',outcome.commandId);
  audit.record({lobbyId,targetAccountId:accountId,runId:lost.id,category:'RUN',action:'run.reset',status:'SUCCESS',commandId:outcome.commandId,
   message:`Jeu de ${who} redémarré sans sauvegarde ; la partie perdue est archivée sur son ordinateur (${String(outcome.result.archive)})`,metadata:{archive:outcome.result.archive}});
 }

 /** Each observation: the fainted members of a party still standing go to the PC box (only on the overworld, during a Run). */
 async observe(lobbyId:string,accountId:string,state:NativeGameState){
  // A new game: empty party (reset, new save) or a team standing again.
  if((state.party.length===0||state.party.some(p=>p.currentHp>0))&&this.awaitingNewGame(lobbyId,accountId))
   this.deps.domain.audit.record({lobbyId,targetAccountId:accountId,category:'RUN',action:'run.new_game',status:'INFO',message:`Partie de ${this.name(accountId)} de nouveau jouable (nouvelle partie ou équipe debout) : une défaite compte de nouveau`});
  const fainted=state.party.filter(p=>p.currentHp===0);
  if(!fainted.length||fainted.length===state.party.length||!state.capabilities.includes('party.box_fainted')||!state.battle?.safe)return;
  const run=this.deps.domain.runs.running(lobbyId,accountId),key=`${lobbyId}:${accountId}`;
  const party=state.party.map(p=>`${p.speciesId}:${p.level}:${p.currentHp}`).join(',');
  if(!run||this.boxing.has(key)||this.refused.get(key)===party)return;
  this.boxing.add(key);
  try{
   const context=this.deps.currentGame.requireState(lobbyId,accountId,{capabilities:['party.box_fainted'],requireRun:false});
   // The client re-checks the observed party count: a repeated or late command never moves anything twice.
   const outcome=await this.deps.commands.withPlayerLock(lobbyId,accountId,()=>this.deps.commands.send({lobbyId,accountId,playerId:context.playerId,runId:run.id,actorAccountId:null,
    command:'game.party.box_fainted',payload:{expectedCount:state.party.length}}));
   const who=this.name(accountId);
   if(outcome.status==='FAILED'&&!['not_safe','state_changed'].includes(outcome.errorCode??'')){
    // Will not change by itself: said once, tried again when the party changes.
    this.refused.set(key,party);
    const full=outcome.errorCode==='box_full';
    this.deps.domain.audit.record({lobbyId,targetAccountId:accountId,runId:run.id,category:'RUN',action:'pokemon.box_refused',status:'FAILED',commandId:outcome.commandId,metadata:{code:outcome.errorCode},
     message:full?`Boîtes PC de ${who} pleines : ses Pokémon K.O. restent dans l’équipe (libérer de la place)`:`Pokémon K.O. de ${who} non envoyés dans la boîte (${outcome.errorCode})`});
    this.deps.notify(lobbyId,{kind:'error',message:full?`📦 PC de ${who} plein : ses Pokémon K.O. ne peuvent pas aller dans la boîte`:`✖ Pokémon K.O. de ${who} non envoyés dans la boîte`});
    return;
   }
   if(outcome.status!=='COMPLETED')return;// busy, moved, unknown: the next observation decides again
   for(const m of (outcome.result.moved??[]) as Moved[]){
    const mon=`${m.nickname??m.speciesName} (${m.speciesName}, niv. ${m.level})`;
    this.deps.domain.audit.record({lobbyId,targetAccountId:accountId,runId:run.id,category:'RUN',action:'pokemon.boxed',status:'INFO',commandId:outcome.commandId,
     message:`${mon} de ${who} est K.O. : envoyé dans la boîte ${m.box} (place ${m.place})`,metadata:{...m}});
    this.deps.notify(lobbyId,{kind:'warning',message:`🪦 ${mon} de ${who} est tombé : envoyé dans la boîte`});
   }
  }catch(error){
   // Game offline: the next observation decides again. Another action held the player (a reward…): try again
   // shortly, as the game may not publish a new state by itself.
   if(error instanceof DomainError&&error.code==='PLAYER_BUSY')setTimeout(()=>{
    try{void this.observe(lobbyId,accountId,this.deps.currentGame.requireState(lobbyId,accountId,{requireRun:false}).state).catch(()=>{});}catch{/* offline */}
   },1000);
  }
  finally{this.boxing.delete(key);}
 }
}
