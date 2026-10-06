import test from 'node:test';
import assert from 'node:assert/strict';
import type {PublicPlayer} from '@pokerace/shared';
import {nativeClient,syntheticState} from '../../../packages/shared/test/native-fixture.js';
import {nativeCan} from '../src/pokemon/game-actions.js';
import {mapForPlayers} from '../src/map/game-maps.js';
import {playerViews,adapterLabels,readOnlyParticipants,participantRoster} from '../src/native-clients.js';
import {ranking} from '../src/progression.js';
const legacy=():PublicPlayer=>{const display=playerViews([],[nativeClient()])[0].display;return {...display,state:{...display.state,trainer:{...display.state.trainer!,money:7}}};};
test('native-only player uses account ID and displays trainer, money, party and progression read-only',()=>{
 const [view]=playerViews([],[nativeClient()]);assert.equal(view.accountId,'account-test');assert.equal(view.display.playerId,'account-test');assert.equal(view.source,'native');assert.equal(view.legacyActionsAvailable,false);
 assert.equal(view.display.state.trainer?.money,12500);assert.equal(view.display.state.party[0].shiny,true);assert.equal(view.display.state.party[0].raw,undefined);assert.deepEqual(view.display.state.progression?.completed,['starter']);assert.equal(ranking([view.display])[0].known,true);
});
test('legacy-only data and action identity remain intact',()=>{
 const player=legacy();const [view]=playerViews([player],[]);assert.equal(view.display,player);assert.equal(view.source,'legacy');assert.equal(view.legacyActionsAvailable,true);
});
test('both clients merge by account, prefer native display and keep legacy action source',()=>{
 const player=legacy();const views=playerViews([player],[nativeClient()]);assert.equal(views.length,1);assert.equal(views[0].display.state.trainer?.money,12500);assert.equal(views[0].legacy,player);assert.equal(views[0].legacyActionsAvailable,true);
});
test('unsupported or disconnected native state falls back to legacy without hiding connection status',()=>{
 for(const status of ['unsupported_system','read_error','no_game'] as const){const native=nativeClient();native.adapter={id:null,status,profileId:null,capabilities:[]};native.gameState=null;
  const [fallback]=playerViews([legacy()],[native]);assert.equal(fallback.source,'legacy');assert.ok(fallback.native);const [only]=playerViews([],[native]);assert.equal(only.source,'connection');assert.equal(only.display.state.diagnostic,adapterLabels[status]);assert.equal(only.legacyActionsAvailable,false);
 }
});
test('offline legacy cannot enable business actions for native-only connection',()=>{
 const player=legacy();player.connected=false;assert.equal(playerViews([player],[nativeClient()])[0].legacyActionsAvailable,false);
});
test('native administrators remain visible participants without gaining legacy action support',()=>{
 const native=nativeClient();native.playerName='Ben';
 const views=playerViews([],[native]);
 const readOnly=readOnlyParticipants(views),roster=participantRoster([],readOnly);
 assert.equal(roster.length,1);assert.equal(roster[0].state.playerName,'Ben');
 assert.equal(roster[0].playerId,native.accountId);assert.equal(roster[0].state.trainer?.money,12500);
 assert.equal(readOnly.length,1);assert.equal(views[0].legacyActionsAvailable,false);
});
test('action roster replaces an offline legacy row but preserves the live legacy source',()=>{
 const player=legacy();player.connected=false;
 const readOnly=readOnlyParticipants(playerViews([player],[nativeClient()]));
 const roster=participantRoster([player],readOnly);
 assert.equal(roster.length,1);assert.equal(roster[0].state.trainer?.money,12500);
 player.connected=true;
 const available=readOnlyParticipants(playerViews([player],[nativeClient()]));
 assert.deepEqual(available,[]);assert.equal(participantRoster([player],available)[0],player);
});
test('synthetic Gen IV/V clients display common fields and only the actions their capabilities announce',()=>{
 for(const generation of [4,5] as const){
  const state=syntheticState(generation);
  const [view]=playerViews([],[nativeClient(state)]);
  assert.equal(view.source,'native');
  assert.equal(view.display.state.party[0].speciesName,state.party[0].speciesName);
  assert.equal(view.display.state.party[0].nickname,'PINGU');
  assert.equal(view.display.state.party[0].level,12);
  assert.equal(view.display.state.party[0].currentHp,30);
  assert.equal(view.display.state.location?.label,state.location.label);
  assert.equal(view.display.state.trainer?.money,1250000);
  assert.equal('raw' in view.display.state.party[0],false,'no Gen III copy for another generation');
  assert.equal(nativeCan(view,'money.read'),true);
  for(const write of ['money.write','pokemon.insert','pokemon.remove','pokemon.replace'] as const)assert.equal(nativeCan(view,write),false,write);
 }
 const gen3=nativeClient();gen3.adapter={...gen3.adapter,capabilities:[...gen3.adapter.capabilities,'money.write']};
 assert.equal(nativeCan(playerViews([],[gen3])[0],'money.write'),true);
});
test('the map follows the game: Hoenn for Emerald, no structural Hoenn fallback for another region',()=>{
 const emerald=playerViews([],[nativeClient()])[0].display;
 assert.equal(mapForPlayers([emerald])?.region,'Hoenn');
 assert.equal(mapForPlayers([emerald])?.areaFor(emerald)?.id!==undefined,true);
 assert.equal(mapForPlayers([])?.region,'Hoenn','default while nobody is connected');
 const gen4=playerViews([],[nativeClient(syntheticState(4))])[0].display;
 assert.equal(gen4.state.game.name,'pokemon-platinum');
 assert.equal(mapForPlayers([gen4]),undefined);
});
