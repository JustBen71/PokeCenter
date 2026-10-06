import type {PublicNativeClient} from '@pokerace/shared';
import type {createApp} from './app.js';
import type {PortalDomain} from './store.js';
import {CurrentGameService} from './game/current-game-service.js';
import {GameCommandService} from './game/game-command-service.js';
import {LibraryService} from './library/library-service.js';
import {PokemonService} from './pokemon/pokemon-service.js';
import {TransactionService} from './money/transaction-service.js';
import {ObjectiveService} from './objectives/objective-service.js';
import {BankService} from './money/bank-service.js';
import {AuctionService} from './auctions/auction-service.js';
import type {generateLot} from './auction-generator.js';
import {WheelService} from './wheels/wheel-service.js';
import {ShopService} from './shop/shop-service.js';
import {JackpotService} from './money/jackpot-service.js';
import {PassiveService,type Random} from './passives/passive-service.js';
import {PassiveEngine} from './passives/passive-engine.js';
import {BattleEncounterService} from './battles/battle-encounter-service.js';
import {passiveHandlers} from './passives/passive-handlers.js';
import type {PassiveHandler} from './passives/passive-events.js';

export type Services=ReturnType<typeof createServices>;
type Course=ReturnType<typeof createApp>;

// Composition of the portal services; each lobby's course app provides its native clients and action locks.
export function createServices(domain:PortalDomain,courses:Map<string,Course>,options:{staleAfterMs:number;commandTimeoutMs?:number;changed:(lobbyId:string,topic:string)=>void;emit:(lobbyId:string,event:string,payload:unknown)=>void;emitTo?:(lobbyId:string,accountId:string,event:string,payload:unknown)=>void;generateLot?:typeof generateLot;implementedPassives?:ReadonlySet<string>;passiveHandlers?:Record<string,PassiveHandler>;random?:Random}){
 const course=(lobbyId:string)=>{const c=courses.get(lobbyId);if(!c)throw new Error(`Lobby ${lobbyId} is not running`);return c;};
 const currentGame=new CurrentGameService({lobbies:domain.lobbies,runs:domain.runs,clients:(lobbyId):PublicNativeClient[]=>courses.get(lobbyId)?.nativeClients.publicSnapshot()??[],staleAfterMs:options.staleAfterMs});
 const commands=new GameCommandService({db:domain.db,audit:domain.audit,timeoutMs:options.commandTimeoutMs,
  sender:(lobbyId,playerId,command,timeoutMs)=>course(lobbyId).nativeClients.sendCommand(playerId,command,timeoutMs),
  locks:lobbyId=>course(lobbyId).actionLocks});
 const library=new LibraryService(domain.db);
 const pokemon=new PokemonService({currentGame,commands,library});
 const transactions=new TransactionService({ledger:domain.ledger,currentGame,commands,audit:domain.audit});
 const handlers=options.passiveHandlers??passiveHandlers,passiveEngine=new PassiveEngine(handlers);
 const objectives=new ObjectiveService({db:domain.db,runs:domain.runs,audit:domain.audit,transactions:()=>transactions,changed:lobbyId=>options.changed(lobbyId,'objectives'),
  completed:(lobbyId,accountId,objective,{initial,batch})=>passiveEngine.emit({lobbyId,accountId,id:`objective:${objective.id}`,type:'OBJECTIVE_COMPLETED',data:{objectiveId:objective.id,name:objective.name,initial,batch}})});
 const bank=new BankService({domain,transactions});
 const jackpot=new JackpotService({domain,transactions,commands});
 const auctions=new AuctionService({domain,db:domain.db,currentGame,transactions,library,generate:options.generateLot,
  clients:lobbyId=>courses.get(lobbyId)?.nativeClients.publicSnapshot()??[],changed:lobbyId=>options.changed(lobbyId,'auctions'),events:e=>passiveEngine.emit(e)});
 const wheels=new WheelService({db:domain.db,changed:lobbyId=>options.changed(lobbyId,'wheels'),
  notify:(lobbyId,n)=>options.emit(lobbyId,'notification',n),spun:(lobbyId,r)=>options.emit(lobbyId,'wheel-spin',r)});
 const shop=new ShopService({db:domain.db,changed:lobbyId=>options.changed(lobbyId,'shop')});
 const passives=new PassiveService({domain,implemented:options.implementedPassives??new Set(Object.keys(handlers)),random:options.random,changed:lobbyId=>options.changed(lobbyId,'passives'),
  notify:(lobbyId,n,accountId)=>accountId?options.emitTo?.(lobbyId,accountId,'notification',n):options.emit(lobbyId,'notification',n)});
 const battles=new BattleEncounterService({domain,currentGame,objectives:()=>objectives,changed:lobbyId=>options.changed(lobbyId,'battles'),
  notify:(lobbyId,n,accountId)=>accountId?options.emitTo?.(lobbyId,accountId,'notification',n):options.emit(lobbyId,'notification',n)});
 const services={domain,currentGame,commands,library,pokemon,transactions,objectives,bank,jackpot,auctions,wheels,shop,passives,passiveEngine,battles};
 wheels.attach(services);shop.attach(services);passiveEngine.attach(services);
 return services;
}
