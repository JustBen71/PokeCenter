import {generateLot} from './auction-generator.js';

import {encodePokemon,emeraldPP} from '@pokerace/shared';

import {randomInt} from 'node:crypto';

import {z} from 'zod';

import {progressionData,playerSelectorSchema,pokemonSelectorSchema,type Gag,type PlayerSelector,type PokemonSelector,type PublicPlayer,type ActionDescription,type RouletteOperation,type RouletteEffectDraft} from '@pokerace/shared';

type Context={spinnerId:string;players:PublicPlayer[];random:(max:number)=>number};

type Action=ActionDescription&{schema:z.ZodTypeAny;plan:(blocks:any,context:Context)=>{summary:string;operations:RouletteOperation[];effects?:RouletteEffectDraft[]}};

const choose=<T>(list:T[],c:Context):T=>{if(!list.length)throw new Error('Aucune cible disponible');return list[c.random(list.length)];};

const name=(p:PublicPlayer)=>p.state.playerName??p.playerId;

function bundle(p:PublicPlayer){if(!p.state.capabilities?.includes('game-bundle-v1')||p.state.trainer?.money===undefined||p.state.party.some(mon=>!mon.raw))throw Error('Relancez le client pour activer les transactions de gages');return {money:p.state.trainer.money,party:p.state.party.map(mon=>mon.raw!)};}

function moneyPlan(b:{playerB:PlayerSelector;percent:number;direction:string},c:Context){

 const a=selectPlayer({mode:'fixed',playerId:c.spinnerId},c),others=c.players.filter(p=>p.playerId!==a.playerId);

 if(b.direction==='redistribute'){

  if(!others.length||others.some(p=>!p.connected))throw Error('Tous les destinataires doivent être connectés');

  const total=Math.floor(bundle(a).money*b.percent/100),share=Math.floor(total/others.length),extra=total%others.length;

  return {summary:`Redistribuer ${total} Pokédollars de ${name(a)} entre ${others.length} joueurs`,operations:[a,...others].map((p,i)=>{const before=bundle(p),after={...before,money:i===0?before.money-total:before.money+share+(i<=extra?1:0)};if(after.money>999999)throw Error('Plafond de Pokédollars dépassé');return {playerId:p.playerId,slot:0,before:'',after:'',label:`${name(p)} : ${before.money} → ${after.money} ₽`,bundleBefore:before,bundleAfter:after};})};

 }

 const target=selectPlayer(b.playerB,c,a.playerId),from=b.direction==='give'?a:target,to=b.direction==='give'?target:a;

 const source=bundle(from),dest=bundle(to),amount=Math.floor(source.money*b.percent/100);if(dest.money+amount>999999)throw Error('Le destinataire dépasserait le plafond de Pokédollars');

 return {summary:`Transférer ${amount} Pokédollars de ${name(from)} à ${name(to)}`,operations:[{playerId:from.playerId,slot:0,before:'',after:'',label:`Débit ${name(from)} : ${amount} ₽`,bundleBefore:source,bundleAfter:{...source,money:source.money-amount}},{playerId:to.playerId,slot:0,before:'',after:'',label:`Crédit ${name(to)} : ${amount} ₽`,bundleBefore:dest,bundleAfter:{...dest,money:dest.money+amount}}]};

}

function score(p:PublicPlayer){const done=new Set(p.state.progression?.completed);return progressionData.objectives.reduce((sum,o)=>sum+(done.has(o.id)?({champion:100000,league:10000,badge:100,story:1}[o.kind]??0):0),0);}

export function selectPlayer(selector:PlayerSelector,c:Context,exclude?:string) {

 if(selector.mode==='choice')throw Error('Choix du joueur en attente');

 const pool=c.players.filter(p=>p.connected&&p.state.game.romStatus==='recognized');

 if(selector.mode==='fixed'){const p=pool.find(p=>p.playerId===selector.playerId&&p.playerId!==exclude);if(!p)throw new Error('Joueur choisi indisponible ou identique à la première cible');return p;}

 if(selector.mode==='random')return choose(pool.filter(p=>p.playerId!==exclude),c);

 // Rank selectors consider every known race participant, including offline players.

 // A missing participant must not silently promote somebody else.

 if(c.players.some(p=>!p.state.progression))throw new Error('Classement incomplet : relancez les clients sans progression');

 const sorted=[...c.players].sort((a,b)=>score(b)-score(a)||a.playerId.localeCompare(b.playerId));

 const index=selector.mode==='first'?0:selector.mode==='last'?sorted.length-1:selector.mode==='penultimate'?sorted.length-2:(selector.rank??1)-1;

 if(index<0||index>=sorted.length)throw new Error('Rang indisponible');

 const targetScore=score(sorted[index]);

 const tied=sorted.filter(p=>score(p)===targetScore);

 if(tied.some(p=>!p.connected||p.state.game.romStatus!=='recognized'))throw new Error('Un joueur du rang sélectionné est hors ligne');

 return choose(tied.filter(p=>p.playerId!==exclude),c);

}

