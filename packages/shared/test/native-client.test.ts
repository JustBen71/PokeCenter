import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePokemon} from '../src/pokemon-encode.js';
import {gameStateEventSchema,gen3PartyRaw,nativeGameStateSchema} from '../src/native-client.js';
import {nativeDisplayState} from '../src/game.js';
import {nativeState,nativeStateV1,syntheticState} from './native-fixture.js';

const raw=encodePokemon({playerId:'fake',slot:1,speciesId:1,nickname:'TEST',level:5,experience:135,currentHp:20,stats:{maxHp:20,attack:10,defense:10,speed:10,spAttack:10,spDefense:10},
 moves:[{id:33,pp:35},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],heldItem:0,abilitySlot:0,nature:3,friendship:70,otName:'FAKE',trainerId:1,secretId:2,
 ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},shiny:false});
const event=(state:any)=>({type:'GAME_STATE',protocolVersion:1,gameStateVersion:state.gameStateVersion,adapter:state.adapter,state});

test('native state validates normalized read-only data and rejects raw copies, writes and inconsistent party',()=>{
 const state=nativeState();assert.equal(nativeGameStateSchema.safeParse(state).success,true);
 const withArtifact={...state,party:[{...state.party[0],artifact:{format:'gen3-party-v1',raw}}]};
 assert.equal(nativeGameStateSchema.safeParse(withArtifact).success,true);
 for(const invalid of [{...state,raw:'00'.repeat(100)},{...state,romSha256:'a'.repeat(64)},{...state,capabilities:['party.write']},
  {...state,party:[{...state.party[0],raw}]},{...state,party:[{...state.party[0],artifact:{format:'gen3-party-v1',raw:'00'.repeat(100)}}]},
  {...state,party:[]},{...state,party:[{...state.party[0],currentHp:21}]},{...state,gameStateVersion:1},
  {...state,trainer:{...state.trainer,money:1000000}},{...state,location:{label:'Sans carte'}},
  {...state,progression:{version:1,completed:['badge-inconnu']}},{...state,party:[{...state.party[0],speciesId:387}]}])
  assert.equal(nativeGameStateSchema.safeParse(invalid).success,false,JSON.stringify(invalid).slice(0,160));
});

test('status-only event clears game state and ready requires a valid snapshot',()=>{
 const adapter={id:null,status:'unsupported_system',profileId:null,capabilities:[]};
 for(const version of [1,2]){
  const status={type:'GAME_STATE',protocolVersion:1,gameStateVersion:version,adapter,state:null};
  const parsed=gameStateEventSchema.safeParse(status);
  assert.equal(parsed.success,true);assert.equal(parsed.data?.gameStateVersion,2);
  assert.equal(gameStateEventSchema.safeParse({...status,adapter:{...adapter,status:'ready'}}).success,false);
 }
 assert.equal(gameStateEventSchema.safeParse({type:'GAME_STATE',protocolVersion:1,gameStateVersion:2,adapter,state:nativeState()}).success,false);
});

test('gameStateVersion 1 from older clients is upgraded: the Gen III raw copy becomes a gen3-party-v1 artifact',()=>{
 const parsed=gameStateEventSchema.parse(event(nativeStateV1(raw)));
 assert.equal(parsed.gameStateVersion,2);assert.equal(parsed.state!.gameStateVersion,2);
 assert.deepEqual(parsed.state!.party[0].artifact,{format:'gen3-party-v1',raw});
 assert.equal('raw' in parsed.state!.party[0],false);
 assert.equal(gen3PartyRaw(parsed.state!.party[0]),raw);
 assert.equal(nativeGameStateSchema.safeParse(parsed.state).success,true);
 // A version 1 event cannot carry version 2 fields, and the versions cannot be mixed.
 assert.equal(gameStateEventSchema.safeParse({...event(nativeStateV1()),gameStateVersion:2}).success,false);
 assert.equal(gameStateEventSchema.safeParse({...event(nativeState()),gameStateVersion:1}).success,false);
});

test('synthetic Gen III, IV and V states share one contract and one display model',()=>{
 for(const state of [nativeState(),syntheticState(4),syntheticState(5)]){
  const parsed=gameStateEventSchema.safeParse(event(state));
  assert.equal(parsed.success,true,`gen ${state.game.generation}: ${parsed.error?.message}`);
  const display=nativeDisplayState(state);
  assert.equal(display.party[0].speciesName,state.party[0].speciesName);
  assert.equal(display.party[0].level,state.party[0].level);
  assert.equal(display.location.label,state.location.label);
  assert.equal(display.trainer.money,state.trainer.money);
 }
 const gen4=syntheticState(4);
 assert.equal('raw' in nativeDisplayState(gen4).party[0],false,'a Gen IV payload is never exposed as a Gen III copy');
 assert.equal(gen3PartyRaw(gen4.party[0]),undefined);
 assert.equal(gen4.capabilities.some(c=>c.endsWith('.write')||c.startsWith('pokemon.')),false,'reads announced without writes');
 for(const invalid of [{...gen4,party:[{...gen4.party[0],artifact:{format:'gen3-party-v1',raw}}]},{...gen4,party:[{...gen4.party[0],speciesId:494}]},
  {...gen4,game:{...gen4.game,generation:10}},{...gen4,party:[{...gen4.party[0],artifact:{format:'gen4-party-v1',raw:'abc'}}]}])
  assert.equal(nativeGameStateSchema.safeParse(invalid).success,false);
});
