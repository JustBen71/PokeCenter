import {randomUUID} from 'node:crypto';
import {io as connect,type Socket} from 'socket.io-client';
import {decodePokemonCopy,encodePokemon,type GameEventKind,type NativeGameState,type PokemonInjection} from '@pokerace/shared';

export type FakeMode='apply'|'timeout'|'ack-lost'|{refuse:string};
type Command={commandId:string;command:string;payload:Record<string,any>};
type ConnectOptions={base:string;lobbyId:string;inviteCode:string;playerName:string;playerId?:string;money?:number;party?:string[];writes?:boolean;location?:{mapGroup:number;mapNumber:number;label:string};heartbeatMs?:number;
 // Game-event capabilities announced by this fake adapter (none by default, like the real Gen III adapter).
 events?:string[];
 // Commanded battles (battle.trainer.start), as the Gen III adapter with a battle profile.
 battles?:boolean;
 // End of Run in the game: PLAYER_DEFEATED events, fainted Pokémon to the PC box, game reset (Gen III defeat profile).
 defeats?:boolean};

export const template=(speciesId=1,level=5,nickname='TEST'):PokemonInjection=>({playerId:'fake',slot:1,speciesId,nickname,level,experience:135,currentHp:20,
 stats:{maxHp:20,attack:10,defense:10,speed:10,spAttack:10,spDefense:10},moves:[{id:33,pp:35},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],heldItem:0,abilitySlot:0,nature:3,friendship:70,
 otName:'FAKE',trainerId:1,secretId:2,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},shiny:false});
export const rawPokemon=(speciesId=1,level=5,nickname='TEST')=>encodePokemon(template(speciesId,level,nickname));

const READ=['trainer.read','money.read','party.read','location.read','progression.read'] as const;
const WRITE=['money.write','party.write','pokemon.insert','pokemon.remove','pokemon.replace','items.write'] as const;

/**
 * Simulated Pokerace.Client + BizHawk: speaks the real /client protocol, keeps money and party,
 * and answers game commands by applying them, refusing, timing out or losing the acknowledgement.
 */
export class FakeGameClient{
 mode:FakeMode='apply';
 readonly received:Command[]=[];
 money:number;party:string[];completed:string[]=['starter'];
 // Commanded battle state published in GAME_STATE (Gen III: overworld, no script, controls free = safe).
 safe=true;battle:{active:string|null;state:'STARTING'|'RUNNING'|null;last:{encounterId:string;outcome:string}|null;spec:Record<string,any>|null}={active:null,state:null,last:null,spec:null};
 location:{mapGroup:number;mapNumber:number;label:string};
 private constructor(private readonly socket:Socket,private readonly options:ConnectOptions,money:number,party:string[]){
  this.money=money;this.party=party;this.location=options.location??{mapGroup:0,mapNumber:9,label:'Bourg-en-Vol'};
  socket.on('COMMAND',(command:Command)=>this.handle(command));
  // Like Pokerace.Client: periodic heartbeats keep the observation fresh for long (browser) scenarios.
  if(options.heartbeatMs){const timer=setInterval(()=>socket.emit('HEARTBEAT',{type:'HEARTBEAT',protocolVersion:1,clientVersion:'fake',bridgeConnected:true,system:'GBA'}),options.heartbeatMs);timer.unref();socket.on('disconnect',()=>clearInterval(timer));}
 }
 private get writes(){return this.options.writes??true;}

 static async connect(options:ConnectOptions){
  const playerId=options.playerId??`fake-${options.playerName.toLowerCase()}`;
  const socket=connect(`${options.base}/client`,{path:`/rooms/${options.lobbyId}/socket.io`,transports:['websocket'],reconnection:false,
   auth:{protocolVersion:1,playerId,playerName:options.playerName,roomCode:options.inviteCode}});
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  const client=new FakeGameClient(socket,options,options.money??12500,options.party??[rawPokemon()]);
  const bridge={type:'bizhawk' as const,connected:true,protocolVersion:1 as const,gameLoaded:true};
  socket.emit('HELLO',{type:'HELLO',protocolVersion:1,clientVersion:'fake',playerId,platform:'test',bridge,emulator:{name:'BizHawk'},system:'GBA'});
  socket.emit('CLIENT_STATUS',{type:'CLIENT_STATUS',protocolVersion:1,connected:true,allowMemoryWrites:false,canPurchase:true});
  client.publish();
  return client;
 }

