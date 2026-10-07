import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePokemonCopy,gen3Items,nationalSpecies,type WheelResolution,type WheelType} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,rawPokemon,until} from './support/fake-game-client.js';

test('wheel gages on games: random items gained / lost, Pokémon transfer, level ±, Magikarp curse',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,tim,lobby,base,portal}=p;
  const wheels=`/api/lobbies/${lobby.id}/wheels`;
  const ALPHA=rawPokemon(255,5,'ALPHA'),BETA=rawPokemon(258,12,'BETA'),GAMMA=rawPokemon(252,30,'GAMMA');
  const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',party:[ALPHA,BETA]});closers.push(()=>benGame.close());
  const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',party:[GAMMA]});closers.push(()=>timGame.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money&&!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'games');
  for(const id of [ben.id,tim.id])await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:id,start:true});
  const run=async(handler:string,params:object,body:object={})=>{
   const w=(await as(admin.id).post(wheels,{name:handler,price:0,icon:'green-2',tone:'NEUTRAL',gages:[{name:handler,handler,params}]})).body as WheelType;
   assert.ok(w.id,JSON.stringify(w));
   const r=(await as(admin.id).post(`${wheels}/${w.id}/spin`,{ownerId:ben.id})).body as WheelResolution;
   return (await as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${r.id}/apply`,body)).body as WheelResolution&{error?:{code:string}};
  };
  const slot=(game:FakeGameClient,i:number)=>decodePokemonCopy(game.party[i-1]!);

  // Items: two random giveable items for the beneficiary; the target loses its only item, then has none.
  const given=await run('ITEM_GIVE',{count:2});
  assert.equal(given.status,'SUCCESS',JSON.stringify(given));
  assert.equal([...benGame.bag.values()].reduce((a,b)=>a+b,0),2);
  assert.ok([...benGame.bag.keys()].every(id=>gen3Items.some(i=>i[0]===id)));
  assert.match(given.result!,/^Ben reçoit .+, .+$/);
  timGame.bag.set(13,1);
  assert.equal((await run('ITEM_TAKE',{},{targetId:tim.id})).result,'Tim perd Potion');
  assert.equal(timGame.bag.size,0);
  assert.equal((await run('ITEM_TAKE',{},{targetId:tim.id})).result,'Tim n’a aucun objet à perdre');

  // Transfer: Ben's chosen Pokémon (slot 2) goes to Tim, exact copy; out-of-battle confirmation required.
  assert.equal((await run('POKEMON_TRANSFER',{direction:'GIVE',selector:'choice'},{targetId:tim.id,slot:2})).error!.code,'SAFE_STATE_REQUIRED');
  const moved=await run('POKEMON_TRANSFER',{direction:'GIVE',selector:'choice'},{targetId:tim.id,slot:2,confirmOutOfBattle:true});
  assert.equal(moved.status,'SUCCESS',JSON.stringify(moved));
  assert.deepEqual(benGame.party,[ALPHA]);assert.deepEqual(timGame.party,[GAMMA,BETA]);
  assert.match(moved.result!,/BETA \(niv\. 12\) passe de l’équipe de Ben à celle de Tim/);
  // Never the last Pokémon of the giver.
  assert.equal((await run('POKEMON_TRANSFER',{direction:'GIVE'},{targetId:tim.id,confirmOutOfBattle:true})).error!.code,'LAST_POKEMON');
  // TAKE: the target's highest Pokémon comes to the beneficiary.
  assert.equal((await run('POKEMON_TRANSFER',{direction:'TAKE',selector:'highest'},{targetId:tim.id,confirmOutOfBattle:true})).status,'SUCCESS');
  assert.deepEqual(benGame.party,[ALPHA,GAMMA]);assert.deepEqual(timGame.party,[BETA]);

  // Level −1 on the chosen Pokémon: same Pokémon, level 4, experience and stats of level 4.
  const before=slot(benGame,1);
  const down=await run('POKEMON_LEVEL',{delta:-1,selector:'choice'},{slot:1,confirmOutOfBattle:true});
  assert.equal(down.status,'SUCCESS',JSON.stringify(down));
  const after=slot(benGame,1);
  assert.equal(after.level,4);assert.equal(after.experience,64);assert.equal(after.personality,before.personality);assert.equal(after.nickname,'ALPHA');
  assert.match(down.result!,/ALPHA \(niv\. 5\) de Ben descend au niveau 4/);
  // Level +3 on a random Pokémon of the target.
  assert.equal((await run('POKEMON_LEVEL',{who:'TARGET',delta:3},{targetId:tim.id,confirmOutOfBattle:true})).status,'SUCCESS');
  assert.equal(slot(timGame,1).level,15);

  // Magikarp curse on the target's highest Pokémon (default target).
  const cursed=await run('MAGIKARP_CURSE',{selector:'highest'},{targetId:tim.id,confirmOutOfBattle:true});
  assert.equal(cursed.status,'SUCCESS',JSON.stringify(cursed));
  const carp=slot(timGame,1);
  assert.equal(nationalSpecies.get(carp.internalSpecies),129);assert.equal(carp.level,1);
  assert.match(cursed.result!,/BETA \(niv\. 15\) de Tim devient un Magicarpe niveau 1/);
 }finally{for(const c of closers)c();await p.close();}
});
