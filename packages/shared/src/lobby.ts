import {z} from 'zod';

export const lobbyStatusSchema=z.enum(['OPEN','RUNNING','FINISHED','ARCHIVED']);
export type LobbyStatus=z.infer<typeof lobbyStatusSchema>;

const percent=z.number().int().min(0).max(100);
// Financial rules live here instead of being hard-coded in each feature.
export const lobbySettingsSchema=z.object({
 bankDepositTaxPercent:percent,
 shopJackpotPercent:percent,
 auctionJackpotPercent:percent,
 wheelJackpotPercent:percent,
 protectionPrice:z.number().int().min(0).max(999999)
}).strict();
export type LobbySettings=z.infer<typeof lobbySettingsSchema>;
export const defaultLobbySettings:LobbySettings={bankDepositTaxPercent:10,shopJackpotPercent:0,auctionJackpotPercent:0,wheelJackpotPercent:0,protectionPrice:2000};

export type Lobby={id:string;name:string;inviteCode:string;createdBy:string|null;status:LobbyStatus;createdAt:string;updatedAt:string};
// A member row is the player's participation in the race; it outlives every Run.
export type LobbyMember={lobbyId:string;accountId:string;joinedAt:string};

const lobbyName=z.string().trim().min(1).max(64).refine(s=>!/[\x00-\x1f\x7f]/.test(s),'Nom invalide');
export const lobbyCreateSchema=z.object({name:lobbyName}).strict();
// Codes are matched case-insensitively and spaces are ignored, so a code read aloud still works.
export const lobbyJoinSchema=z.object({code:z.string().trim().min(1).max(32).transform(s=>s.replace(/\s+/g,''))}).strict();
export const lobbyUpdateSchema=z.object({name:lobbyName.optional(),status:lobbyStatusSchema.optional()}).strict().refine(v=>v.name!==undefined||v.status!==undefined,'Aucune modification');

// What the Web receives for a lobby. The invite code is only present for members and admins.
export type LobbySummary={
 id:string;name:string;status:LobbyStatus;createdAt:string;createdBy:string|null;joined:boolean;inviteCode?:string;
 members:{id:string;name:string;sprite:string;admin:boolean;joinedAt:string}[];
};
