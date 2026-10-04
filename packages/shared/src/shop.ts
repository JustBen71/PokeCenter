import {z} from 'zod';
import type {WheelType} from './wheels.js';

export const ticketStatusLabels={PENDING_PAYMENT:'Paiement en cours',PAYMENT_REVIEW:'Paiement à vérifier',QUEUED:'En attente',RESOLVED:'Résolu',BLOCKED:'Bloqué par une protection',CANCELLED:'Annulé'} as const;
export type TicketStatus=keyof typeof ticketStatusLabels;
export type WheelTicket={id:string;wheelId:string;wheelName:string;icon:WheelType['icon'];tone:WheelType['tone'];buyerId:string;recipientId:string;targetId:string|null;
 price:number;status:TicketStatus;createdAt:string;queuedAt:string|null;resolvedAt:string|null;resolutionId:string|null};
export type Protection={id:string;status:'PENDING_PAYMENT'|'PAYMENT_REVIEW'|'ACTIVE'|'USED'|'CANCELLED';price:number;acquiredAt:string|null;usedAt:string|null};
export type ShopSnapshot={wheels:WheelType[];protectionPrice:number;protections:Protection[];tickets:WheelTicket[];queue:WheelTicket[]};

export const buyTicketSchema=z.object({wheelId:z.string().min(1).max(64),targetId:z.string().min(1).max(64).optional(),requestId:z.string().uuid()}).strict();
export const buyProtectionSchema=z.object({requestId:z.string().uuid()}).strict();
