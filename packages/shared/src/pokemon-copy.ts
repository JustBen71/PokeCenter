import {characters} from "./pokemon-characters.js";
// Gen III party structure: preserve the complete 100 bytes, including PID, origin,
// PP bonuses, ribbons, language, status and encrypted substructures.
export function decodePokemonCopy(raw:string) {
 if(!/^[a-f0-9]{200}$/.test(raw))throw new Error('Copie Pokémon invalide');
 const bytes=Uint8Array.from(raw.match(/../g)!,v=>parseInt(v,16));
 const view=new DataView(bytes.buffer);
 const u16=(offset:number)=>view.getUint16(offset,true),u32=(offset:number)=>view.getUint32(offset,true);
 const text=(offset:number,length:number)=>{let result="";for(let i=0;i<length&&bytes[offset+i]!==255;i++)result+=characters[String(bytes[offset+i])]??"?";return result;};
 const personality=u32(0),ot=u32(4),key=personality^ot;
 const orders=['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'];
 const decoded=new DataView(new ArrayBuffer(48));let checksum=0;
 for(let i=0;i<12;i++){const w=(u32(32+i*4)^key)>>>0;decoded.setUint32(i*4,w,true);checksum=(checksum+(w&65535)+(w>>>16))&65535;}
 if(checksum!==u16(28))throw new Error('Checksum Pokémon invalide');
 const order=orders[personality%24],g=order.indexOf('G')*12,a=order.indexOf('A')*12,e=order.indexOf('E')*12,m=order.indexOf('M')*12;
 const internalSpecies=decoded.getUint16(g,true);
 if(internalSpecies<1 || internalSpecies>411 || (internalSpecies>251&&internalSpecies<277) || bytes[84]<1||bytes[84]>100||u16(88)<1||u16(88)>999||u16(86)>u16(88))throw new Error('Copie Pokémon incohérente');
 const ivWord=decoded.getUint32(m+4,true),names=['hp','attack','defense','speed','spAttack','spDefense'];
 return {personality,internalSpecies,nickname:text(8,10),otName:text(20,7),level:bytes[84],experience:decoded.getUint32(g+4,true),currentHp:u16(86),
 stats:{maxHp:u16(88),attack:u16(90),defense:u16(92),speed:u16(94),spAttack:u16(96),spDefense:u16(98)},
 moves:Array.from({length:4},(_,i)=>({id:decoded.getUint16(a+i*2,true),pp:decoded.getUint8(a+8+i)})),
 ivs:Object.fromEntries(names.map((name,i)=>[name,(ivWord>>>(i*5))&31])),evs:Object.fromEntries(names.map((name,i)=>[name,decoded.getUint8(e+i)])),
 nature:personality%25,heldItem:decoded.getUint16(g+2,true),friendship:decoded.getUint8(g+9),abilitySlot:ivWord>>>31,
 trainerId:ot&65535,secretId:ot>>>16,language:bytes[18],status:u32(80),ppBonuses:decoded.getUint8(g+8),
 shiny:((ot&65535)^(ot>>>16)^(personality&65535)^(personality>>>16))<8};
}
