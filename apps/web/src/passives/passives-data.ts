import {defaultRarityWeights,passiveById,type OwnedPassive,type PassiveDefinition,type PassivesSnapshot} from '@pokerace/shared';
import {useLiveTopic} from '../realtime/live-context';

export const emptyPassives:PassivesSnapshot={phase:'NONE',catalogVersion:0,weights:{...defaultRarityWeights},catalog:[],owned:[],selection:[],myOffer:null};
export const usePassives=()=>useLiveTopic<PassivesSnapshot>('passives',emptyPassives);

export const definition=(id:string):PassiveDefinition|undefined=>passiveById.get(id);
export const ownedBy=(snapshot:PassivesSnapshot,accountId:string)=>snapshot.owned.filter(p=>p.accountId===accountId);

const count=(v:unknown)=>Array.isArray(v)?v.length:typeof v==='number'?v:0;
const step=(n:number,every:number)=>`${n % every} / ${every}`;

/** Human-readable progression of an owned passive (the keys are written by the server handlers). */
export function progressLines(owned:OwnedPassive):string[]{
 const p=owned.progress,def=definition(owned.passiveId);
 const every=def?.params.every??0;
 switch(owned.passiveId){
  case 'cartographer':return [`${count(p.places)} lieu(x) découvert(s)`,`Prochain ticket : ${step(count(p.places),every)}`];
  case 'collector':return [`${count(p.species)} espèce(s) différente(s)`,`Prochain ticket : ${step(count(p.species),every)}`];
  case 'bargain-hunter':return [p.armed?'Révélation prête pour la prochaine enchère':`Enchères perdues : ${count(p.losses)} / ${def?.params.losses??3}`];
  case 'second-wind':return [`Activations : ${count(p.uses)} / ${def?.params.max??3}`];
  case 'counterspell':return [p.lastBadGage?`Dernier gage hostile : « ${(p.lastBadGage as {name?:string}).name??'?'} » (exclu du prochain tirage)`:'Aucune roue hostile subie'];
  case 'sixth-man':return [`Badges récompensés : ${count(p.rewarded)}`];
  case 'scout':return p.next?[`Prochain objectif : ${String(p.next)}`]:[];
  default:return [];
 }
}
export const isConsumed=(owned:OwnedPassive)=>owned.progress.consumed===true;
