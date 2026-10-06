import type {Account,Gage,GameEvent,NativeGameState,PassiveActInput,PassiveDefinition} from '@pokerace/shared';
import type {Services} from '../services.js';

/**
 * Domain events the passive engine reacts to. Each one carries a stable id: replaying it (reconnection,
 * double request, restart) is recorded once in passive_events and never produces a second effect.
 */
export type DomainEvent={lobbyId:string;accountId:string;id:string}&(
 |{type:'RUN_STARTED';data:{runId:string;number:number;afterLoss:boolean}}
 |{type:'RUN_LOST';data:{runId:string}}
 // initial: first completions recorded for this player (catch-up of an existing save), not a race move.
 // batch: every objective reached in the same game observation (one ranking move).
 |{type:'OBJECTIVE_COMPLETED';data:{objectiveId:string;name:string;initial:boolean;batch:string[]}}
 |{type:'AUCTION_JOINED';data:{auctionId:string}}
 |{type:'AUCTION_LOST';data:{auctionId:string}}
 |{type:'AUCTION_WON';data:{auctionId:string}}
 |{type:'WHEEL_RESOLVED';data:{resolutionId:string;tone:string;gageId:string;gageName:string;role:'owner'|'target'}}
 // Game events (GAME_EVENT). STEPS_CHANGED also carries the delta and the race total computed by the engine.
 |{type:'TRAINER_VICTORY';data:Extract<GameEvent,{kind:'TRAINER_VICTORY'}>['data']}
 |{type:'POKEMON_FAINTED';data:Extract<GameEvent,{kind:'POKEMON_FAINTED'}>['data']}
 |{type:'BATTLE_ENDED';data:Extract<GameEvent,{kind:'BATTLE_ENDED'}>['data']}
 |{type:'STEPS_CHANGED';data:{absolute:number;delta?:number;total?:number}}
);
export type DomainEventType=DomainEvent['type'];
export type EventOf<T extends DomainEventType>=Extract<DomainEvent,{type:T}>;

export type RewardRequest=
 |{type:'MONEY';amount:number;reason:string}
 |{type:'TICKET';tone:'GOOD'|'BAD';reason:string;targetId?:string};

// What a handler may do: read/write its own progression, ask for rewards, notify, audit.
export type PassiveContext={
 lobbyId:string;accountId:string;passive:PassiveDefinition;services:Services;
 get:<T>(key:string,fallback:T)=>T;
 set:(key:string,value:unknown)=>void;
 // `to`: another player receives the reward (Lien du destin); by default the holder.
 reward:(eventId:string,request:RewardRequest,to?:string)=>Promise<void>;
 notify:(message:string,options?:{private?:boolean;kind?:'success'|'info'|'warning'})=>void;
 audit:(action:string,message:string,metadata?:Record<string,unknown>)=>void;
};

/** One server-side behaviour per catalogue entry: triggers, game observation and modifiers. */
export type PassiveHandler={
 on?:{[K in DomainEventType]?:(ctx:PassiveContext,event:EventOf<K>)=>unknown};
 // Same, for events of the other players of the lobby (the holder watches them).
 others?:{[K in DomainEventType]?:(ctx:PassiveContext,event:EventOf<K>)=>unknown};
 // An explicit use by the holder (or an admin for them); returns the message shown to the lobby.
 act?:(ctx:PassiveContext,input:PassiveActInput,actor:Account)=>Promise<string>|string;
 // Wheel draw with a choice: how many gages the chooser picks from (null = ordinary draw). `role` is the
 // holder's place in the draw; returning a number consumes nothing, the handler records its own use.
 wheelChoice?:(ctx:PassiveContext,draw:{tone:string;role:'owner'|'target';gageCount:number})=>number|null;
 // Periodic game observation (positions, team…): must be idempotent, rewards use deterministic event ids.
 observe?:(ctx:PassiveContext,state:NativeGameState)=>unknown;
 // Modifier: removes gages from a hostile wheel before its weighted draw (the holder is the target).
 filterHostileGages?:(ctx:PassiveContext,gages:Gage[])=>Gage[];
};
