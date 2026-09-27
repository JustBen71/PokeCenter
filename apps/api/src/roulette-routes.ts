import {randomUUID} from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import {gagSchema,type PublicPlayer,type RouletteRun,type RouletteOperation} from '@pokerace/shared';
import {actionRegistry,validateGag,weightedDraw,planGagAsync} from './roulette-engine.js';
import {installEffects,observeEffect,assertKeptPokemon} from './roulette-effects.js';
import {catalogue} from './roulette-catalogue.js';
import {resolveChoices,recordChoice} from './roulette-choices.js';
import type {Store} from './store.js';
type Send=(data:{action:'bundle';playerId:string;before:import('@pokerace/shared').GameBundle;after:import('@pokerace/shared').GameBundle}|{playerId:string;slot:number;raw:string;expectedRaw:string;action:'compareReplace'})=>Promise<void>;
export function registerRoulette(app:Express,store:Store,players:()=>PublicPlayer[],send:Send,locks:Set<string>){
 for(const run of store.unresolvedRuns())if(run.status==='preparing'){run.status='failed';run.log.push('Préparation interrompue par le redémarrage. Aucun effet appliqué.');store.putRun(run);}else if(run.status==='executing'){run.status='review';run.log.push('Serveur redémarré pendant une exécution : vérifier les équipes avant toute autre action.');store.putRun(run);}
 store.seedGags(catalogue);
 const dispatch=(op:RouletteOperation,reverse=false)=>op.bundleBefore&&op.bundleAfter?send({action:'bundle',playerId:op.playerId,before:reverse?op.bundleAfter:op.bundleBefore,after:reverse?op.bundleBefore:op.bundleAfter}):send({playerId:op.playerId,slot:op.slot,raw:reverse?op.before:op.after,expectedRaw:reverse?op.after:op.before,action:'compareReplace'});
 const save=(run:RouletteRun,line?:string)=>{if(line)run.log.push(line);store.putRun(run);};
 app.get('/api/roulette',(_req,res)=>res.json({gags:store.gags(),runs:store.runs(),effects:store.effects(),actions:Object.values(actionRegistry).map(({schema,plan,...description})=>description)}));
 app.post('/api/roulette/gags',(req,res)=>{try{const gag=gagSchema.parse(req.body);validateGag(gag);if(store.gags().length>=200)throw new Error('Maximum 200 gages');const saved={...gag,id:randomUUID()};store.putGag(saved);return res.status(201).json(saved);}catch(e){return res.status(400).json({error:String(e)});}});
 app.put('/api/roulette/gags/:id',(req,res)=>{try{const id=String(req.params.id);if(!store.gags().some(g=>g.id===id))return res.status(404).json({error:'Gage introuvable'});const gag=gagSchema.parse(req.body);validateGag(gag);const saved={...gag,id};store.putGag(saved);return res.json(saved);}catch(e){return res.status(400).json({error:String(e)});}});
 app.delete('/api/roulette/gags/:id',(req,res)=>res.status(store.deleteGag(String(req.params.id))?200:404).json({ok:true}));
 app.post('/api/roulette/draw',async(req,res)=>{
  try{
   const {drawKey,spinnerId,autoApply}=z.object({autoApply:z.boolean().default(false),drawKey:z.string().uuid(),spinnerId:z.string().min(1).max(64)}).parse(req.body);const previous=store.run(drawKey);if(previous){if(previous.spinnerId!==spinnerId)return res.status(409).json({error:'Ce tirage appartient à un autre joueur'});return res.json(previous);}
   const participants=players();const spinner=participants.find(p=>p.playerId===spinnerId);if(!spinner?.connected||spinner.state.game.romStatus!=='recognized')return res.status(400).json({error:'Choisissez un joueur connecté avec une ROM reconnue'});
   const armed=store.effects().filter(e=>e.kind==='reroll'&&e.status==='armed'&&e.targetId===spinnerId);const discarded=armed.length?weightedDraw(store.gags()):undefined;const gag=weightedDraw(store.gags());for(const card of armed){card.status='used';card.note=`Relance imposée à ${spinnerId}. Premier résultat rejeté : ${discarded!.name}`;store.putEffect(card);}const run:RouletteRun={autoApply,spinnerId,spinnerName:spinner.state.playerName??spinner.playerId,id:drawKey,drawKey,gagId:gag.id,name:gag.name,createdAt:new Date().toISOString(),gag:structuredClone(gag),status:'preparing',summary:'',operations:[],log:[],odds:store.gags().filter(g=>g.enabled).map(g=>({id:g.id,weight:g.weight}))};
   if(discarded)run.log.push(`Carte relance : ${discarded.name} rejeté. Le deuxième tirage s’applique.`);
   save(run);
   try{const resolved=resolveChoices(run,participants);if(resolved)Object.assign(run,await planGagAsync(resolved,participants,spinnerId));run.status='drawn';}catch(e){run.status='failed';run.summary='Gage non applicable';run.log.push(String(e));}
   save(run);return res.json(run);
  }catch(e){return res.status(400).json({error:String(e)});}
 });
 app.post('/api/roulette/runs/:id/choose',async(req,res)=>{
  const run=store.run(String(req.params.id));if(!run||run.status!=='drawn'||!run.pending)return res.status(409).json({error:'Aucun choix en attente'});
  try{if(req.body.key!==run.pending.key)return res.status(409).json({error:'Ce choix a déjà été traité. Actualisez le tirage.'});const value=z.string().min(1).max(100).parse(req.body.value),actor=res.locals.account?.id;if(!actor)return res.status(401).json({error:'Connectez votre compte'});
   const complete=recordChoice(run,actor,value);save(run);
   if(complete){run.status='preparing';save(run);try{const resolved=resolveChoices(run,players());if(resolved)Object.assign(run,await planGagAsync(resolved,players(),run.spinnerId!));run.status='drawn';}catch(e){run.status='failed';run.log.push(String(e));}save(run);}
   if((run.parentId||run.autoApply)&&run.status==='drawn'&&!run.pending)await execute(run);
   return res.json(run);
  }catch(e){return res.status(400).json({error:String(e)});}
 });
 app.post('/api/roulette/runs/:id/cancel',(req,res)=>{const run=store.run(String(req.params.id));if(!run)return res.status(404).json({error:'Tirage introuvable'});if(run.status!=='drawn')return res.status(409).json({error:'Tirage déjà traité'});run.status='cancelled';save(run);return res.json(run);});
 async function execute(run:RouletteRun){
  if(run.status==='completed')return run;
  if(run.returnEffectId){const effect=store.effects().find(e=>e.id===run.returnEffectId);if(!effect||effect.kind!=='suspend'||effect.triggerRunId!==run.id||effect.status!=='active'||Date.parse(effect.releaseAt!)>Date.now()||effect.ownerId!==run.spinnerId)throw Error('Restitution indisponible');}
  if(!run.spinnerId||run.pending||run.status!=='drawn')throw Error('Ce tirage attend un choix ou a déjà été traité');
  const owner=players().find(p=>p.playerId===run.spinnerId);
  if(run.effects?.length&&(!owner?.connected||!owner.state.progression))throw Error('Progression du joueur indisponible');
  const children:RouletteRun[]=[];
  if(run.gag?.action==='roulette.repeat'){
   const count=validateGag(run.gag).count;const candidates=store.gags().filter(g=>g.action!=='roulette.repeat');
   for(let i=0;i<count;i++){const gag=weightedDraw(candidates),id=randomUUID();children.push({id,drawKey:id,parentId:run.id,sequence:i,gag,gagId:gag.id,name:gag.name,spinnerId:run.spinnerId,spinnerName:run.spinnerName,createdAt:new Date().toISOString(),status:'queued',summary:`Tirage ${i+1} / ${count}`,operations:[],log:[],odds:candidates.filter(g=>g.enabled).map(g=>({id:g.id,weight:g.weight}))});}
  }
  const ids=[...new Set(run.operations.map(o=>o.playerId))];
  if(ids.some(id=>locks.has(id))||store.unresolvedRuns().some(r=>r.status==='review'&&r.operations.some(o=>ids.includes(o.playerId))))throw Error('Une action est en cours ou doit être vérifiée pour ce joueur');
  ids.forEach(id=>locks.add(id));run.status='executing';save(run,'Début de l’exécution.');
  const applied:RouletteOperation[]=[];let attempted:RouletteOperation|undefined;
  try{
   const current=players();
   for(const op of run.operations){
    const player=current.find(p=>p.playerId===op.playerId);if(!player?.connected||Date.now()-Date.parse(player.lastSeenAt)>15000)throw Error('Joueur indisponible');
    const afterParty=op.bundleAfter?.party??player.state.party.map(mon=>mon.slot===op.slot?op.after:mon.raw!);assertKeptPokemon(store,op.playerId,afterParty,run.returnEffectId);
    if(op.bundleBefore){
     if(!player.state.capabilities?.includes('game-bundle-v1'))throw Error('Relancez le client pour ces gages');
     if(player.state.trainer?.money!==op.bundleBefore.money||JSON.stringify(player.state.party.map(p=>p.raw))!==JSON.stringify(op.bundleBefore.party))throw Error('Équipe ou solde modifié depuis le tirage');
    }else if(!player.state.capabilities?.includes('compare-replace-v1')||player.state.party.find(p=>p.slot===op.slot)?.raw!==op.before)throw Error('La cible a changé depuis le tirage');
    for(const pokemon of player.state.party.filter(p=>op.bundleBefore||p.slot===op.slot))store.saveLibrary({id:randomUUID(),label:`Roulette · ${run.name}`.slice(0,80),pokemon:structuredClone(pokemon),source:player.state.playerName??player.playerId,capturedAt:player.state.observedAt,createdAt:new Date().toISOString()});
   }
   for(const op of run.operations){attempted=op;await dispatch(op);applied.push(op);attempted=undefined;save(run,`Confirmé : ${op.label}`);}
   run.status='completed';run.completedAt=new Date().toISOString();installEffects(store,run,players());for(const child of children)save(child);save(run,run.operations.length?'Tous les effets sont confirmés.':run.effects?.length?'Carte ou effet enregistré.':children.length?'Série de tirages créée.':'Consigne affichée ; à réaliser entre amis.');
  }catch(e){
   run.status=attempted?'review':'failed';save(run,`Interrompu : ${String(e)}`);
   for(const op of [...applied].reverse())try{await dispatch(op,true);save(run,`Annulation confirmée : ${op.playerId}, emplacement ${op.slot}`);}catch(error){run.status='review';save(run,`Annulation non confirmée : ${String(error)}`);}
   if(run.status==='review')save(run,'Vérifiez les équipes. Les copies avant action sont dans la bibliothèque. Aucun nouvel essai automatique.');
  }finally{ids.forEach(id=>locks.delete(id));save(run);}
  return run;
 }
 app.post('/api/roulette/runs/:id/apply',async(req,res)=>{const run=store.run(String(req.params.id));if(!run)return res.status(404).json({error:'Tirage introuvable'});try{await execute(run);await observe();return res.json(run);}catch(e){return res.status(409).json({error:String(e)});}});
 app.post('/api/roulette/effects/:id/return-review',(req,res)=>{
  const effect=store.effects().find(e=>e.id===req.params.id),actor=res.locals.account;
  if(!effect||(!actor?.admin&&actor?.id!==effect.ownerId))return res.status(403).json({error:'Effet d’un autre joueur'});
  if(effect.kind!=='suspend'||effect.status!=='review'||locks.has(effect.ownerId))return res.status(409).json({error:'Aucune restitution à vérifier'});
  const owner=players().find(p=>p.playerId===effect.ownerId);if(!owner?.connected||Date.now()-Date.parse(owner.lastSeenAt)>15000)return res.status(409).json({error:'Reconnectez le client pour vérifier son équipe'});
  const present=owner.state.party.some(p=>p.raw?.slice(0,16)===effect.identity);
  if(req.body.outcome==='returned'&&present){effect.status='used';effect.note='Restitution vérifiée dans l’équipe.';}
  else if(req.body.outcome==='retry'&&!present){effect.status='active';effect.note='Absence vérifiée manuellement (équipe et boîtes) : retour autorisé.';}
  else return res.status(409).json({error:'Le choix ne correspond pas à l’équipe actuelle'});
  if(effect.triggerRunId){const run=store.run(effect.triggerRunId);if(run?.status==='review'){run.status='failed';save(run,'Restitution vérifiée manuellement via la réserve.');}}
  effect.triggerRunId=undefined;store.putEffect(effect);return res.json(effect);
 });
 app.post('/api/roulette/effects/:id/resolve',(req,res)=>{const effect=store.effects().find(e=>e.id===req.params.id),actor=res.locals.account;if(!effect||(!actor?.admin&&actor?.id!==effect.ownerId))return res.status(403).json({error:'Effet d’un autre joueur'});if(effect.kind==='suspend')return res.status(409).json({error:'Vérifiez le tirage de restitution ; le Pokémon doit rester conservé en réserve.'});if(effect.status!=='review')return res.status(409).json({error:'Pas de vérification en attente'});effect.status='expired';effect.note+=' Vérifié et clôturé manuellement.';store.putEffect(effect);return res.json(effect);});
 app.post('/api/roulette/effects/:id/use',async(req,res)=>{
  const effect=store.effects().find(e=>e.id===req.params.id),actor=res.locals.account?.id;if(!effect||actor!==effect.ownerId)return res.status(403).json({error:'Cette carte appartient à un autre joueur'});
  if(effect.status!=='active')return res.status(409).json({error:'Carte déjà utilisée ou expirée'});
  observeEffect(effect,players());if(effect.status!=='active'){store.putEffect(effect);return res.status(409).json({error:'Le badge a fait expirer cette carte'});}
  try{
   if(effect.kind==='reroll'){
    const target=z.string().min(1).parse(req.body.playerId);if(target===actor||!players().some(p=>p.playerId===target&&p.connected))throw Error('Choisissez un autre joueur connecté');
    if(store.effects().some(e=>e.kind==='reroll'&&e.status==='armed'&&e.targetId===target))throw Error('Ce joueur a déjà une relance imposée');
    effect.status='armed';effect.targetId=target;effect.note='La prochaine roulette de ce joueur rejettera le premier résultat.';store.putEffect(effect);return res.json(effect);
   }
   if(effect.kind==='revive'){
    const owner=players().find(p=>p.playerId===actor);if(!owner?.state.party.some(p=>p.currentHp===0))throw Error('Aucun Pokémon K.O. dans l’équipe. La carte est conservée.');
    const id=randomUUID(),gag={id,name:'Résurrection conservée',weight:1,enabled:true,action:'pokemon.revive',blocks:{pokemonA:{mode:'choice',by:'vote'}}};
    const run:RouletteRun={id,drawKey:id,gag,gagId:id,name:gag.name,spinnerId:actor,createdAt:new Date().toISOString(),status:'preparing',summary:'',operations:[],log:[],odds:[]};
    effect.status='used';effect.triggerRunId=id;store.putEffect(effect);await prepare(run);if(run.status==='failed'){effect.status='active';effect.note='Vote indisponible : carte conservée.';store.putEffect(effect);}return res.json({effect,run});
   }
   return res.status(400).json({error:'Cet effet se déclenche automatiquement'});
  }catch(e){return res.status(400).json({error:String(e)});}
 });
 app.post('/api/roulette/runs/:id/reviewed',(req,res)=>{const run=store.run(String(req.params.id));if(!run||run.status!=='review')return res.status(409).json({error:'Aucune vérification en attente'});if(run.operations.some(o=>locks.has(o.playerId)))return res.status(409).json({error:'Action en cours'});run.status='failed';save(run,'Équipes vérifiées manuellement par un utilisateur ; verrou levé.');return res.json(run);});

 async function prepare(run:RouletteRun){
  run.status='preparing';save(run);
  try{const resolved=resolveChoices(run,players());if(resolved)Object.assign(run,await planGagAsync(resolved,players(),run.spinnerId!));run.status='drawn';}catch(e){run.status='failed';run.log.push(String(e));}
  save(run);return run;
 }
 let observing=false;
 async function observe(){
  if(observing)return;observing=true;
  try{
   for(const effect of store.effects().filter(e=>e.kind==='suspend'&&e.status==='active')){
    const previous=effect.triggerRunId?store.run(effect.triggerRunId):undefined;
    if(previous?.status==='completed'){effect.status='used';effect.note='Pokémon restitué avec ses données conservées.';store.putEffect(effect);continue;}
    if(previous&&['review','executing','preparing'].includes(previous.status)){effect.status='review';effect.note='Restitution non confirmée : vérifiez la partie avant toute autre tentative.';store.putEffect(effect);continue;}
    if(Date.parse(effect.releaseAt!)>Date.now())continue;
    const owner=players().find(p=>p.playerId===effect.ownerId);
    if(!owner?.connected||Date.now()-Date.parse(owner.lastSeenAt)>15000){effect.note='Durée terminée : retour en attente de reconnexion.';store.putEffect(effect);continue;}
    if(owner.state.party.some(p=>p.raw?.slice(0,16)===effect.identity)){effect.status='review';effect.note='Une copie de ce Pokémon est déjà dans l’équipe : vérifiez la restitution.';store.putEffect(effect);continue;}
    if(owner.state.party.length>=6){effect.note='Durée terminée : libérez une place dans votre équipe pour le retour.';store.putEffect(effect);continue;}
    if(locks.has(owner.playerId)||store.unresolvedRuns().some(r=>r.status==='review'&&r.operations.some(o=>o.playerId===owner.playerId)))continue;
    if(!owner.state.capabilities?.includes('game-bundle-v1')||owner.state.trainer?.money===undefined||owner.state.party.some(p=>!p.raw))continue;
    const before={money:owner.state.trainer.money,party:owner.state.party.map(p=>p.raw!)},id=randomUUID();
    const run:RouletteRun={id,drawKey:id,returnEffectId:effect.id,gagId:'timed-return',name:`Retour de ${effect.pokemonName}`,spinnerId:owner.playerId,createdAt:new Date().toISOString(),status:'drawn',summary:'Restitution après indisponibilité',operations:[{playerId:owner.playerId,slot:0,before:'',after:'',label:'Restitution du Pokémon conservé',bundleBefore:before,bundleAfter:{...before,party:[...before.party,effect.raw!]}}],log:[],odds:[]};
    save(run);effect.triggerRunId=id;store.putEffect(effect);await execute(run);
    if(run.status==='completed'){effect.status='used';effect.note='Pokémon restitué avec ses données conservées.';}else if(run.status==='review'){effect.status='review';effect.note='Restitution non confirmée : vérification nécessaire, aucun nouvel essai automatique.';}else effect.note='Retour différé : l’équipe a changé, nouvel essai avec un état actualisé.';store.putEffect(effect);
   }
   for(const effect of store.effects().filter(e=>e.status==='active'||e.status==='armed')){
    const event=observeEffect(effect,players());
    if(event&&effect.kind==='inheritance'){
     const id=`effect-${effect.id}`;const previous=store.run(id);
     if(!previous){const gag={id,name:effect.name,enabled:true,weight:1,action:'money.transfer',blocks:{direction:event==='death'?'give':'steal',percent:event==='death'?effect.deathPercent!:effect.badgePercent!,playerB:{mode:'fixed',playerId:effect.targetId!}}};
      const run:RouletteRun={id,drawKey:id,gagId:id,gag,name:effect.name,spinnerId:effect.ownerId,createdAt:new Date().toISOString(),status:'queued',summary:event==='death'?'Héritage déclenché par un décès':'Héritage déclenché par le prochain badge',operations:[],log:[],odds:[]};save(run);
     }
     effect.status='triggered';effect.triggerRunId=id;effect.note=event==='death'?'Décès observé : versement à l’héritier en attente.':'Badge obtenu sans décès observé : prélèvement chez l’héritier en attente.';
    }
    store.putEffect(effect);
   }
   for(const run of store.pendingRuns().filter(r=>r.status==='queued')){
    const needed=[run.spinnerId,(run.gag?.blocks.playerB as {playerId?:string})?.playerId].filter(Boolean);
    if(needed.some(id=>locks.has(id!)))continue;
    if(needed.some(id=>!players().some(p=>p.playerId===id&&p.connected&&Date.now()-Date.parse(p.lastSeenAt)<15000)))continue;
    if(run.parentId){if(store.run(run.parentId)?.status!=='completed')continue;const siblings=store.childRuns(run.parentId).filter(r=>(r.sequence??0)<(run.sequence??0));if(siblings.some(r=>['queued','preparing','drawn','executing','review'].includes(r.status)))continue;
     const previous=siblings.sort((a,b)=>(b.sequence??0)-(a.sequence??0))[0];if(previous?.completedAt&&previous.operations.some(op=>{const p=players().find(p=>p.playerId===op.playerId);return !p||Date.parse(p.receivedAt)<=Date.parse(previous.completedAt!);} ))continue;
    }
    await prepare(run);if(run.status==='drawn'&&!run.pending)await execute(run);
   }
  }finally{observing=false;}
 }
 return {observe};
}