 state():NativeGameState{
  const capabilities=[...READ,...(this.writes?WRITE:[]),...(this.options.events??[]),...(this.options.battles&&this.writes?['battle.trainer.start']:[]),
   ...(this.options.defeats&&this.writes?['events.player_defeated','party.box_fainted','game.reset']:[])];
  const adapter={id:'pokemon.emerald.gen3',status:'ready' as const,profileId:'emerald-fr-bpef-v0',capabilities};
  return {gameStateVersion:2,adapter,game:{family:'pokemon',generation:3,title:'emerald',language:'fr',revision:'BPEF v0'},
   trainer:{name:'FAKE',money:this.money,playTimeSeconds:60,partyCount:this.party.length},location:{...this.location},
   party:this.party.map((raw,i)=>{const p=decodePokemonCopy(raw);
    return {artifact:{format:'gen3-party-v1',raw},slot:i+1,speciesId:1,speciesName:'Bulbizarre',nickname:p.nickname||null,level:p.level,currentHp:p.currentHp,maxHp:p.stats.maxHp,shiny:false};}),
   progression:{version:1,completed:this.completed},capabilities,observedAt:new Date().toISOString(),
   ...((this.options.battles||this.options.defeats)&&this.writes?{battle:{safe:this.safe&&!this.battle.active,inBattle:this.battle.state==='RUNNING',activeEncounterId:this.battle.active,last:this.battle.last}}:{})};
 }
 publish(){const state=this.state();this.socket.emit('GAME_STATE',{type:'GAME_STATE',protocolVersion:1,gameStateVersion:2,adapter:state.adapter,state});}
 /** The client could not read the game this time (save blocks moving at the end of a battle…). */
 unreadable(){this.socket.emit('GAME_STATE',{type:'GAME_STATE',protocolVersion:1,gameStateVersion:2,adapter:{id:'pokemon.emerald.gen3',status:'read_error',profileId:'emerald-fr-bpef-v0',capabilities:[]},state:null});}
 close(){this.socket.close();}
 /** Sends one GAME_EVENT and resolves with the server ACK (or null after the timeout, like a lost ACK). */
 gameEvent(kind:GameEventKind,data:Record<string,unknown>,eventId:string=randomUUID(),timeoutMs=1500):Promise<{eventId:string;ok:boolean;error?:{code:string}}|null>{
  return new Promise(resolve=>{
   const timer=setTimeout(()=>{this.socket.off('GAME_EVENT_ACK',on);resolve(null);},timeoutMs);
   const on=(ack:{eventId:string;ok:boolean;error?:{code:string}})=>{if(ack.eventId!==eventId)return;clearTimeout(timer);this.socket.off('GAME_EVENT_ACK',on);resolve(ack);};
   this.socket.on('GAME_EVENT_ACK',on);
   this.socket.emit('GAME_EVENT',{type:'GAME_EVENT',protocolVersion:1,eventVersion:1,eventId,kind,observedAt:new Date().toISOString(),data});
  });
 }
 /** The battle screen appeared (the game took the script). */
 battleStarted(){this.battle={...this.battle,state:'RUNNING'};this.publish();}
 /** Back on the overworld: the result is published and the temporary data restored. */
 endBattle(outcome:'WIN'|'LOSS'|'DRAW'|'ABORTED'|'UNKNOWN'){this.battle={active:null,state:null,last:{encounterId:this.battle.active!,outcome},spec:this.battle.spec};this.publish();}
 setSafe(safe:boolean){this.safe=safe;this.publish();}
 /** A new observation with different content (the player moved), as the real client keeps sending. */
 step(){this.location={...this.location,mapNumber:this.location.mapNumber+1};this.publish();}
 trainerVictory(baseReward:number,eventId?:string){const before=this.money;this.money+=baseReward;this.publish();return this.gameEvent('TRAINER_VICTORY',{moneyBefore:before,moneyAfter:this.money,baseReward},eventId);}
 setSteps(absolute:number,eventId?:string){return this.gameEvent('STEPS_CHANGED',{absolute},eventId);}
 pokemonFainted(slot:number,speciesId:number,eventId?:string){return this.gameEvent('POKEMON_FAINTED',{slot,speciesId},eventId);}
 battleEnded(outcome:'WIN'|'LOSS'|'FLEE'|'OTHER',conscious:number,eventId?:string){return this.gameEvent('BATTLE_ENDED',{outcome,conscious},eventId);}
 defeated(cause:'WHITE_OUT'|'BATTLE_LOST'|'PARTY_FAINTED'='WHITE_OUT',eventId?:string){return this.gameEvent('PLAYER_DEFEATED',{cause},eventId);}
 /** A party member drops to 0 HP (the game state is published, as the client's next observation). */
 faint(slot:number){this.party[slot-1]=encodePokemon({...template(1,5,decodePokemonCopy(this.party[slot-1]!).nickname||'TEST'),currentHp:0});this.publish();}
 /** PC box (BoxPokemon copies) and number of game resets, as seen by the fake game. */
 box:string[]=[];resets=0;
 /** Bag: item id → quantity (no pockets: the real limits are the client's). */
 bag=new Map<number,number>();
 /** Disconnects, then connects again as the same installation with the same game (money, party). */
 async reconnect(){
  this.close();
  const next=await FakeGameClient.connect({...this.options,money:this.money,party:[...this.party],location:this.location});
  // The battle state survives like the client's battle-encounters.json.
  next.battle=this.battle;next.safe=this.safe;next.publish();return next;
 }

