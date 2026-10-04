import {gameCapabilitySchema,type GameCapability,type GameContext,type NativeGameState,type PublicNativeClient} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import type {LobbyRepository} from '../lobbies/lobby-repository.js';
import type {RunService} from '../runs/run-service.js';

export type RequireGameOptions={capabilities?:GameCapability[];requireRun?:boolean;requireFresh?:boolean};

/**
 * Resolves account → connected Pokerace.Client → GameAdapter → capabilities → current Run for one lobby.
 * Features call `require` before any game write so every refusal uses the same stable error code.
 */
export class CurrentGameService{
 constructor(private readonly deps:{
  lobbies:LobbyRepository;runs:RunService;
  clients:(lobbyId:string)=>PublicNativeClient[];
  staleAfterMs?:number;now?:()=>number;
 }){}

 resolve(lobbyId:string,accountId:string):GameContext{
  this.deps.lobbies.require(lobbyId);
  if(!this.deps.lobbies.isMember(lobbyId,accountId))throw new DomainError('NOT_LOBBY_MEMBER','Ce joueur ne participe pas à ce lobby');
  const client=this.deps.clients(lobbyId).find(c=>c.accountId===accountId);
  const state=client?.gameState??null;
  const observedAt=state?.observedAt??null;
  const now=this.deps.now?.()??Date.now();
  // The client publishes GAME_STATE only when the game changes and heartbeats every few seconds:
  // an old observation of a live client is still the current state, so freshness follows the heartbeat.
  const fresh=!!observedAt&&!!client?.lastSeenAt&&now-Date.parse(client.lastSeenAt)<=(this.deps.staleAfterMs??15000);
  // Unknown capability names from newer clients are ignored rather than trusted.
  const capabilities=(client?.adapter.capabilities??[]).flatMap(c=>{const parsed=gameCapabilitySchema.safeParse(c);return parsed.success?[parsed.data]:[];});
  return {
   lobbyId,accountId,
   client:{connected:!!client?.ready,playerId:client?.playerId??null,bridgeConnected:!!client?.bridge.connected,gameLoaded:!!client?.bridge.gameLoaded,lastSeenAt:client?.lastSeenAt??null},
   adapter:{status:client?.adapter.status??'no_game',id:client?.adapter.id??null,capabilities},
   game:{money:state?.trainer.money??null,observedAt,fresh},
   run:this.deps.runs.current(lobbyId,accountId)??null
  };
 }

 require(lobbyId:string,accountId:string,options:RequireGameOptions={}):GameContext{
  const context=this.resolve(lobbyId,accountId);
  const {client,adapter,game}=context;
  if(!client.connected)throw new DomainError('GAME_NOT_CONNECTED','Le client Pokérace de ce joueur n’est pas connecté',{reason:'client'});
  if(!client.bridgeConnected)throw new DomainError('GAME_NOT_CONNECTED','BizHawk n’est pas relié au client Pokérace',{reason:'bridge'});
  if(!client.gameLoaded)throw new DomainError('GAME_NOT_CONNECTED','Aucun jeu n’est chargé dans BizHawk',{reason:'game'});
  if(adapter.status!=='ready')throw new DomainError('GAME_ADAPTER_NOT_READY','Le jeu chargé n’est pas pris en charge ou pas encore lu',{adapterStatus:adapter.status});
  if(options.requireFresh!==false&&!game.fresh)throw new DomainError('GAME_STATE_STALE','L’état du jeu est trop ancien pour cette action',{observedAt:game.observedAt});
  const missing=(options.capabilities??[]).filter(c=>!adapter.capabilities.includes(c));
  if(missing.length)throw new DomainError('CAPABILITY_MISSING','Le jeu de ce joueur ne permet pas cette action',{missing});
  if(options.requireRun!==false&&context.run?.status!=='RUNNING')throw new DomainError('RUN_NOT_RUNNING','Aucune Run en cours pour ce joueur',{runStatus:context.run?.status??null});
  return context;
 }

 // Server-side only: the observed state (party copies included) used to build write preconditions.
 requireState(lobbyId:string,accountId:string,options:RequireGameOptions={}):{context:GameContext;playerId:string;state:NativeGameState}{
  const context=this.require(lobbyId,accountId,options);
  const client=this.deps.clients(lobbyId).find(c=>c.accountId===accountId);
  if(!client?.gameState)throw new DomainError('GAME_ADAPTER_NOT_READY','Le jeu chargé n’est pas encore lu');
  return {context,playerId:client.playerId,state:client.gameState};
 }
}
