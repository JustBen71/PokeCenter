import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ranking,areaFor} from '../src/progression.ts';
import type {PublicPlayer} from '@pokerace/shared';
const player=(id:string,completed?:string[])=>({playerId:id,connected:true,receivedAt:'2026-09-26T12:00:00Z',lastSeenAt:'2026-09-26T12:00:00Z',state:{game:{romStatus:'recognized'},location:{mapGroup:0,mapNumber:9},progression:completed?{version:1,completed}:null}} as PublicPlayer);
test('ranking preserves ties and never ranks unknown telemetry as zero progress',()=>{
 const rows=ranking([player('unknown'),player('b',['badge1']),player('a',['badge1']),player('first',['champion']),player('zero',[])]);
 assert.deepEqual(rows.map(r=>[r.player.playerId,r.rank]),[['first',1],['a',2],['b',2],['zero',4],['unknown',null]]);
});
test('League, badges and story order outweigh position and moving backwards',()=>{
 const rows=ranking([player('story',['starter','woods','rival103']),player('badge',['badge1']),player('league',['sidney'])]);
 assert.deepEqual(rows.map(r=>r.player.playerId),['league','badge','story']);
 const rolledBack=player('league',[]);
 assert.equal(ranking([rows[1].player,rolledBack])[0].player.playerId,'badge');
});
test('town interiors map to their town; unknown maps have no invented marker',()=>{
 assert.equal(areaFor(player('a'))?.id,'MAPSEC_LITTLEROOT_TOWN');
 const interior=player('b');interior.state.location={mapGroup:1,mapNumber:0,label:'Maison'};
 assert.equal(areaFor(interior)?.id,'MAPSEC_LITTLEROOT_TOWN');
 interior.state.location.mapGroup=999;assert.equal(areaFor(interior),undefined);
});
