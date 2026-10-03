import test from 'node:test';
import assert from 'node:assert/strict';
import {gameStateEventSchema,nativeGameStateSchema} from '../src/native-client.js';
import {nativeState} from './native-fixture.js';
test('native state validates normalized read-only data and rejects raw copies, writes and inconsistent party',()=>{
 const state=nativeState();assert.equal(nativeGameStateSchema.safeParse(state).success,true);
 for(const invalid of [{...state,raw:'00'.repeat(100)},{...state,romSha256:'a'.repeat(64)},{...state,capabilities:['party.write']},{...state,party:[{...state.party[0],raw:'00'.repeat(100)}]},{...state,party:[]},{...state,party:[{...state.party[0],currentHp:21}]}])assert.equal(nativeGameStateSchema.safeParse(invalid).success,false);
});
test('status-only event clears game state and ready requires a valid snapshot',()=>{
 const adapter={id:null,status:'unsupported_system',profileId:null,capabilities:[]};
 const event={type:'GAME_STATE',protocolVersion:1,gameStateVersion:1,adapter,state:null};
 assert.equal(gameStateEventSchema.safeParse(event).success,true);
 assert.equal(gameStateEventSchema.safeParse({...event,adapter:{...adapter,status:'ready'}}).success,false);
 assert.equal(gameStateEventSchema.safeParse({...event,state:nativeState()}).success,false);
});
