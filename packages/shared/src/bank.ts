import {z} from 'zod';
import type {MoneyTransaction} from './money.js';

// requestId comes from the browser for each click: a retried request reuses it and is never applied twice.
export const bankOperationSchema=z.object({amount:z.number().int().min(1).max(999999),requestId:z.string().uuid()}).strict();
export type BankOperation=z.infer<typeof bankOperationSchema>;

export type BankSnapshot={balance:number;jackpot:number;taxPercent:number;history:MoneyTransaction[]};
export type JackpotSnapshot={balance:number;recent:MoneyTransaction[];sources:{reason:string;amount:number}[];totalIn:number;totalOut:number};
export const jackpotSourceLabels:Record<string,string>={bank_deposit_tax:'Taxe des dépôts en banque',shop:'Boutique',auction:'Enchères',wheel:'Roues',admin:'Ajustements admin',other:'Autres'};

// Integer split used by the server and shown by the Web before confirming: the tax is rounded down.
export const depositSplit=(amount:number,taxPercent:number)=>{const tax=Math.floor(amount*taxPercent/100);return {bank:amount-tax,tax};};

export const moneyTypeLabels:Record<MoneyTransaction['type'],string>={
 BANK_DEPOSIT:'Dépôt en banque',BANK_WITHDRAW:'Retrait de la banque',AUCTION_PAYMENT:'Paiement d’enchère',SHOP_PURCHASE:'Achat en boutique',
 WHEEL_TRANSFER:'Transfert de roue',WHEEL_REWARD:'Gain de roue',JACKPOT_CONTRIBUTION:'Contribution au jackpot',JACKPOT_REWARD:'Gain du jackpot',
 ADMIN_ADJUSTMENT:'Correction admin',OBJECTIVE_REWARD:'Récompense d’objectif'
};
