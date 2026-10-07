import type {Express} from 'express';
import {z} from 'zod';
import {DomainError} from '../errors.js';
import {currentAccount,parseBody,requireAccount,requireAdmin,route} from '../http.js';
import type {Services} from '../services.js';

const closeSchema=z.object({status:z.enum(['SUCCESS','FAILED']),note:z.string().trim().max(300).optional()}).strict();

/** Wheels CRUD and admin-launched spins; members read wheels and results (the shop sells them in Sprint 8). */
export function registerWheelRoutes(app:Express,s:Services){
 const {accounts,lobbies}=s.domain;
 const lobby=(id:string,viewer:{id:string;admin:boolean})=>{
  const found=lobbies.require(id);
  if(!viewer.admin&&!lobbies.isMember(found.id,viewer.id))throw new DomainError('NOT_LOBBY_MEMBER','Rejoignez ce lobby avec son code');
  return found.id;
 };
 const admin=(res:Parameters<typeof currentAccount>[0])=>{const viewer=currentAccount(res);requireAdmin(viewer);return viewer;};
 for(const path of ['/api/lobbies/:id/wheels','/api/lobbies/:id/wheels-auto','/api/lobbies/:id/wheel-resolutions'])app.use(path,requireAccount(id=>accounts.get(id)));
 app.get('/api/lobbies/:id/wheels',route((req,res)=>s.wheels.snapshot(lobby(String(req.params.id),currentAccount(res)))));
 app.post('/api/lobbies/:id/wheels',route((req,res)=>{const v=admin(res);res.status(201);return s.wheels.create(lobby(String(req.params.id),v),req.body,v);}));
 app.put('/api/lobbies/:id/wheels/:wheelId',route((req,res)=>{const v=admin(res);return s.wheels.update(lobby(String(req.params.id),v),String(req.params.wheelId),req.body,v);}));
 app.delete('/api/lobbies/:id/wheels/:wheelId',route((req,res)=>{const v=admin(res);s.wheels.delete(lobby(String(req.params.id),v),String(req.params.wheelId),v);return {ok:true};}));
 app.post('/api/lobbies/:id/wheels/:wheelId/spin',route((req,res)=>{const v=admin(res);res.status(201);return s.wheels.spin(lobby(String(req.params.id),v),String(req.params.wheelId),req.body,v);}));
 app.post('/api/lobbies/:id/wheels/:wheelId/spin-all',route((req,res)=>{const v=admin(res);res.status(202);return s.wheels.spinAll(lobby(String(req.params.id),v),String(req.params.wheelId),v);}));
 app.put('/api/lobbies/:id/wheels-auto',route((req,res)=>{const v=admin(res);return s.wheels.setAutoWheel(lobby(String(req.params.id),v),req.body,v);}));
 app.post('/api/lobbies/:id/wheel-resolutions/:resolutionId/apply',route(async(req,res)=>{const v=admin(res);return s.wheels.apply(lobby(String(req.params.id),v),String(req.params.resolutionId),req.body,v);}));
 // The player the draw belongs to (Sixième sens, Maître du chaos) picks the gage; admins may pick for them.
 app.post('/api/lobbies/:id/wheel-resolutions/:resolutionId/choose',route((req,res)=>{const v=currentAccount(res);return s.wheels.choose(lobby(String(req.params.id),v),String(req.params.resolutionId),req.body,v);}));
 app.post('/api/lobbies/:id/wheel-resolutions/:resolutionId/close',route((req,res)=>{
  const v=admin(res),{status,note}=parseBody(closeSchema,req.body);
  return s.wheels.close(lobby(String(req.params.id),v),String(req.params.resolutionId),status,v,note);
 }));
}
