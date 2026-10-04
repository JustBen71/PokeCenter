import test from 'node:test';
import assert from 'node:assert/strict';
import {apiErrorSchema,errorCodes,gameCapabilitySchema,lobbySettingsSchema,defaultLobbySettings,moneyTransactionTransitions,readCapabilitySchema,runTransitions} from '../src/index.js';

test('state machines have no transition out of terminal states and REVIEW never returns to an automatic state',()=>{
 for(const s of ['LOST','COMPLETED','ABORTED'] as const)assert.deepEqual(runTransitions[s],[]);
 for(const s of ['CONFIRMED','FAILED','CANCELLED'] as const)assert.deepEqual(moneyTransactionTransitions[s],[]);
 assert.deepEqual([...moneyTransactionTransitions.REVIEW].sort(),['CONFIRMED','FAILED']);
});

test('error codes are unique and the error envelope is strict about codes',()=>{
 assert.equal(new Set(errorCodes).size,errorCodes.length);
 assert.ok(apiErrorSchema.safeParse({ok:false,error:{code:'GAME_NOT_CONNECTED',message:'x'}}).success);
 assert.ok(!apiErrorSchema.safeParse({ok:false,error:{code:'Error: 500',message:'x'}}).success);
});

test('business capabilities include every capability the native protocol can announce',()=>{
 for(const c of readCapabilitySchema.options)assert.ok(gameCapabilitySchema.options.includes(c),c);
 assert.ok(lobbySettingsSchema.safeParse(defaultLobbySettings).success);
 assert.ok(!lobbySettingsSchema.safeParse({...defaultLobbySettings,bankDepositTaxPercent:-1}).success);
});