function selectPokemon(player:PublicPlayer,selector:PokemonSelector,c:Context){

 if(selector.mode==='choice')throw Error('Choix du Pokémon en attente');

 if(player.state.party.some(p=>!p.raw))throw new Error('Copie complète indisponible : relancez le client');

 const party=player.state.party.filter(p=>p.currentHp!==0);

 if(selector.mode==='slot'){const p=party.find(p=>p.slot===selector.slot);if(!p)throw new Error('Emplacement vide');return p;}

 if(selector.mode==='random')return choose(party,c);

 const level=(selector.mode==='highest'?Math.max:Math.min)(...party.map(p=>p.level));return choose(party.filter(p=>p.level===level),c);

}

const pairSchema=z.object({playerB:playerSelectorSchema,pokemonA:pokemonSelectorSchema,pokemonB:pokemonSelectorSchema});

const fields:ActionDescription['fields']=[{key:'playerA',label:'Joueur A',type:'spinner'},{key:'pokemonA',label:'Pokémon de A',type:'pokemon'},{key:'playerB',label:'Joueur B',type:'player'},{key:'pokemonB',label:'Pokémon de B',type:'pokemon'}];

function pairPlan(blocks:z.infer<typeof pairSchema>,c:Context,swap:boolean){

 const a=selectPlayer({mode:'fixed',playerId:c.spinnerId},c),b=selectPlayer(blocks.playerB,c,a.playerId);

 if(!a.state.capabilities?.includes("compare-replace-v1")||!b.state.capabilities?.includes("compare-replace-v1"))throw new Error("Relancez les deux clients pour activer les gages Pokémon");

 const pa=selectPokemon(a,blocks.pokemonA,c),pb=selectPokemon(b,blocks.pokemonB,c);

 const operations:RouletteOperation[]=[{playerId:a.playerId,slot:pa.slot,before:pa.raw!,after:pb.raw!,label:`${name(a)} · ${pa.nickname||pa.speciesName} → ${pb.nickname||pb.speciesName}`}];

 if(swap)operations.push({playerId:b.playerId,slot:pb.slot,before:pb.raw!,after:pa.raw!,label:`${name(b)} · ${pb.nickname||pb.speciesName} → ${pa.nickname||pa.speciesName}`});

 return {operations,summary:swap?`Échanger ${pa.nickname||pa.speciesName} de ${name(a)} avec ${pb.nickname||pb.speciesName} de ${name(b)}`:`Remplacer ${pa.nickname||pa.speciesName} de ${name(a)} par une copie de ${pb.nickname||pb.speciesName} de ${name(b)}`};

}

// Each domain extension supplies a schema, editor fields and a planner.

// The executor handles snapshots, confirmations, rollback and the durable journal.

