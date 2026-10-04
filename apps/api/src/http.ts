import type {NextFunction,Request,RequestHandler,Response} from 'express';
import type {z} from 'zod';
import type {Account} from '@pokerace/shared';
import {DomainError,sendError} from './errors.js';

// Route handlers throw DomainError; this wrapper turns every failure into the stable error envelope.
export const route=(handler:(req:Request,res:Response)=>unknown):RequestHandler=>async(req,res)=>{
 try{const result=await handler(req,res);if(!res.headersSent&&result!==undefined)res.json(result);}catch(error){if(!res.headersSent)sendError(res,error);}
};

export function parseBody<S extends z.ZodTypeAny>(schema:S,body:unknown):z.output<S>{
 const parsed=schema.safeParse(body??{});
 if(!parsed.success)throw new DomainError('VALIDATION_FAILED',parsed.error.issues[0]?.message??'Requête invalide',{issues:parsed.error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});
 return parsed.data;
}

// The browser names its account with x-account-id. Roles are always read back from the database.
export const requireAccount=(find:(id:string)=>Account|undefined):RequestHandler=>(req:Request,res:Response,next:NextFunction)=>{
 const id=req.header('x-account-id');const account=id?find(id):undefined;
 if(!account)return sendError(res,new DomainError('ACCOUNT_REQUIRED','Choisissez votre compte pour continuer'));
 res.locals.account=account;next();
};
// Same as requireAccount, then refuses non-admins with ADMIN_REQUIRED.
export const requireAdminAccount=(find:(id:string)=>Account|undefined):RequestHandler=>(req,res,next)=>requireAccount(find)(req,res,()=>{
 if(!currentAccount(res).admin)return sendError(res,new DomainError('ADMIN_REQUIRED','Cette action est réservée aux administrateurs'));
 next();
});
export const currentAccount=(res:Response)=>res.locals.account as Account;
export function requireAdmin(account:Account){if(!account.admin)throw new DomainError('ADMIN_REQUIRED','Cette action est réservée aux administrateurs');}
