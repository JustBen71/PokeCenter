import type {Express} from 'express';
import {randomUUID} from 'node:crypto';
import {accountInput,accountKey,type Account} from '@pokerace/shared';
import type {Store} from './store.js';
export function registerAccounts(app:Express,store:Store,required=true){
 store.accounts();
 // Keep existing player IDs so teams, saved lots and history still refer to them.
 for(const row of store.all()){
  const name=row.state.playerName??row.playerId;
  if(!store.accounts().some(a=>a.id===row.playerId||accountKey(a.name)===accountKey(name)))store.putAccount({id:row.playerId,name,sprite:'brendan',admin:false},accountKey(name));
 }
 app.get('/api/accounts',(_req,res)=>res.json(store.accounts()));
 app.post('/api/accounts',(req,res)=>{
  const parsed=accountInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Choisissez un nom valide et un sprite'});
  const data=parsed.data;if(store.accounts().some(a=>accountKey(a.name)===accountKey(data.name)))return res.status(409).json({error:'Ce nom existe déjà : sélectionnez ce compte'});
  const account={...data,id:'p-'+randomUUID().replaceAll('-','')};store.putAccount(account,accountKey(data.name));return res.status(201).json(account);
 });
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
 app.patch('/api/accounts/:id',(req,res)=>{
  const actor=res.locals.account as Account|undefined,id=String(req.params.id);
  if(!actor||(!actor.admin&&actor.id!==id))return res.status(403).json({error:'Choisissez votre propre compte'});
  const parsed=accountInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Profil invalide'});
  if(!store.accounts().some(a=>a.id===id))return res.status(404).json({error:'Compte introuvable'});
  if(store.accounts().some(a=>a.id!==id&&accountKey(a.name)===accountKey(parsed.data.name)))return res.status(409).json({error:'Nom déjà utilisé'});
  const account={...parsed.data,id};store.putAccount(account,accountKey(account.name));return res.json(account);
 });
}
