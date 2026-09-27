import {pokemonNames} from './roulette-species.js';
import {selectPlayer} from './roulette-engine.js';

import {randomInt} from 'node:crypto';

import type {Gag,PublicPlayer,RouletteRun} from '@pokerace/shared';

export function resolveChoices(run:RouletteRun,players:PublicPlayer[]):Gag|undefined{

 const gag=structuredClone(run.gag!);run.choices??={};
 if(gag.action==='pokemon.people'){
  const actors=players.filter(p=>p.connected&&p.playerId!==run.spinnerId&&p.state.game.romStatus==='recognized').map(p=>p.playerId);if(!actors.length)throw Error('Aucun autre joueur pour proposer une espèce');
  for(let i=0;i<3;i++){const key=`proposal${i}`;if(!run.choices[key]){run.pending={key,label:`Proposition ${i+1} / 3 : votez pour une espèce`,actors,votes:{},options:Object.entries(pokemonNames).filter(([id])=>![0,1,2].some(n=>run.choices![`proposal${n}`]===id)).map(([value,label])=>({value,label}))};run.summary=run.pending.label;return;}}
  run.choices.selectedSpecies??=run.choices[`proposal${randomInt(3)}`];gag.action='pokemon.grant';gag.blocks={speciesMode:'fixed',speciesId:Number(run.choices.selectedSpecies),keepUntilBadge:'yes',level:0,first:'no',temu:'no'};
 }
 if(gag.action==='pokemon.dilemma'){
  const envelope=run.choices.envelope;
  if(!envelope){run.pending={key:'envelope',label:'Choisir une enveloppe',actors:[run.spinnerId!],votes:{},options:[{value:'A',label:'A · Légendaire contre un Pokémon de votre équipe au hasard'},{value:'B',label:'B · Le meilleur Pokémon d’un joueur contre celui qu’il choisira chez vous'}]};run.summary=run.pending.label;return;}
  if(envelope==='A'){gag.action='pokemon.grant';gag.blocks={speciesMode:'legendary',disposition:'replace',pokemonA:{mode:'random'},level:0,first:'no',temu:'no'};}
  else{gag.action='pokemon.swap';gag.blocks={playerB:{mode:'choice'},pokemonA:{mode:'choice',by:'target'},pokemonB:{mode:'highest'}};}
 }
 if(gag.action==='pokemon.grant'&&gag.blocks.speciesMode==='choice'){
  if(!run.choices.species){run.pending={key:'species',label:'Choisir votre espèce',actors:[run.spinnerId!],votes:{},options:Object.entries(pokemonNames).map(([value,label])=>({value,label}))};run.summary=run.pending.label;return;}
  gag.blocks.speciesMode='fixed';gag.blocks.speciesId=Number(run.choices.species);
 }


 const active=players.filter(p=>p.connected&&p.state.game.romStatus==='recognized');

 const selector=gag.blocks.playerB as {mode?:string}|undefined;

 if(selector&&selector.mode!=='choice'&&(['pokemonA','pokemonB'].some(k=>{const b=gag.blocks[k] as {mode?:string;by?:string}|undefined;return b?.mode==='choice'&&(k==='pokemonB'||b.by==='target');}))){

  const id=run.choices.resolvedPlayerB??selectPlayer(selector as any,{players,spinnerId:run.spinnerId!,random:randomInt},run.spinnerId).playerId;run.choices.resolvedPlayerB=id;gag.blocks.playerB={mode:'fixed',playerId:id};

 }

 for(const key of ['playerB','pokemonA','pokemonB']){

  const block=gag.blocks[key] as {mode?:string;playerId?:string;by?:string}|undefined;if(block?.mode!=='choice')continue;

  const target=key==='pokemonB'?(gag.blocks.playerB as {playerId?:string})?.playerId:run.spinnerId;

  const owner=players.find(p=>p.playerId===target);

  const options=key==='playerB'?active.filter(p=>p.playerId!==run.spinnerId).map(p=>({value:p.playerId,label:p.state.playerName??p.playerId})):owner?.state.party.filter(p=>p.raw&&(gag.action==='pokemon.revive'?p.currentHp===0:p.currentHp>0)).map(p=>({value:`${p.slot}-${p.raw!.slice(0,16)}`,label:`${p.nickname||p.speciesName} · niveau ${p.level} · place ${p.slot}`}))??[];

  const chosen=run.choices[key];

  if(chosen){if(!options.some(o=>o.value===chosen))throw Error('Le choix ne correspond plus à la partie actuelle');gag.blocks[key]=key==='playerB'?{mode:'fixed',playerId:chosen}:{mode:'slot',slot:Number(chosen.split('-')[0])};continue;}

  const actors=block.by==='vote'?active.filter(p=>p.playerId!==run.spinnerId).map(p=>p.playerId):[block.by==='target'?(gag.blocks.playerB as {playerId:string}).playerId:run.spinnerId!];

  if(!options.length||!actors.length||actors.some(id=>!active.some(p=>p.playerId===id)))throw Error('Aucun choix ou votant disponible');

  run.pending={key,label:key==='playerB'?'Choisir le joueur cible':`${block.by==='vote'?'Vote : ':''}choisir le Pokémon ${key==='pokemonA'?'de A':'de B'}`,options,actors,votes:{}};

  run.summary=run.pending.label;return;

 }

 delete run.pending;return gag;

}

export function recordChoice(run:RouletteRun,actor:string,value:string){

 const pending=run.pending;if(!pending||!pending.actors.includes(actor)||!pending.options.some(o=>o.value===value))throw Error('Choix non autorisé');

 if(pending.votes[actor]&&pending.votes[actor]!==value)throw Error('Votre vote a déjà été enregistré');pending.votes[actor]=value;

 if(pending.actors.every(id=>pending.votes[id])){

  const counts=new Map<string,number>();Object.values(pending.votes).forEach(v=>counts.set(v,(counts.get(v)??0)+1));const max=Math.max(...counts.values()),ties=[...counts].filter(([,n])=>n===max).map(([v])=>v);

  run.choices??={};run.choices[pending.key]=ties[randomInt(ties.length)];delete run.pending;return true;

 }return false;

}