 private ack(command:Command,ok:boolean,body:Record<string,unknown>){this.socket.emit('COMMAND_ACK',{type:'COMMAND_ACK',protocolVersion:1,commandId:command.commandId,ok,...body});}
 private handle(command:Command){
  this.received.push(command);
  if(this.mode==='timeout')return;
  if(typeof this.mode==='object')return this.ack(command,false,{error:{code:this.mode.refuse}});
  const p=command.payload;
  // Same preconditions as the real adapter: the observed state must still match.
  if('expectedMoney' in p&&p.expectedMoney!==this.money||'expectedCount' in p&&p.expectedCount!==this.party.length)return this.ack(command,false,{error:{code:'state_changed'}});
  switch(command.command){
   case 'game.money.add':this.money+=p.amount;break;
   case 'game.money.remove':if(this.money<p.amount)return this.ack(command,false,{error:{code:'insufficient_money'}});this.money-=p.amount;break;
   case 'game.money.set':this.money=p.value;break;
   case 'game.pokemon.insert':this.party.push(p.raw);break;
   case 'game.pokemon.remove':this.party.splice(p.slot-1,1);break;
   case 'game.pokemon.replace':this.party[p.slot-1]=p.raw;break;
   case 'game.battle.start':{
    // Same rules as Gen3BattleEncounter: an encounter is started once; unsafe or busy games refuse without writing.
    if(this.battle.last?.encounterId===p.encounterId)return this.ack(command,true,{result:{state:'ENDED',outcome:this.battle.last.outcome}});
    if(this.battle.active)return this.battle.active===p.encounterId?this.ack(command,true,{result:{state:this.battle.state}}):this.ack(command,false,{error:{code:'battle_busy'}});
    if(!this.safe)return this.ack(command,false,{error:{code:'not_safe'}});
    this.battle={active:p.encounterId,state:'STARTING',last:this.battle.last,spec:p};
    if(this.mode==='ack-lost')return;
    return this.ack(command,true,{result:{state:'STARTING'}});
   }
   case 'game.party.box_fainted':{
    // Same rules as Gen3Defeat: overworld only, never the whole party; moved members leave the party.
    if(!this.safe)return this.ack(command,false,{error:{code:'not_safe'}});
    const fainted=this.party.map((raw,i)=>({raw,slot:i+1,p:decodePokemonCopy(raw)})).filter(m=>m.p.currentHp===0);
    if(fainted.length===this.party.length)return this.ack(command,false,{error:{code:'party_fainted'}});
    const moved=fainted.map(m=>{this.box.push(m.raw);return {slot:m.slot,speciesId:1,speciesName:'Bulbizarre',nickname:m.p.nickname||null,level:m.p.level,box:1,place:this.box.length};});
    this.party=this.party.filter((_,i)=>!fainted.some(m=>m.slot===i+1));
    this.publish();
    return this.ack(command,true,{result:{moved,partyCount:this.party.length}});
   }
   case 'game.item.add':this.bag.set(p.itemId,(this.bag.get(p.itemId)??0)+1);return this.ack(command,true,{result:{itemId:p.itemId,quantity:this.bag.get(p.itemId)}});
   case 'game.item.take_random':{
    const ids=[...this.bag.keys()];if(!ids.length)return this.ack(command,false,{error:{code:'bag_empty'}});
    const id=ids[Math.floor(Math.random()*ids.length)]!,left=this.bag.get(id)!-1;if(left)this.bag.set(id,left);else this.bag.delete(id);
    return this.ack(command,true,{result:{itemId:id,quantity:left}});
   }
   case 'game.reset':this.resets++;this.party=[rawPokemon()];this.publish();return this.ack(command,true,{result:{archive:`lost-${this.resets}`}});
   case 'pokemon.purchase':if(this.party.length>=6)return this.ack(command,false,{error:{code:'party_full'}});this.money-=p.price;this.party.push(p.raw);break;
  }
  this.publish();
  if(this.mode==='ack-lost')return;
  this.ack(command,true,{result:{verified:true,money:this.money,partyCount:this.party.length}});
 }
}

export const until=async(check:()=>boolean,message='condition')=>{
 for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}
 throw new Error(`Timed out waiting for ${message}`);
};
