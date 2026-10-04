import {auctionHints} from './auction-hints.js';
import {randomUUID} from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import type {Auction,PublicAuction,PublicPlayer,Purchase} from '@pokerace/shared';
import type {Store} from './store.js';
import {generateLot} from './auction-generator.js';

export function publicAuction(a:Auction):PublicAuction{
 const {template,settlement,...visible}=a;return visible;
}
export function registerAuctions(app:Express,store:Store,players:()=>PublicPlayer[],send:(data:Purchase,commandId:string)=>Promise<void>,locks:Set<string>,generate=generateLot,generationPlayers=players){
 let generating=false;
 for(const a of store.auctions())if(a.status==='settling'||a.status==='review'){
  a.status='review';if(a.settlement)locks.add(a.settlement.playerId);store.putAuction(a);
 }
 const pending=()=>store.auctions().find(a=>['open','settling','review'].includes(a.status));
 const find=(id:string)=>{const a=store.auctions().find(a=>a.id===id);if(!a)throw Error('Enchère introuvable');return a;};
 const eligible=(id:string)=>{
  const p=players().find(p=>p.playerId===id);
  if(!p?.connected||Date.now()-Date.parse(p.lastSeenAt)>15000||p.state.game.romStatus!=='recognized')throw Error('Joueur hors ligne ou données trop anciennes');
  if(!p.state.capabilities?.includes('auction-purchase-v1')||p.state.trainer?.money===undefined)throw Error('Relancez le client pour activer les Pokédollars et les enchères');
  if(p.state.trainer.partyCount!==p.state.party.length||p.state.party.length>=6)throw Error('Il faut un emplacement libre dans une équipe à jour');
  if(locks.has(id)||store.unresolvedRuns().some(r=>r.operations.some(o=>o.playerId===id)))throw Error('Une autre action utilise ce joueur ou attend une vérification');
  return p;
 };
 app.get('/api/auctions',(_req,res)=>res.json({auctions:store.auctions().slice(0,100).map(publicAuction),generating}));
 app.post('/api/auctions',async(req,res)=>{
  if(generating||pending())return res.status(409).json({error:'Terminez ou annulez l’enchère en cours'});
  generating=true;
  try{
   const {uncertainty}=z.object({uncertainty:z.number().int().min(0).max(100).default(25)}).parse(req.body??{});
   const lot=await generate(generationPlayers());
   const a:Auction={...lot,uncertainty,hints:auctionHints(lot.template,uncertainty),id:randomUUID(),createdAt:new Date().toISOString(),status:'open',bids:[],log:['Enchère ouverte. Les caractéristiques sont présentées par fourchettes.']};store.putAuction(a);return res.status(201).json(publicAuction(a));
  }catch(e){return res.status(400).json({error:String(e)});}finally{generating=false;}
 });
 app.post('/api/auctions/:id/bid',(req,res)=>{
  try{
   const {playerId,amount}=z.object({playerId:z.string(),amount:z.number().int().min(1).max(999999)}).parse(req.body);
   const a=find(String(req.params.id));if(a.status!=='open')throw Error('Les mises sont closes');const p=eligible(playerId);
   if(amount>p.state.trainer!.money!)throw Error('Pokédollars insuffisants');
   const last=a.bids.at(-1);if(last?.playerId===playerId&&last.amount===amount)return res.json(publicAuction(a));
   if(amount<=(last?.amount??0))throw Error('La mise doit dépasser la meilleure offre');
   if(a.bids.length>=1000)throw Error('Limite de mises atteinte : acceptez ou annulez cette enchère');
   a.bids.push({playerId,playerName:p.state.playerName??playerId,amount,at:new Date().toISOString()});store.putAuction(a);return res.json(publicAuction(a));
  }catch(e){return res.status(409).json({error:String(e)});}
 });
 app.post('/api/auctions/:id/cancel',(req,res)=>{
  try{const a=find(String(req.params.id));if(a.status!=='open')throw Error('Enchère déjà traitée');a.status='cancelled';a.log.push('Annulée sans débit.');store.putAuction(a);return res.json(publicAuction(a));}catch(e){return res.status(409).json({error:String(e)});}
 });
 app.post('/api/auctions/:id/accept',async(req,res)=>{
  let a:Auction|undefined;
  try{
   a=find(String(req.params.id));if(a.status==='sold')return res.json(publicAuction(a));if(a.status!=='open')throw Error('Cette enchère ne peut pas être appliquée');
   const {playerId,amount}=z.object({playerId:z.string(),amount:z.number().int().positive()}).parse(req.body);
   const bid=a.bids.at(-1);if(!bid||bid.playerId!==playerId||bid.amount!==amount)throw Error('La meilleure offre a changé : vérifiez le nouveau montant');
   const p=eligible(playerId);if(amount>p.state.trainer!.money!)throw Error('Le solde du gagnant est maintenant insuffisant');
   a.settlement={playerId,price:amount,moneyBefore:p.state.trainer!.money!,countBefore:p.state.party.length,commandId:randomUUID()};
   a.status='settling';a.log.push(`Attribution à ${bid.playerName} pour ${amount} ₽ en cours.`);store.putAuction(a);locks.add(playerId);
   const template={...a.template,playerId,slot:p.state.party.length+1};
   await send({...template,action:'purchase',price:amount,expectedMoney:a.settlement.moneyBefore,expectedCount:a.settlement.countBefore},a.settlement.commandId);
   a.status='sold';a.log.push('Paiement et ajout dans l’équipe confirmés par le jeu.');store.putAuction(a);locks.delete(playerId);
   return res.json(publicAuction(a));
  }catch(e){
   if(a?.status==='settling'){
    a.status='review';a.log.push(`Confirmation manquante : ${String(e)}. Vérifiez le solde et l’équipe avant toute autre action. Aucun nouvel essai automatique.`);store.putAuction(a);return res.status(409).json({error:'Vérification du jeu nécessaire',auction:publicAuction(a)});
   }
   return res.status(409).json({error:String(e)});
  }
 });
 app.post('/api/auctions/:id/reviewed',(req,res)=>{
  try{const a=find(String(req.params.id));if(a.status!=='review')throw Error('Aucune vérification en attente');const {outcome}=z.object({outcome:z.enum(['sold','cancelled'])}).parse(req.body);a.status=outcome;a.log.push('Solde et équipe vérifiés manuellement ; verrou levé.');store.putAuction(a);if(a.settlement)locks.delete(a.settlement.playerId);return res.json(publicAuction(a));}catch(e){return res.status(409).json({error:String(e)});}
 });
}