export const actionRegistry:Record<string,Action>={

 'money.transfer':{id:'money.transfer',label:'Argent · voler, donner ou redistribuer',description:'Transfert conditionnel des vrais Pokédollars, avec compensation si une confirmation échoue.',fields:[{key:'playerA',label:'Joueur A',type:'spinner'},{key:'direction',label:'Opération',type:'select',default:'steal',options:[{value:'steal',label:'Voler au joueur B'},{value:'give',label:'Donner au joueur B'},{value:'redistribute',label:'Partager entre les autres joueurs'}]},{key:'percent',label:'Pourcentage du solde',type:'number',min:1,max:100,default:50},{key:'playerB',label:'Joueur B',type:'player'}],schema:z.object({direction:z.enum(['steal','give','redistribute']),percent:z.number().int().min(1).max(100),playerB:playerSelectorSchema.default({mode:'random'})}),plan:moneyPlan},

 'pokemon.suspend':{id:'pokemon.suspend',label:'Pokémon · indisponibilité temporaire',description:'Retire le Pokémon dans une réserve du portail, puis le rend après la durée choisie (temps réel, même déconnecté). Ses données sont conservées exactement. Le retour attend une place libre et un client connecté.',fields:[{key:'playerA',label:'Joueur concerné',type:'spinner'},{key:'pokemonA',label:'Pokémon indisponible',type:'pokemon',default:{mode:'choice'}},{key:'minutes',label:'Durée en minutes',type:'number',min:1,max:1440,default:10}],schema:z.object({pokemonA:pokemonSelectorSchema,minutes:z.number().int().min(1).max(1440)}),plan:(b,c)=>{const a=selectPlayer({mode:'fixed',playerId:c.spinnerId},c),mon=selectPokemon(a,b.pokemonA,c),before=bundle(a);if(!a.state.party.some(p=>p.slot!==mon.slot&&p.currentHp>0))throw Error('Il faut conserver au moins un Pokémon vivant dans l’équipe');const after={...before,party:before.party.filter((_,i)=>i!==mon.slot-1)};return {summary:`${mon.nickname||mon.speciesName} indisponible pendant ${b.minutes} minute(s)`,operations:[{playerId:a.playerId,slot:0,before:'',after:'',label:'Mise en réserve temporaire',bundleBefore:before,bundleAfter:after}],effects:[{kind:'suspend',identity:mon.raw!.slice(0,16),raw:mon.raw!,speciesId:mon.speciesId,pokemonName:mon.nickname||mon.speciesName,minutes:b.minutes}]};}},
 'card.grant':{id:'card.grant',label:'Carte · récompense à conserver',description:'Carte persistante de relance jusqu’au prochain badge, ou résurrection conservable sans expiration.',fields:[{key:'kind',label:'Carte',type:'select',default:'reroll',options:[{value:'reroll',label:'Forcer la prochaine relance d’un autre joueur'},{value:'revive',label:'Résurrection après vote, utilisable plus tard'}]}],schema:z.object({kind:z.enum(['reroll','revive'])}),plan:b=>({summary:b.kind==='reroll'?'Carte relance disponible jusqu’au prochain badge':'Résurrection conservée : utilisez-la quand vous voulez',operations:[],effects:[{kind:b.kind}]})},
 'rule.inheritance':{id:'rule.inheritance',label:'Contrat · décès ou prochain badge',description:'Au premier décès observé, donnez un pourcentage à l’héritier. Sinon, au prochain badge, prenez un pourcentage de son solde.',fields:[{key:'playerB',label:'Héritier',type:'player',default:{mode:'choice'}},{key:'deathPercent',label:'Pourcentage donné au décès',type:'number',default:50,min:1,max:100},{key:'badgePercent',label:'Pourcentage pris au prochain badge',type:'number',default:25,min:1,max:100}],schema:z.object({playerB:playerSelectorSchema,deathPercent:z.number().int().min(1).max(100),badgePercent:z.number().int().min(1).max(100)}),plan:(b,c)=>{const target=selectPlayer(b.playerB,c,c.spinnerId);return {summary:`Contrat d’héritage avec ${name(target)} : ${b.deathPercent} % au décès, sinon ${b.badgePercent} % au prochain badge`,operations:[],effects:[{kind:'inheritance',targetId:target.playerId,deathPercent:b.deathPercent,badgePercent:b.badgePercent}]};}},
 'rule.keep':{id:'rule.keep',label:'Règle · garder un Pokémon jusqu’au badge',description:'Suit la présence et les PV du Pokémon. Les changements via le portail sont bloqués. Les déplacements en jeu sont signalés ; la consigne Discord reste à réaliser entre amis.',fields:[{key:'pokemonA',label:'Pokémon à garder',type:'pokemon',default:{mode:'lowest'}},{key:'discord',label:'Consigne Discord en cas de décès',type:'select',default:'yes',options:[{value:'yes',label:'Surnom choisi par les autres pendant 24 h'},{value:'no',label:'Aucune'}]}],schema:z.object({pokemonA:pokemonSelectorSchema,discord:z.enum(['yes','no'])}),plan:(b,c)=>{const a=selectPlayer({mode:'fixed',playerId:c.spinnerId},c),mon=selectPokemon(a,b.pokemonA,c);return {summary:`Gardez ${mon.nickname||mon.speciesName} jusqu’au prochain badge`,operations:[],effects:[{kind:'keep',identity:mon.raw!.slice(0,16),discord:b.discord==='yes'}]};}},
 'roulette.repeat':{id:'roulette.repeat',label:'Roue · plusieurs tirages successifs',description:'Enchaîne plusieurs gages ; les choix nécessaires restent interactifs. Les doubles roues ne sont pas sélectionnées dans cette série.',fields:[{key:'count',label:'Nombre de tirages',type:'number',default:2,min:2,max:5}],schema:z.object({count:z.number().int().min(2).max(5)}),plan:b=>({summary:`${b.count} gages successifs, chacun avec ses propres effets`,operations:[]})},
 'pokemon.people':{id:'pokemon.people',label:'Pokémon · trois propositions puis hasard',description:'Les autres joueurs votent pour trois espèces distinctes. Une est tirée au hasard et doit être gardée jusqu’au prochain badge.',fields:[],schema:z.object({}),plan:()=>{throw Error('Propositions en attente');}},
 'pokemon.dilemma':{id:'pokemon.dilemma',label:'Pokémon · choix entre deux enveloppes',description:'A : légendaire contre un Pokémon au hasard. B : meilleur Pokémon adverse contre celui choisi par sa victime.',fields:[],schema:z.object({}),plan:()=>{throw Error('Choisissez une enveloppe');}},
 'pokemon.steal':{id:'pokemon.steal',label:'Pokémon · vol avec remplacement ou pile ou face',description:'Prendre un Pokémon vivant. Avec remplacement, la victime reçoit une espèce aléatoire. Avec pile ou face, le vol peut se retourner contre A. Une place libre est nécessaire chez le receveur.',fields:[{key:'playerB',label:'Victime',type:'player',default:{mode:'choice'}},{key:'pokemonB',label:'Pokémon à prendre',type:'pokemon',default:{mode:'choice'}},{key:'risk',label:'Risque',type:'select',default:'replace',options:[{value:'replace',label:'La victime reçoit un Pokémon aléatoire'},{value:'coin',label:'50 % : la victime vole un Pokémon à A'}]}],schema:z.object({playerB:playerSelectorSchema,pokemonB:pokemonSelectorSchema,risk:z.enum(['replace','coin'])}),plan:()=>{throw Error('Préparation du vol');}},
 'pokemon.grant':{id:'pokemon.grant',label:'Pokémon · offrir une espèce ou un tirage',description:'Ajout dans une place libre. Niveau fixe ou moyenne de votre équipe ; option premier emplacement.',fields:[{key:'restrictRoutes',label:'Routes suivantes sans capture (0 = aucune)',type:'number',default:0,min:0,max:5},{key:'nextTrainerLead',label:'Prochain combat de dresseur',type:'select',default:'no',options:[{value:'no',label:'Aucune obligation'},{value:'yes',label:'Ce Pokémon doit commencer le combat'}]},{key:'keepUntilBadge',label:'Obligation de garde',type:'select',default:'no',options:[{value:'no',label:'Aucune'},{value:'yes',label:'Garder jusqu’au prochain badge'}]},{key:'disposition',label:'Réception',type:'select',default:'append',options:[{value:'append',label:'Place libre'},{value:'replace',label:'Remplacer un Pokémon vivant au hasard'}]},{key:'speciesMode',label:'Espèce',type:'select',default:'random',options:[{value:'random',label:'Aléatoire (386 espèces)'},{value:'legendary',label:'Légendaire aléatoire'},{value:'fixed',label:'Espèce précise'},{value:'choice',label:'Le joueur choisit après le tirage'}]},{key:'speciesId',label:'Numéro du Pokédex (espèce précise)',type:'number',min:1,max:386,default:129},{key:'level',label:'Niveau (0 = moyenne de votre équipe)',type:'number',min:0,max:100,default:0},{key:'first',label:'Place dans l’équipe',type:'select',default:'no',options:[{value:'no',label:'Dernière place libre'},{value:'yes',label:'Première place'}]},{key:'temu',label:'Attaques et talent',type:'select',default:'no',options:[{value:'no',label:'Adaptés au Pokémon'},{value:'yes',label:'Complètement aléatoires'}]}],schema:z.object({restrictRoutes:z.number().int().min(0).max(5).default(0),nextTrainerLead:z.enum(['yes','no']).default('no'),keepUntilBadge:z.enum(['yes','no']).default('no'),disposition:z.enum(['append','replace']).default('append'),speciesMode:z.enum(['random','legendary','fixed','choice']),speciesId:z.number().int().min(1).max(386).default(129),level:z.number().int().min(0).max(100).default(0),first:z.enum(['yes','no']).default('no'),temu:z.enum(['yes','no']).default('no')}),plan:()=>{throw Error('Génération en cours');}},

 'pokemon.revive':{id:'pokemon.revive',label:'Pokémon · résurrection',description:'Rétablit les PV et retire le statut d’un Pokémon K.O. sélectionné. À utiliser après votre vote.',fields:[{key:'slot',label:'Emplacement du Pokémon K.O.',type:'number',min:1,max:6,default:1}],schema:z.object({slot:z.number().int().min(1).max(6)}),plan:(b,c)=>{const a=selectPlayer({mode:'fixed',playerId:c.spinnerId},c),before=bundle(a),mon=a.state.party.find(p=>p.slot===b.pokemonA.slot);if(!mon?.raw||mon.currentHp!==0)throw Error('Choisissez un Pokémon K.O.');const bytes=Buffer.from(mon.raw,'hex');bytes.writeUInt32LE(0,80);bytes.writeUInt16LE(mon.maxHp,86);const after={...before,party:[...before.party]};after.party[mon.slot-1]=bytes.toString('hex');return {summary:`Ressusciter ${mon.nickname||mon.speciesName}`,operations:[{playerId:a.playerId,slot:0,before:'',after:'',bundleBefore:before,bundleAfter:after,label:'Résurrection'}]};}},

 'pokemon.swap':{id:'pokemon.swap',label:'Échanger deux Pokémon',description:'Échange exact entre deux joueurs distincts.',fields,schema:pairSchema,plan:(b,c)=>pairPlan(b,c,true)},

 'pokemon.copy':{id:'pokemon.copy',label:'Remplacer par une copie',description:'Le Pokémon de A est remplacé par une copie de celui de B. Celui de B est conservé.',fields,schema:pairSchema,plan:(b,c)=>pairPlan(b,c,false)},

 'gag.pending':{id:'gag.pending',label:'Automatisation à compléter',description:'Ce gage du fichier est conservé dans le catalogue mais ne peut pas être tiré tant que son automatisation est incomplète.',fields:[{key:'reason',label:'Fonction manquante',type:'text'}],schema:z.object({reason:z.string().min(1).max(500)}),plan:b=>{throw Error(b.reason);}},
 'gag.notice':{id:'gag.notice',label:'Gage à réaliser entre amis',description:'Consigne affichée, sans modification du jeu.',fields:[{key:'text',label:'Consigne',type:'text'}],schema:z.object({text:z.string().trim().min(1).max(500)}),plan:b=>({summary:b.text,operations:[]})}

};

