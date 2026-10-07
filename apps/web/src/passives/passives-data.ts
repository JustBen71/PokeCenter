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
  case 'usurper':return [p.copied?`A copié « ${String(p.copied)} »`:'Pas encore utilisé'];
  case 'fate-link':return p.partner?[`Lié à ${String(p.partnerName)}`,`Objectifs : ${count(p.mine)} (toi) · ${count(p.theirs)} (partenaire), ticket tous les ${def?.params.objectives??3}`]:['Choisis un partenaire'];
  case 'champion-crown':return [Array.isArray(p.offer)?'Offre de passifs en attente de ton choix':`Charges : ${count(p.charges)} / ${def?.params.charges??3} (seulement en étant #1)`];
  case 'chaos-master':return [p.consumed?'Utilisé':'Prêt : s’active à la prochaine roue hostile contre toi'];
  case 'paradox':return [p.consumed?'Utilisé':'Prêt'];
  case 'bound-soul':{const b=p.bound as {name?:string;level?:number}|undefined;return b?[`Lié : ${b.name} (niv. ${b.level})`,p.ready?'Prêt à rejoindre la Run en cours (réinjection par un admin)':'Disponible après une Run perdue']:['Aucun Pokémon lié'];}
  case 'loyal-companion':{const c=p.companion as {name?:string}|undefined;return c?[`Compagnon : ${c.name}`,p.heal?'Soin de l’équipe en attente (dès que tu es hors combat)':`Objectifs avec lui : ${count(p.objectives)} / ${def?.params.objectives??3}`]:['Compagnon : le premier Pokémon de ton équipe'];}
  case 'last-standing':return [p.heal?'Soin à 50 % en attente (dès que tu es hors combat)':p.used?'Utilisé pendant cette Run':'Une fois par Run'];
  case 'alchemist':return Array.isArray(p.natureNames)?[p.used?'Utilisé pendant cette Run':`Natures proposées : ${(p.natureNames as string[]).join(', ')}`]:['Natures tirées au début de la Run'];
  case 'unstable-dna':return [`Charges : ${count(p.charges)}`,`Objectifs : ${count(p.objectives)} (une charge tous les ${def?.params.objectives??2})`];
  case 'treasure-hunter':return [`Victoires contre des dresseurs : ${step(count(p.wins),every)}`,...(count(p.items)?[`${count(p.items)} objet(s) en attente d’une place dans le sac`]:[])];
  case 'type-master':return count(p.items)?[`${count(p.items)} CT en attente d’une place dans le sac`]:[];
  case 'marathoner':return [`${count(p.steps).toLocaleString('fr-FR')} pas sur la course`,`Paliers payés : ${count(p.paid)}`];
  case 'resurrection':return [p.used?'Utilisé pendant cette Run':'Une fois par Run'];
  case 'mutagen':{const o=p.offer as {pokemon?:string;moves?:{name:string}[]}|null|undefined;return o?[`Offre pour ${o.pokemon} : ${(o.moves??[]).map(m=>m.name).join(', ')}`]:[p.used?'Utilisé pendant cette Run':'Une fois par Run'];}
  case 'legend-heir':return [p.hatched?`Éclos : ${String(p.hatched)}`:p.ready?'L’œuf a éclos : garde une place dans ton équipe':`Œuf : ${count(p.steps).toLocaleString('fr-FR')} / ${(def?.params.steps??50000).toLocaleString('fr-FR')} pas`];
  default:return [];
 }
}
export const isConsumed=(owned:OwnedPassive)=>owned.progress.consumed===true;
