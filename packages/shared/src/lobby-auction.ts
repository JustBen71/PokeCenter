import {z} from 'zod';
import type {PokemonInjection} from './index.js';

export const auctionStatusSchema=z.enum(['OPEN','SETTLING','SOLD','CANCELLED','REVIEW']);
export type AuctionStatus=z.infer<typeof auctionStatusSchema>;
export const auctionStatusLabels:Record<AuctionStatus,string>={OPEN:'Ouverte',SETTLING:'Attribution en cours',SOLD:'Vendue',CANCELLED:'Annulée',REVIEW:'À vérifier'};

type Range={min:number;max:number};
export type AuctionHints={ivs:Record<string,Range>;evs:Record<string,Range>;stats:Record<string,Range>};
export type AuctionBid={accountId:string;name:string;amount:number;at:string};

/**
 * What the browser receives. The real stats (template) stay on the server while the auction is in progress:
 * only ranges are sent, the exact Pokémon is revealed once the auction is over.
 */
export type LobbyAuction={
 id:string;status:AuctionStatus;speciesId:number;name:string;level:number;sampleSize:number;uncertainty:number;hints:AuctionHints;
 bids:AuctionBid[];log:string[];createdAt:string;closedAt:string|null;
 winner:{accountId:string;name:string;price:number}|null;commandId:string|null;
 revealed:PokemonInjection|null;
};
export type AuctionsSnapshot={auctions:LobbyAuction[];generating:boolean};

export const auctionCreateSchema=z.object({uncertainty:z.number().int().min(0).max(100).default(25)}).strict();
export const auctionBidSchema=z.object({amount:z.number().int().min(1).max(999999)}).strict();
export const auctionReviewSchema=z.object({outcome:z.enum(['SOLD','OPEN','CANCELLED'])}).strict();
