import {z} from 'zod';
import {errorCodeSchema} from './errors.js';

export const auditCategorySchema=z.enum(['ACCOUNT','LOBBY','RUN','GAME_COMMAND','POKEMON','MONEY','BANK','JACKPOT','AUCTION','WHEEL','TICKET','PROTECTION','ADMIN','ERROR']);
export type AuditCategory=z.infer<typeof auditCategorySchema>;
export const auditStatusSchema=z.enum(['SUCCESS','FAILED','PENDING','REVIEW','INFO']);
export type AuditStatus=z.infer<typeof auditStatusSchema>;

export type AuditLog={
 id:string;timestamp:string;lobbyId:string|null;actorAccountId:string|null;targetAccountId:string|null;runId:string|null;
 category:AuditCategory;action:string;status:AuditStatus;commandId:string|null;message:string;errorCode:z.infer<typeof errorCodeSchema>|null;
 metadata:Record<string,unknown>;
};
