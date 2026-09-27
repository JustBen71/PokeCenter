import type {PublicPlayer,RouletteRun,RouletteEffect} from '@pokerace/shared';
import {progressionData} from '@pokerace/shared';
import type {Store} from './store.js';

export const badgeIds=(p:PublicPlayer)=>p.state.progression?.completed.filter(id=>progressionData.objectives.some(o=>o.id===id&&o.kind==='badge'))??[];
const living=(p:PublicPlayer)=>p.state.party.filter(mon=>mon.currentHp>0&&mon.raw).map(mon=>mon.raw!.slice(0,16));
export function installEffects(store:Store,run:RouletteRun,players:PublicPlayer[]){
 const owner=players.find(p=>p.playerId===run.spinnerId);
 if(!owner||!run.effects?.length)return;
 for(const [i,draft] of run.effects.entries()){
  const id=`${run.id}-${i}`;if(store.effects().some(e=>e.id===id))continue;
  store.putEffect({...draft,...(draft.kind==='suspend'?{releaseAt:new Date(Date.now()+draft.minutes!*60000).toISOString()}:{}),id,runId:run.id,ownerId:owner.playerId,name:run.name,status:'active',badges:badgeIds(owner),living:living(owner),trainerBattles:owner.state.events?.trainerBattles,captures:owner.state.events?.captures,routes:[],lastMap:owner.state.location?`${owner.state.location.mapGroup}:${owner.state.location.mapNumber}`:undefined,violations:0,createdAt:new Date().toISOString(),note:draft.kind==='suspend'?`En réserve pendant ${draft.minutes} minute(s). Retour automatique dès qu’une place est libre.`:draft.kind==='revive'?'Utilisable plus tard, sans expiration.':'Valable jusqu’au prochain badge.'});
 }
}
export function observeEffect(effect:RouletteEffect,players:PublicPlayer[]){
 if(effect.kind==='suspend')return;
 const owner=players.find(p=>p.playerId===effect.ownerId);
 if(!owner?.connected||!owner.state.progression||Date.now()-Date.parse(owner.lastSeenAt)>15000)return;
 const nextBadge=badgeIds(owner).some(id=>!effect.badges.includes(id));
 const dead=owner.state.party.some(mon=>mon.currentHp===0&&mon.raw&&effect.living.includes(mon.raw.slice(0,16)));
 if(effect.kind==='inheritance'){
  if(dead)return 'death' as const;
  if(nextBadge)return 'badge' as const;
 }
 if(effect.kind==='noCapture'){
  if(!owner.state.events||!owner.state.location)return;
  if(effect.captures!==undefined&&owner.state.events.captures<effect.captures){effect.status='review';effect.note='Compteur de captures revenu en arrière : vérification manuelle nécessaire.';return;}
  effect.violations=(effect.violations??0)+Math.max(0,owner.state.events.captures-(effect.captures??owner.state.events.captures));effect.captures=owner.state.events.captures;
  const location=owner.state.location,map=`${location.mapGroup}:${location.mapNumber}`;effect.routes??=[];
  if(map!==effect.lastMap){
   if(effect.routes.length>=(effect.routeCount??2)){effect.status='expired';effect.note=`Routes traversées : restriction terminée. ${effect.violations} capture(s) détectée(s) pendant le gage.`;return;}
   if(/^Route \d+/i.test(location.label)&&!effect.routes.includes(map))effect.routes.push(map);effect.lastMap=map;
  }
  effect.note=`Aucune capture sur les ${effect.routeCount} prochaines routes. ${effect.routes.length} route(s) atteinte(s), ${effect.violations} capture(s) détectée(s). Le jeu ne bloque pas les Poké Balls.`;return;
 }
 if(effect.kind==='lead'){
  if(owner.state.events&&effect.trainerBattles!==undefined&&owner.state.events.trainerBattles>effect.trainerBattles){if(!owner.state.events.trainerLead){effect.status='review';effect.note='Combat détecté mais Pokémon de départ non observé : vérifiez ce gage.';return;}effect.status='used';effect.note=owner.state.events.trainerLead===effect.identity?'Prochain combat de dresseur commencé avec le Pokémon imposé.':'Combat de dresseur détecté sans le Pokémon imposé en tête : gage non respecté.';return;}
  effect.note='Gardez ce Pokémon en tête pour votre prochain combat de dresseur.';return;
 }
 if(effect.kind==='keep'){
  const mon=owner.state.party.find(p=>p.raw?.slice(0,16)===effect.identity);
  if(mon?.currentHp===0){effect.status='used';effect.note=effect.discord?'Pokémon K.O. : les autres joueurs choisissent votre surnom Discord pour 24 h. À appliquer entre amis.':'Pokémon K.O. : obligation terminée.';return;}
  effect.note=mon?'Pokémon présent : à garder jusqu’au prochain badge.':'Pokémon absent de l’équipe : remettez-le en jeu pour respecter le gage.';
 }
 if(nextBadge&&effect.kind!=='revive'){effect.status='expired';effect.note='Prochain badge obtenu : effet terminé.';}
 effect.living=[...new Set([...effect.living,...living(owner)])];
}
export function assertKeptPokemon(store:Store,playerId:string,after:string[],returnEffectId?:string){
 for(const effect of store.effects().filter(e=>e.kind==='suspend'&&['active','review'].includes(e.status)&&e.id!==returnEffectId)){if(after.some(raw=>raw?.slice(0,16)===effect.identity))throw Error(`Ce Pokémon est temporairement indisponible (${effect.pokemonName}).`);}
 for(const effect of store.effects().filter(e=>e.ownerId===playerId&&(e.kind==='keep'||e.kind==='lead')&&e.status==='active')){
  if(!after.some(raw=>raw.slice(0,16)===effect.identity)||(effect.kind==='lead'&&after[0]?.slice(0,16)!==effect.identity))throw Error(`Ce Pokémon doit rester dans l’équipe jusqu’au prochain badge (${effect.name}).`);
 }
}