export function validateGag(gag:Gag|Omit<Gag,'id'>){if(gag.enabled&&gag.action==='gag.pending')throw Error('Ce gage attend encore son automatisation et ne peut pas être ajouté à la roue');const action=actionRegistry[gag.action];if(!action)throw new Error('Bloc action inconnu');return action.schema.parse(gag.blocks);}

export function planGag(gag:Gag,players:PublicPlayer[],spinnerId:string,random=(max:number)=>randomInt(max)){

 const blocks=validateGag(gag);const candidates=players.filter(p=>!p.connected||Date.now()-Date.parse(p.lastSeenAt)<15000);

 if(candidates.length!==players.length)throw new Error('État joueur trop ancien');

 return actionRegistry[gag.action].plan(blocks,{players:candidates,spinnerId,random});

}

export function weightedDraw(gags:Gag[],random=(max:number)=>randomInt(max)){

 const active=gags.filter(g=>g.enabled);const total=active.reduce((sum,g)=>sum+g.weight,0);

 if(!total)throw new Error('Activez au moins un gage');

 let ticket=random(total);for(const gag of active){ticket-=gag.weight;if(ticket<0)return gag;}throw new Error('Tirage invalide');

}



export async function planGagAsync(gag:Gag,players:PublicPlayer[],spinnerId:string){

 if(gag.action==='pokemon.steal'){
  const b=validateGag(gag),c={players,spinnerId,random:randomInt},a=selectPlayer({mode:'fixed',playerId:spinnerId},c),target=selectPlayer(b.playerB,c,spinnerId);
  let receiver=a,donor=target,mon=selectPokemon(target,b.pokemonB,c),reversed=false;
  if(b.risk==='coin'&&randomInt(2)===0){receiver=target;donor=a;mon=selectPokemon(a,{mode:'random'},c);reversed=true;}
  const beforeReceiver=bundle(receiver),beforeDonor=bundle(donor);if(beforeReceiver.party.length>=6)throw Error('Le destinataire doit libérer une place');
  const donorParty=[...beforeDonor.party];if(b.risk==='replace'){const lot=await generateLot([donor]);donorParty[mon.slot-1]=encodePokemon(lot.template);}else{if(donorParty.length<=1)throw Error('Le vol ne peut pas vider une équipe');donorParty.splice(mon.slot-1,1);}
  return {summary:`${reversed?'Braquage retourné ! ':''}${name(receiver)} récupère ${mon.nickname||mon.speciesName} de ${name(donor)}`,operations:[{playerId:donor.playerId,slot:0,before:'',after:'',label:`Retrait chez ${name(donor)}`,bundleBefore:beforeDonor,bundleAfter:{...beforeDonor,party:donorParty}},{playerId:receiver.playerId,slot:0,before:'',after:'',label:`Réception par ${name(receiver)}`,bundleBefore:beforeReceiver,bundleAfter:{...beforeReceiver,party:[...beforeReceiver.party,mon.raw!]}}]};
 }
 if(gag.action!=='pokemon.grant')return planGag(gag,players,spinnerId);

 const b=validateGag(gag),a=selectPlayer({mode:'fixed',playerId:spinnerId},{players,spinnerId,random:randomInt}),before=bundle(a);

 if((b.nextTrainerLead==='yes'||b.restrictRoutes>0)&&!a.state.events)throw Error('Relancez le client pour détecter les combats de dresseur');
 if(b.disposition!=='replace'&&before.party.length>=6)throw Error('Libérez une place dans votre équipe');

 const legends=[144,145,146,150,151,243,244,245,249,250,251,377,378,379,380,381,382,383,384,385,386];

 const speciesId=b.speciesMode==='fixed'?b.speciesId:b.speciesMode==='legendary'?legends[randomInt(legends.length)]:undefined;

 const lot=await generateLot([a],randomInt,undefined,{speciesId,level:b.level||undefined});

 if(b.temu==='yes'){

  const moves=Array.from({length:4},()=>randomInt(1,355));

  lot.template.moves=await Promise.all(moves.map(async id=>{const response=await fetch(`https://pokeapi.co/api/v2/move/${id}/`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Attaques indisponibles');return {id,pp:emeraldPP(await response.json())};}));

  const response=await fetch(`https://pokeapi.co/api/v2/pokemon/${lot.speciesId}/`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Talent indisponible');const info=await response.json() as {abilities:{is_hidden:boolean;slot:number}[]};lot.template.abilitySlot=info.abilities.some(a=>!a.is_hidden&&a.slot===2)?randomInt(2):0;

 }

 const raw=encodePokemon(lot.template),after={...before,party:b.first==='yes'||b.nextTrainerLead==='yes'?[raw,...before.party]:[...before.party,raw]};if(b.disposition==='replace'){const mon=selectPokemon(a,{mode:'random'},{players,spinnerId,random:randomInt});after.party=[...before.party];after.party[mon.slot-1]=raw;if(b.first==='yes'||b.nextTrainerLead==='yes'){after.party.splice(mon.slot-1,1);after.party.unshift(raw);}}

 return {effects:[...(b.restrictRoutes>0?[{kind:'noCapture' as const,routeCount:b.restrictRoutes}]:[]),...(b.nextTrainerLead==='yes'?[{kind:'lead' as const,identity:raw.slice(0,16)}]:[]),...(b.keepUntilBadge==='yes'?[{kind:'keep' as const,identity:raw.slice(0,16),discord:false}]:[])],summary:`Recevoir ${lot.name} niveau ${lot.level}${b.first==='yes'?' en première place':''}`,operations:[{playerId:a.playerId,slot:0,before:'',after:'',bundleBefore:before,bundleAfter:after,label:`Ajout ${lot.name}`}]};

}

