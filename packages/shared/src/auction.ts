import type {PokemonInjection} from './index.js';
export type Bid={playerId:string;playerName:string;amount:number;at:string};
export type Auction={uncertainty?:number;hints?:{ivs:Record<string,{min:number;max:number}>;evs:Record<string,{min:number;max:number}>;stats:Record<string,{min:number;max:number}>};id:string;createdAt:string;status:'open'|'settling'|'sold'|'cancelled'|'review';speciesId:number;name:string;level:number;sampleSize:number;participants:string[];bids:Bid[];log:string[];template:PokemonInjection;settlement?:{playerId:string;price:number;moneyBefore:number;countBefore:number;commandId:string}};
export type PublicAuction=Omit<Auction,'template'|'settlement'>;
export type Purchase=PokemonInjection&{action:'purchase';price:number;expectedMoney:number;expectedCount:number};
