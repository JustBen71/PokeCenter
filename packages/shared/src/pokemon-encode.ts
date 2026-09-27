import type {PokemonInjection} from './index.js';
import {speciesInternal} from './species-internal.js';
import {decodePokemonCopy} from './pokemon-copy.js';
export function encodePokemon(p:PokemonInjection){
 const b=new Uint8Array(100),v=new DataView(b.buffer),w16=(o:number,n:number)=>v.setUint16(o,n,true),w32=(o:number,n:number)=>v.setUint32(o,n>>>0,true);
 const ot=((p.secretId<<16)|p.trainerId)>>>0;let pid=0;
 for(let high=0;high<65536;high++){const low=p.shiny?(p.trainerId^p.secretId^high)&65535:(high*109+31337)&65535;const candidate=((high<<16)|low)>>>0,shiny=((ot&65535)^(ot>>>16)^high^low)<8;if(candidate%25===p.nature&&shiny===p.shiny){pid=candidate;break;}}
 const text=(offset:number,s:string,len:number)=>{s=s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();for(let i=0;i<len;i++){const c=s[i];b[offset+i]=c===undefined?255:c>='A'&&c<='Z'?187+c.charCodeAt(0)-65:c>='0'&&c<='9'?161+c.charCodeAt(0)-48:c===' '?0:c==='-'?174:172;}};
 w32(0,pid);w32(4,ot);text(8,p.nickname,10);b[18]=3;b[19]=2;text(20,p.otName,7);
 const blocks={G:new Uint8Array(12),A:new Uint8Array(12),E:new Uint8Array(12),M:new Uint8Array(12)};
 const g=new DataView(blocks.G.buffer),a=new DataView(blocks.A.buffer),m=new DataView(blocks.M.buffer);
 g.setUint16(0,speciesInternal[p.speciesId],true);g.setUint16(2,p.heldItem,true);g.setUint32(4,p.experience,true);blocks.G[9]=p.friendship;
 p.moves.forEach((move,i)=>{a.setUint16(i*2,move.id,true);blocks.A[8+i]=move.pp;});
 const keys=['hp','attack','defense','speed','spAttack','spDefense'] as const;let ivs=p.abilitySlot<<31;keys.forEach((k,i)=>{ivs|=p.ivs[k]<<(i*5);blocks.E[i]=p.evs[k];});m.setUint32(4,ivs>>>0,true);
 const orders=['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'];let sum=0;
 [...orders[pid%24]].forEach((key,i)=>{const view=new DataView(blocks[key as keyof typeof blocks].buffer);for(let j=0;j<3;j++){const n=view.getUint32(j*4,true);sum=(sum+(n&65535)+(n>>>16))&65535;w32(32+i*12+j*4,n^pid^ot);}});w16(28,sum);
 b[84]=p.level;b[85]=255;[p.currentHp,p.stats.maxHp,p.stats.attack,p.stats.defense,p.stats.speed,p.stats.spAttack,p.stats.spDefense].forEach((n,i)=>w16(86+i*2,n));
 const raw=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');decodePokemonCopy(raw);return raw;
}
