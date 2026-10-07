import {calculateStats,type PokemonData} from './pokemon-builder.js';
import {decodePokemonCopy} from './pokemon-copy.js';
import {encodePokemon} from './pokemon-encode.js';
import type {PokemonInjection} from './index.js';

const ORDERS=['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'];
const hex=(b:Uint8Array)=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');

type Blocks={plain:DataView;G:number;A:number;E:number;M:number;bytes:Uint8Array;view:DataView};
/**
 * Edits the exact copy of a party Pokémon: the encrypted substructures are decrypted, changed, re-checksummed and
 * re-encrypted. `edit` may return a new personality (nature change): the substructures are then reordered and
 * encrypted with the new key. Everything else (OT, nickname, ribbons, markings…) stays as it is.
 */
function rewrite(raw:string,edit:(b:Blocks)=>number|void):string{
 const bytes=Uint8Array.from(raw.match(/../g)!,v=>parseInt(v,16)),view=new DataView(bytes.buffer);
 const pid=view.getUint32(0,true),ot=view.getUint32(4,true);
 const plain=new DataView(new ArrayBuffer(48));
 for(let i=0;i<12;i++)plain.setUint32(i*4,(view.getUint32(32+i*4,true)^pid^ot)>>>0,true);
 const at=(p:number,c:string)=>ORDERS[p%24]!.indexOf(c)*12;
 const next=edit({plain,G:at(pid,'G'),A:at(pid,'A'),E:at(pid,'E'),M:at(pid,'M'),bytes,view})??pid;
 const out=new DataView(new ArrayBuffer(48));
 for(const c of 'GAEM')for(let i=0;i<12;i++)out.setUint8(at(next,c)+i,plain.getUint8(at(pid,c)+i));
 let sum=0;for(let i=0;i<24;i++)sum=(sum+out.getUint16(i*2,true))&0xFFFF;
 view.setUint32(0,next,true);view.setUint16(28,sum,true);
 // `edit` may also change the trainer (withTrainer): encrypt with the key as it is now.
 const key=(next^view.getUint32(4,true))>>>0;
 for(let i=0;i<12;i++)view.setUint32(32+i*4,(out.getUint32(i*4,true)^key)>>>0,true);
 const result=hex(bytes);decodePokemonCopy(result);// must still be a valid copy
 return result;
}
const setStats=(view:DataView,s:PokemonInjection['stats'])=>{
 const oldHp=view.getUint16(86,true),oldMax=view.getUint16(88,true);
 [s.maxHp,s.attack,s.defense,s.speed,s.spAttack,s.spDefense].forEach((v,i)=>view.setUint16(88+i*2,v,true));
 view.setUint16(86,oldHp===0?0:Math.max(1,Math.min(s.maxHp,Math.round(oldHp*s.maxHp/oldMax))),true);
};

/**
 * Same Pokémon at another level: only the experience (encrypted growth block, checksum updated), the level byte and
 * the party stats change. Personality, OT, nickname, moves, IVs/EVs, item and ribbons stay as they are; HP keep their
 * ratio (a fainted Pokémon stays fainted).
 */
export function withLevel(raw:string,change:{level:number;experience:number;stats:PokemonInjection['stats']}):string{
 return rewrite(raw,({plain,G,bytes,view})=>{plain.setUint32(G+4,change.experience,true);bytes[84]=change.level;setStats(view,change.stats);});
}

/** Current HP set (0 < hp ≤ max) and, when asked, the status condition cleared (sleep, poison…). Not encrypted. */
export function withHp(raw:string,hp:number,options:{clearStatus?:boolean}={}):string{
 return rewrite(raw,({view})=>{view.setUint16(86,Math.max(0,Math.min(view.getUint16(88,true),hp)),true);if(options.clearStatus)view.setUint32(80,0,true);});
}

/**
 * New nature (personality % 25). Only the high half of the personality changes: gender and Unown letter (low byte),
 * shininess and the Wurmple branch are kept. Stats are recomputed by the caller (nature multipliers).
 */
export function withNature(raw:string,nature:number,stats:PokemonInjection['stats']):string{
 return rewrite(raw,({view})=>{
  const pid=view.getUint32(0,true),ot=view.getUint32(4,true),lo=pid&0xFFFF,hi=pid>>>16;
  const shiny=(h:number)=>((ot&0xFFFF)^(ot>>>16)^h^lo)<8;
  for(let h=0;h<0x10000;h++){
   const candidate=((h<<16)|lo)>>>0;
   if(candidate%25===nature&&shiny(h)===shiny(hi)&&(h%10<5)===(hi%10<5)){setStats(view,stats);return candidate;}
  }
  throw new Error('Aucune personnalité possible pour cette nature');
 });
}

/**
 * Same Pokémon, original trainer of `trainerRaw` (ID, secret ID, OT name): the game no longer sees it as traded,
 * so it obeys whatever the badges. Everything else stays; shininess may change (it depends on the trainer ID).
 */
export function withTrainer(raw:string,trainerRaw:string):string{
 const from=Uint8Array.from(trainerRaw.match(/../g)!,v=>parseInt(v,16));
 return rewrite(raw,({bytes})=>{bytes.set(from.subarray(4,8),4);bytes.set(from.subarray(20,27),20);});
}

const ivNames=['hp','attack','defense','speed','spAttack','spDefense'] as const;
/** One IV set (0–31), stats recomputed by the caller. */
export function withIv(raw:string,stat:typeof ivNames[number],value:number,stats:PokemonInjection['stats']):string{
 return rewrite(raw,({plain,M,view})=>{
  const shift=ivNames.indexOf(stat)*5,word=plain.getUint32(M+4,true);
  plain.setUint32(M+4,((word&~(31<<shift))|(Math.max(0,Math.min(31,value))<<shift))>>>0,true);setStats(view,stats);
 });
}

/** Move `index` (0–3) replaced, full PP of the new move, its PP Up bonus cleared. */
export function withMove(raw:string,index:number,moveId:number,pp:number):string{
 return rewrite(raw,({plain,A,G})=>{
  plain.setUint16(A+index*2,moveId,true);plain.setUint8(A+8+index,pp);
  plain.setUint8(G+8,plain.getUint8(G+8)&~(3<<(index*2)));
 });
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
