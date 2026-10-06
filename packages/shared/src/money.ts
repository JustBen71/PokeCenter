import {z} from 'zod';

export const moneyTransactionTypeSchema=z.enum([
 'BANK_DEPOSIT','BANK_WITHDRAW','AUCTION_PAYMENT','SHOP_PURCHASE','WHEEL_TRANSFER','WHEEL_REWARD',
 'JACKPOT_CONTRIBUTION','JACKPOT_REWARD','ADMIN_ADJUSTMENT','OBJECTIVE_REWARD','PASSIVE_REWARD'
]);
export type MoneyTransactionType=z.infer<typeof moneyTransactionTypeSchema>;

// GAME is the in-game wallet (only changed through game commands), BANK and JACKPOT are server balances,
// EXTERNAL is money created or destroyed by the event rules (rewards, sinks, admin corrections).
export const moneyAccountSchema=z.enum(['GAME','BANK','JACKPOT','EXTERNAL']);
export type MoneyAccount=z.infer<typeof moneyAccountSchema>;

export const moneyTransactionStatusSchema=z.enum(['PENDING','APPLYING','CONFIRMED','FAILED','REVIEW','CANCELLED']);
export type MoneyTransactionStatus=z.infer<typeof moneyTransactionStatusSchema>;

// REVIEW is never left automatically: only an explicit resolution moves it to CONFIRMED or FAILED.
export const moneyTransactionTransitions:Record<MoneyTransactionStatus,readonly MoneyTransactionStatus[]>={
 PENDING:['APPLYING','CONFIRMED','FAILED','CANCELLED'],
 APPLYING:['CONFIRMED','FAILED','REVIEW'],
 REVIEW:['CONFIRMED','FAILED'],
 CONFIRMED:[],FAILED:[],CANCELLED:[]
};

export type MoneyTransaction={
 id:string;lobbyId:string;accountId:string|null;runId:string|null;type:MoneyTransactionType;amount:number;
 source:MoneyAccount;destination:MoneyAccount;status:MoneyTransactionStatus;commandId:string|null;idempotencyKey:string|null;
 createdAt:string;updatedAt:string;confirmedAt:string|null;metadata:Record<string,unknown>;
};
