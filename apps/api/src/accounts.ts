import type {Express} from 'express';
import {accountKey} from '@pokerace/shared';
import {AccountService} from './accounts/account-service.js';
import {currentAccount,route} from './http.js';
import type {Store} from './store.js';
export function registerAccounts(app:Express,store:Store,required=true){
 store.accounts();
 // Keep existing player IDs so teams, saved lots and history still refer to them.
 for(const row of store.all()){
  const name=row.state.playerName??row.playerId;
  if(!store.accounts().some(a=>a.id===row.playerId||accountKey(a.name)===accountKey(name)))store.putAccount({id:row.playerId,name,sprite:'brendan',admin:false},accountKey(name));
 }
 app.get('/api/accounts',(_req,res)=>res.json(store.accounts()));
 // Account writes need the portal database (accounts are global); course databases never expose them.
 const service=store.portal&&new AccountService(store.portal.accounts,store.portal.audit);
 if(service)app.post('/api/accounts',route((req,res)=>{res.status(201);return service.create(req.body);}));
 app.use('/api',(req,res,next)=>{
  if(!required)return next();
  const account=store.accounts().find(a=>a.id===req.header('x-account-id'));if(!account)return res.status(401).json({error:'Choisissez votre compte pour vous connecter'});
  res.locals.account=account;
  const adminOnly=(req.path==='/auctions'&&req.method==='POST')||(/^\/auctions\/[^/]+\/(accept|cancel|reviewed)$/.test(req.path)&&req.method==='POST')||(/^\/roulette\/gags(\/|$)/.test(req.path)&&req.method!=='GET');
  if(adminOnly&&!account.admin)return res.status(403).json({error:'Cette action est réservée aux administrateurs'});
  if(req.method==='POST'&&/^\/auctions\/[^/]+\/bid$/.test(req.path)&&req.body?.playerId!==account.id)return res.status(403).json({error:'Vous ne pouvez miser que pour votre compte'});
  if(!account.admin&&req.method==='POST'){
   if(req.path==='/roulette/draw'&&req.body?.spinnerId!==account.id)return res.status(403).json({error:'Choisissez votre compte pour tourner la roue'});
   if(['/pokemon','/admin/pokemon'].includes(req.path)&&req.body?.playerId!==account.id)return res.status(403).json({error:'Vous ne pouvez modifier que votre équipe'});
   const match=req.path.match(/^\/roulette\/runs\/([^/]+)\/(apply|cancel|reviewed)$/);if(match&&store.run(match[1])?.spinnerId!==account.id)return res.status(403).json({error:'Ce tirage appartient à un autre joueur'});
  }
  next();
 });
 if(service)app.patch('/api/accounts/:id',route((req,res)=>service.update(currentAccount(res),String(req.params.id),req.body)));
}
