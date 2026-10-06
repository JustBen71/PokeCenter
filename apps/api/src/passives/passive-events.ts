import type {Gage,NativeGameState,PassiveDefinition} from '@pokerace/shared';
import type {Services} from '../services.js';

/**
 * Domain events the passive engine reacts to. Each one carries a stable id: replaying it (reconnection,
 * double request, restart) is recorded once in passive_events and never produces a second effect.
 */
export type DomainEvent={lobbyId:string;accountId:string;id:string}&(
 |{type:'RUN_STARTED';data:{runId:string;number:number;afterLoss:boolean}}
 |{type:'RUN_LOST';data:{runId:string}}
 // initial: first completions recorded for this player (catch-up of an existing save), not a race move.
 |{type:'OBJECTIVE_COMPLETED';data:{objectiveId:string;name:string;initial:boolean}}
 |{type:'AUCTION_JOINED';data:{auctionId:string}}
 |{type:'AUCTION_LOST';data:{auctionId:string}}
 |{type:'AUCTION_WON';data:{auctionId:string}}
 |{type:'WHEEL_RESOLVED';data:{resolutionId:string;tone:string;gageId:string;gageName:string;role:'owner'|'target'}}
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
 reward:(eventId:string,request:RewardRequest)=>Promise<void>;
 notify:(message:string,options?:{private?:boolean;kind?:'success'|'info'|'warning'})=>void;
 audit:(action:string,message:string,metadata?:Record<string,unknown>)=>void;
};

/** One server-side behaviour per catalogue entry: triggers, game observation and modifiers. */
export type PassiveHandler={
 on?:{[K in DomainEventType]?:(ctx:PassiveContext,event:EventOf<K>)=>unknown};
 // Periodic game observation (positions, team…): must be idempotent, rewards use deterministic event ids.
 observe?:(ctx:PassiveContext,state:NativeGameState)=>unknown;
 // Modifier: removes gages from a hostile wheel before its weighted draw (the holder is the target).
 filterHostileGages?:(ctx:PassiveContext,gages:Gage[])=>Gage[];
};
