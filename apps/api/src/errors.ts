import type {Response} from 'express';
import type {ApiError,ErrorCode} from '@pokerace/shared';

const httpStatus:Record<ErrorCode,number>={
 VALIDATION_FAILED:400,NOT_FOUND:404,CONFLICT:409,INTERNAL_ERROR:500,
 FORBIDDEN:403,ACCOUNT_REQUIRED:401,ACCOUNT_NOT_FOUND:404,ADMIN_REQUIRED:403,LAST_ADMIN:409,
 LOBBY_NOT_FOUND:404,NOT_LOBBY_MEMBER:403,INVALID_INVITE_CODE:403,
 RUN_NOT_FOUND:404,RUN_NOT_RUNNING:409,RUN_ALREADY_RUNNING:409,INVALID_RUN_TRANSITION:409,
 GAME_NOT_CONNECTED:409,GAME_ADAPTER_NOT_READY:409,GAME_STATE_STALE:409,CAPABILITY_MISSING:409,PLAYER_BUSY:409,
 COMMAND_OUTCOME_UNKNOWN:504,GAME_STATE_CHANGED:409,GAME_COMMAND_FAILED:502,WRITES_DISABLED:409,PARTY_FULL:409,LAST_POKEMON:409,SAFE_STATE_REQUIRED:428,INVALID_POKEMON:400,
 TRANSACTION_NOT_FOUND:404,INVALID_TRANSACTION_TRANSITION:409,INSUFFICIENT_FUNDS:409,IDEMPOTENCY_CONFLICT:409,
 NO_PASSIVE_AVAILABLE:409,PASSIVE_ALREADY_OWNED:409,PASSIVE_NOT_OWNED:409,
 BATTLE_SOURCE_UNAVAILABLE:409,BATTLE_ALREADY_PENDING:409
};

// Business failures carry a stable code; anything else is reported as INTERNAL_ERROR without leaking details.
export class DomainError extends Error{
 constructor(readonly code:ErrorCode,message:string,readonly details?:Record<string,unknown>){super(message);this.name='DomainError';}
 get status(){return httpStatus[this.code];}
}

export const toApiError=(error:unknown):ApiError=>error instanceof DomainError
 ?{ok:false,error:{code:error.code,message:error.message,...(error.details?{details:error.details}:{})}}
 :{ok:false,error:{code:'INTERNAL_ERROR',message:'Erreur interne du serveur'}};

let errorAuditor:((error:unknown,context:{method:string;path:string})=>void)|null=null;
// The portal registers the audit trail here so unexpected failures leave an ERROR entry.
export const setErrorAuditor=(auditor:typeof errorAuditor)=>{errorAuditor=auditor;};

export function sendError(res:Response,error:unknown){
 if(!(error instanceof DomainError)){
  console.error(error);
  try{errorAuditor?.(error,{method:res.req?.method??'',path:res.req?.originalUrl??''});}catch(auditError){console.error('Audit of an error failed:',auditError);}
 }
 return res.status(error instanceof DomainError?error.status:500).json(toApiError(error));
}
