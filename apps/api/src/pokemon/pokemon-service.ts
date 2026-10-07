import {decodePokemonCopy,gen3PartyRaw,pokemonActionSchema,withTrainer,type Account,type GameCapability} from '@pokerace/shared';
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
  if(action.action==='adopt')return this.execute(lobbyId,accountId,actor,{action:'replace',slot:action.slot},this.adopted(lobbyId,accountId,action.slot));
  const raw='artifactId' in action?this.deps.library.gen3Raw(this.deps.library.require(action.artifactId)):null;
  return this.execute(lobbyId,accountId,actor,action,raw);
 }

 /**
  * The slot rewritten with the player's own trainer, so the game no longer treats it as traded (it obeys).
  * The player's trainer is the one most of the other team members carry (the game never sends the save's ID).
  */
 private adopted(lobbyId:string,accountId:string,slot:number){
  const {state}=this.deps.currentGame.requireState(lobbyId,accountId,{capabilities:['pokemon.replace']});
  const raws=new Map(state.party.map(p=>[p.slot,gen3PartyRaw(p)]));
  const raw=raws.get(slot);
  if(!raw)throw new DomainError(raws.has(slot)?'CAPABILITY_MISSING':'VALIDATION_FAILED',raws.has(slot)?'Le client n’envoie pas la copie exacte de ce Pokémon':'Cet emplacement est vide');
  const trainer=(r:string)=>r.slice(8,16)+r.slice(40,54);// ID + secret ID, OT name
  const mine=trainer(raw),votes=new Map<string,{raw:string;n:number}>();
  for(const [s,r] of raws)if(s!==slot&&r){const t=trainer(r),v=votes.get(t);votes.set(t,{raw:r,n:(v?.n??0)+1});}
  const best=[...votes.entries()].sort((a,b)=>b[1].n-a[1].n)[0];
  if(!best)throw new DomainError('VALIDATION_FAILED','Impossible de connaître le dresseur du joueur : il faut un autre Pokémon à lui dans l’équipe');
  if(best[0]===mine)throw new DomainError('CONFLICT',`${decodePokemonCopy(raw).nickname} appartient déjà au dresseur du joueur`);
  return withTrainer(raw,best[1].raw);
 }

 /** Inserts an exact Gen III copy kept by the server (Âme liée), with the same safety rules as the library. */
 insertRaw(lobbyId:string,accountId:string,actor:Account,raw:string,confirmOutOfBattle:boolean){
  if(!confirmOutOfBattle)throw new DomainError('SAFE_STATE_REQUIRED','Confirmez que le joueur n’est pas en combat : l’équipe de combat est une copie que le jeu réécrit');
  return this.execute(lobbyId,accountId,actor,{action:'insert',confirmOutOfBattle:true},raw);
 }

 /** Wheel gages: the exact copy of a slot replaced (level change, Magikarp curse) or the slot removed (transfer). */
 replaceRaw(lobbyId:string,accountId:string,actor:Account,slot:number,raw:string,confirmOutOfBattle:boolean){
  if(!confirmOutOfBattle)throw new DomainError('SAFE_STATE_REQUIRED','Confirmez que le joueur n’est pas en combat : l’équipe de combat est une copie que le jeu réécrit');
  return this.execute(lobbyId,accountId,actor,{action:'replace',slot,confirmOutOfBattle:true},raw);
 }
 removeSlot(lobbyId:string,accountId:string,actor:Account,slot:number,confirmOutOfBattle:boolean){
  if(!confirmOutOfBattle)throw new DomainError('SAFE_STATE_REQUIRED','Confirmez que le joueur n’est pas en combat : l’équipe de combat est une copie que le jeu réécrit');
  return this.execute(lobbyId,accountId,actor,{action:'remove',slot,confirmOutOfBattle:true},null);
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
