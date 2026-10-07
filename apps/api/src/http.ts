import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
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

/**
 * Admin role. Without a server admin password (dev, tests) it is the account's own flag. With ADMIN_TOKEN set
 * (production), accounts are picked from a public list, so the role belongs to a session instead: « Se connecter
 * en admin » with the server password gives a signed token (x-admin-token) for that account only, valid 7 days.
 */
let adminSecret='';
export const configureAdminPassword=(secret:string)=>{adminSecret=secret;};
export const adminPasswordRequired=()=>adminSecret.length>0;
const digest=(value:string)=>createHash('sha256').update(value).digest();
const sign=(accountId:string,expires:number)=>createHmac('sha256',adminSecret).update(`${accountId}.${expires}`).digest('hex');
export const checkAdminPassword=(password:string)=>adminPasswordRequired()&&timingSafeEqual(digest(password),digest(adminSecret));
export const adminSessionToken=(accountId:string)=>{const expires=Date.now()+7*24*3600*1000;return {token:`${expires}.${sign(accountId,expires)}`,expiresAt:new Date(expires).toISOString()};};
const validAdminSession=(token:string,accountId:string)=>{
 const [expires,signature]=token.split('.');
 if(!expires||!signature||!(Number(expires)>Date.now()))return false;
 const expected=sign(accountId,Number(expires));
 return signature.length===expected.length&&timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
};
// The browser names its account with x-account-id. The role is the session's (see above) or the database's.
export const requireAccount=(find:(id:string)=>Account|undefined):RequestHandler=>(req:Request,res:Response,next:NextFunction)=>{
 const id=req.header('x-account-id');const account=id?find(id):undefined;
 if(!account)return sendError(res,new DomainError('ACCOUNT_REQUIRED','Choisissez votre compte pour continuer'));
 res.locals.account=adminPasswordRequired()?{...account,admin:validAdminSession(req.header('x-admin-token')??'',account.id)}:account;next();
};
// Same as requireAccount, then refuses non-admins with ADMIN_REQUIRED.
export const requireAdminAccount=(find:(id:string)=>Account|undefined):RequestHandler=>(req,res,next)=>requireAccount(find)(req,res,()=>{
 if(!currentAccount(res).admin)return sendError(res,new DomainError('ADMIN_REQUIRED','Cette action est réservée aux administrateurs'));
 next();
});
export const currentAccount=(res:Response)=>res.locals.account as Account;
export function requireAdmin(account:Account){if(!account.admin)throw new DomainError('ADMIN_REQUIRED','Cette action est réservée aux administrateurs');}
