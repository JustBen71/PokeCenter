import type {NativeGameState,NativeGameStateV1,PublicNativeClient} from '../src/native-client.js';
const readCapabilities:NativeGameState['capabilities']=['trainer.read','money.read','party.read','location.read','progression.read'];
export function nativeState():NativeGameState{
 const capabilities=[...readCapabilities];
 return {gameStateVersion:2,adapter:{id:'pokemon.emerald.gen3',status:'ready',profileId:'emerald-fr-bpef-v0',capabilities},game:{family:'pokemon',generation:3,title:'emerald',language:'fr',revision:'BPEF v0'},trainer:{name:'TEST',money:12500,playTimeSeconds:3723,partyCount:1},location:{mapGroup:0,mapNumber:9,label:'Bourg-en-Vol'},party:[{slot:1,speciesId:1,speciesName:'Bulbizarre',nickname:null,level:5,currentHp:0,maxHp:20,shiny:true}],progression:{version:1,completed:['starter']},capabilities,observedAt:'2026-10-03T12:00:00.000Z'};
}
// Format sent by Pokerace.Client <= 0.1, still accepted and upgraded by the server.
export function nativeStateV1(raw?:string):NativeGameStateV1{
 const {party,...state}=nativeState();
 return {...state,gameStateVersion:1,location:{mapGroup:0,mapNumber:9,label:'Bourg-en-Vol'},game:{...state.game,generation:3,title:'emerald',language:'fr'},party:party.map(({artifact:_,...p})=>raw?{...p,raw}:p)};
}
// Synthetic contracts only: no Gen IV/V GameAdapter exists. They prove the shared schema and the
// common UI fields do not assume Gen III. A future generation may announce reads before writes.
export function syntheticState(generation:4|5):NativeGameState{
 const capabilities:NativeGameState['capabilities']=['trainer.read','money.read','party.read','location.read'];
 const game=generation===4?{title:'platinum',revision:'CPUF',region:'sinnoh',label:'Littorella',species:{id:393,name:'Tiplouf'}}
  :{title:'black',revision:'IRBF',region:'unova',label:'Renouet',species:{id:495,name:'Vipélierre'}};
 return {gameStateVersion:2,adapter:{id:`pokemon.${game.title}.gen${generation}`,status:'ready',profileId:`${game.title}-fr-test`,capabilities},
  game:{family:'pokemon',generation,title:game.title,language:'fr',revision:game.revision},
  trainer:{name:'AURORE',money:1250000,playTimeSeconds:600,partyCount:1},location:{label:game.label,region:game.region,mapId:'411'},
  party:[{slot:1,speciesId:game.species.id,speciesName:game.species.name,nickname:'PINGU',level:12,currentHp:30,maxHp:34,shiny:false,artifact:{format:`gen${generation}-party-v1`,raw:'ab'.repeat(236)}}],
  progression:{version:1,completed:['badge-1']},capabilities,observedAt:'2026-10-03T12:00:00.000Z'};
}
export function nativeClient(gameState:NativeGameState=nativeState()):PublicNativeClient{
 return {accountId:'account-test',playerId:'installation-test',playerName:'Tester',ready:true,lastSeenAt:gameState.observedAt,clientVersion:'0.1.0',platform:'windows-x64',emulator:{name:'BizHawk'},bridge:{type:'bizhawk',connected:true,gameLoaded:true,protocolVersion:1},system:gameState.game.generation===3?'GBA':'NDS',allowMemoryWrites:true,adapter:gameState.adapter,gameState};
}
