import {calculateStats,type PokemonData} from './pokemon-builder.js';
import {decodePokemonCopy} from './pokemon-copy.js';
import {encodePokemon} from './pokemon-encode.js';
import type {PokemonInjection} from './index.js';

const ORDERS=['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'];
const hex=(b:Uint8Array)=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');

/**
 * Same Pokémon at another level: only the experience (encrypted growth block, checksum updated), the level byte and
 * the party stats change. Personality, OT, nickname, moves, IVs/EVs, item and ribbons stay as they are; HP keep their
 * ratio (a fainted Pokémon stays fainted).
 */
export function withLevel(raw:string,change:{level:number;experience:number;stats:PokemonInjection['stats']}):string{
 const bytes=Uint8Array.from(raw.match(/../g)!,v=>parseInt(v,16)),view=new DataView(bytes.buffer);
 const pid=view.getUint32(0,true),key=(pid^view.getUint32(4,true))>>>0;
 const plain=new DataView(new ArrayBuffer(48));
 for(let i=0;i<12;i++)plain.setUint32(i*4,(view.getUint32(32+i*4,true)^key)>>>0,true);
 plain.setUint32(ORDERS[pid%24]!.indexOf('G')*12+4,change.experience,true);
 let sum=0;for(let i=0;i<24;i++)sum=(sum+plain.getUint16(i*2,true))&0xFFFF;
 view.setUint16(28,sum,true);
 for(let i=0;i<12;i++)view.setUint32(32+i*4,(plain.getUint32(i*4,true)^key)>>>0,true);
 const oldHp=view.getUint16(86,true),oldMax=view.getUint16(88,true),s=change.stats;
 bytes[84]=change.level;
 [s.maxHp,s.attack,s.defense,s.speed,s.spAttack,s.spDefense].forEach((v,i)=>view.setUint16(88+i*2,v,true));
 view.setUint16(86,oldHp===0?0:Math.max(1,Math.min(s.maxHp,Math.round(oldHp*s.maxHp/oldMax))),true);
 const out=hex(bytes);decodePokemonCopy(out);// must still be a valid copy
 return out;
}

// Magikarp (Gen III base stats HP 20, Atk 10, Def 55, Vit 80, Atk Spé 15, Déf Spé 20), level 1, only Trempette.
const magikarp:PokemonData={stats:[['hp',20],['attack',10],['defense',55],['speed',80],['special-attack',15],['special-defense',20]]
 .map(([name,base])=>({base_stat:base as number,stat:{name:name as string,url:''}})),past_stats:[],moves:[]};
/** Malédiction du Magicarpe: a level 1 Magikarp with the same trainer (it obeys) and the same IVs; a new Pokémon otherwise. */
export function magikarpFrom(raw:string):string{
 const p=decodePokemonCopy(raw);
 const ivs=p.ivs as PokemonInjection['ivs'],evs={hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0};
 const stats=calculateStats(magikarp,{speciesId:129,level:1,nature:p.nature,ivs,evs});
 return encodePokemon({playerId:'wheel',slot:1,speciesId:129,nickname:'MAGICARPE',level:1,experience:0,currentHp:stats.maxHp,stats,
  moves:[{id:150,pp:40},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],heldItem:0,abilitySlot:0,nature:p.nature,friendship:70,
  otName:p.otName,trainerId:p.trainerId,secretId:p.secretId,ivs,evs,shiny:false});
}
