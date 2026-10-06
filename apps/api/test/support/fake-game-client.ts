import {io as connect,type Socket} from 'socket.io-client';
import {decodePokemonCopy,encodePokemon,type NativeGameState,type PokemonInjection} from '@pokerace/shared';

export type FakeMode='apply'|'timeout'|'ack-lost'|{refuse:string};
type Command={commandId:string;command:string;payload:Record<string,any>};
type ConnectOptions={base:string;lobbyId:string;inviteCode:string;playerName:string;playerId?:string;money?:number;party?:string[];writes?:boolean;location?:{mapGroup:number;mapNumber:number;label:string};heartbeatMs?:number};

export const template=(speciesId=1,level=5,nickname='TEST'):PokemonInjection=>({playerId:'fake',slot:1,speciesId,nickname,level,experience:135,currentHp:20,
 stats:{maxHp:20,attack:10,defense:10,speed:10,spAttack:10,spDefense:10},moves:[{id:33,pp:35},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],heldItem:0,abilitySlot:0,nature:3,friendship:70,
 otName:'FAKE',trainerId:1,secretId:2,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},shiny:false});
export const rawPokemon=(speciesId=1,level=5,nickname='TEST')=>encodePokemon(template(speciesId,level,nickname));

const READ=['trainer.read','money.read','party.read','location.read','progression.read'] as const;
const WRITE=['money.write','party.write','pokemon.insert','pokemon.remove','pokemon.replace'] as const;

/**
 * Simulated Pokerace.Client + BizHawk: speaks the real /client protocol, keeps money and party,
 * and answers game commands by applying them, refusing, timing out or losing the acknowledgement.
 */
export class FakeGameClient{
 mode:FakeMode='apply';
 readonly received:Command[]=[];
 money:number;party:string[];completed:string[]=['starter'];
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
  const capabilities=[...READ,...(this.writes?WRITE:[])];
  const adapter={id:'pokemon.emerald.gen3',status:'ready' as const,profileId:'emerald-fr-bpef-v0',capabilities};
  return {gameStateVersion:2,adapter,game:{family:'pokemon',generation:3,title:'emerald',language:'fr',revision:'BPEF v0'},
   trainer:{name:'FAKE',money:this.money,playTimeSeconds:60,partyCount:this.party.length},location:{...this.location},
   party:this.party.map((raw,i)=>{const p=decodePokemonCopy(raw);
    return {artifact:{format:'gen3-party-v1',raw},slot:i+1,speciesId:1,speciesName:'Bulbizarre',nickname:p.nickname||null,level:p.level,currentHp:p.currentHp,maxHp:p.stats.maxHp,shiny:false};}),
   progression:{version:1,completed:this.completed},capabilities,observedAt:new Date().toISOString()};
 }
 publish(){const state=this.state();this.socket.emit('GAME_STATE',{type:'GAME_STATE',protocolVersion:1,gameStateVersion:2,adapter:state.adapter,state});}
 close(){this.socket.close();}
 /** Disconnects, then connects again as the same installation with the same game (money, party). */
 async reconnect(){this.close();return FakeGameClient.connect({...this.options,money:this.money,party:[...this.party],location:this.location});}

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
