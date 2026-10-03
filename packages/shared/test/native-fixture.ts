import type {NativeGameState,PublicNativeClient} from '../src/native-client.js';
export function nativeState():NativeGameState{
 const capabilities:NativeGameState['capabilities']=['trainer.read','money.read','party.read','location.read','progression.read'];
 return {gameStateVersion:1,adapter:{id:'pokemon.emerald.gen3',status:'ready',profileId:'emerald-fr-bpef-v0',capabilities},game:{family:'pokemon',generation:3,title:'emerald',language:'fr',revision:'BPEF v0'},trainer:{name:'TEST',money:12500,playTimeSeconds:3723,partyCount:1},location:{mapGroup:0,mapNumber:9,label:'Bourg-en-Vol'},party:[{slot:1,speciesId:1,speciesName:'Bulbizarre',nickname:null,level:5,currentHp:0,maxHp:20,shiny:true}],progression:{version:1,completed:['starter']},capabilities,observedAt:'2026-10-03T12:00:00.000Z'};
}
export function nativeClient():PublicNativeClient{
 const gameState=nativeState();
 return {accountId:'account-test',playerId:'installation-test',playerName:'Tester',ready:true,lastSeenAt:gameState.observedAt,clientVersion:'0.1.0',platform:'windows-x64',emulator:{name:'BizHawk'},bridge:{type:'bizhawk',connected:true,gameLoaded:true,protocolVersion:1},system:'GBA',allowMemoryWrites:true,adapter:gameState.adapter,gameState};
}
