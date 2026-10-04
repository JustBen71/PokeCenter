import {z} from 'zod';

// Stable codes shared by the API and the Web. Messages are for humans; clients branch on codes only.
export const errorCodes=[
 'VALIDATION_FAILED','NOT_FOUND','CONFLICT','INTERNAL_ERROR',
 'FORBIDDEN','ACCOUNT_REQUIRED','ACCOUNT_NOT_FOUND','ADMIN_REQUIRED','LAST_ADMIN',
 'LOBBY_NOT_FOUND','NOT_LOBBY_MEMBER','INVALID_INVITE_CODE',
 'RUN_NOT_FOUND','RUN_NOT_RUNNING','RUN_ALREADY_RUNNING','INVALID_RUN_TRANSITION',
 'GAME_NOT_CONNECTED','GAME_ADAPTER_NOT_READY','GAME_STATE_STALE','CAPABILITY_MISSING','PLAYER_BUSY',
 'COMMAND_OUTCOME_UNKNOWN','GAME_STATE_CHANGED','GAME_COMMAND_FAILED','WRITES_DISABLED','PARTY_FULL','LAST_POKEMON','SAFE_STATE_REQUIRED','INVALID_POKEMON',
 'TRANSACTION_NOT_FOUND','INVALID_TRANSACTION_TRANSITION','INSUFFICIENT_FUNDS','IDEMPOTENCY_CONFLICT'
] as const;
export const errorCodeSchema=z.enum(errorCodes);
export type ErrorCode=z.infer<typeof errorCodeSchema>;

export const apiErrorSchema=z.object({ok:z.literal(false),error:z.object({code:errorCodeSchema,message:z.string(),details:z.record(z.unknown()).optional()})});
export type ApiError=z.infer<typeof apiErrorSchema>;
