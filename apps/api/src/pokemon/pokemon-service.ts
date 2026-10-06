import {gen3PartyRaw,pokemonActionSchema,type Account,type GameCapability} from '@pokerace/shared';
import {DomainError} from '../errors.js';
import {parseBody} from '../http.js';
import type {CurrentGameService} from '../game/current-game-service.js';
import {GameCommandService,type GameCommandOutcome} from '../game/game-command-service.js';
import type {LibraryService} from '../library/library-service.js';

const capability:Record<'insert'|'remove'|'replace',GameCapability>={insert:'pokemon.insert',remove:'pokemon.remove',replace:'pokemon.replace'};

/**
 * Admin party edits through the GameAdapter: the server sends what it observed (count, exact 100 bytes of the
 * slot) and the client refuses if the game moved. The adapter cannot tell whether a battle is in progress
 * (no validated battle address), so the admin must confirm it explicitly for every structural change.
 */
export class PokemonService{
 constructor(private readonly deps:{currentGame:CurrentGameService;commands:GameCommandService;library:LibraryService}){}

 async apply(lobbyId:string,accountId:string,actor:Account,body:unknown):Promise<GameCommandOutcome>{
  const action=parseBody(pokemonActionSchema,body);
  if(!action.confirmOutOfBattle)throw new DomainError('SAFE_STATE_REQUIRED','Confirmez que le joueur n’est pas en combat : l’équipe de combat est une copie que le jeu réécrit');
  const raw='artifactId' in action?this.deps.library.gen3Raw(this.deps.library.require(action.artifactId)):null;
  return this.execute(lobbyId,accountId,actor,action,raw);
 }

 /** Inserts an exact Gen III copy kept by the server (Âme liée), with the same safety rules as the library. */
 insertRaw(lobbyId:string,accountId:string,actor:Account,raw:string,confirmOutOfBattle:boolean){
  if(!confirmOutOfBattle)throw new DomainError('SAFE_STATE_REQUIRED','Confirmez que le joueur n’est pas en combat : l’équipe de combat est une copie que le jeu réécrit');
  return this.execute(lobbyId,accountId,actor,{action:'insert',confirmOutOfBattle:true},raw);
 }

 private execute(lobbyId:string,accountId:string,actor:Account,action:{action:'insert'|'remove'|'replace';slot?:number;confirmOutOfBattle?:boolean},raw:string|null){
  return this.deps.commands.withPlayerLock(lobbyId,accountId,async()=>{
   const {context,playerId,state}=this.deps.currentGame.requireState(lobbyId,accountId,{capabilities:[capability[action.action]]});
   const expectedCount=state.party.length;
   const slotRaw=(slot:number)=>{
    const pokemon=state.party.find(p=>p.slot===slot);
    if(!pokemon)throw new DomainError('VALIDATION_FAILED','Cet emplacement est vide');
    const raw=gen3PartyRaw(pokemon);
    if(!raw)throw new DomainError('CAPABILITY_MISSING','Le client n’envoie pas la copie exacte de ce Pokémon');
    return raw;
   };
   const command=action.action==='insert'?{command:'game.pokemon.insert' as const,payload:{raw:raw!,expectedCount}}
    :action.action==='remove'?{command:'game.pokemon.remove' as const,payload:{slot:action.slot!,expectedRaw:slotRaw(action.slot!),expectedCount}}
    :{command:'game.pokemon.replace' as const,payload:{slot:action.slot!,expectedRaw:slotRaw(action.slot!),raw:raw!,expectedCount}};
   if(action.action==='insert'&&expectedCount>=6)throw new DomainError('PARTY_FULL','L’équipe est déjà complète');
   if(action.action==='remove'&&expectedCount<=1)throw new DomainError('LAST_POKEMON','Le joueur doit garder au moins un Pokémon');
   const outcome=await this.deps.commands.send({lobbyId,accountId,playerId,runId:context.run?.id??null,actorAccountId:actor.id,...command});
   if(outcome.status!=='COMPLETED')GameCommandService.raise(outcome);
   return outcome;
  });
 }
}
