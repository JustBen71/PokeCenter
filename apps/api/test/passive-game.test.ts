import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePokemonCopy,encodePokemon,nationalSpecies,legendarySpecies,type WheelType} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,rawPokemon,template,until} from './support/fake-game-client.js';
import {implementedPassives} from '../src/passives/passive-handlers.js';

// Passives that write into the game: fake Gen III client announcing the battle state and game events.
const EVENTS=['events.trainer_victory','events.pokemon_fainted','events.battle_ended','steps.read'];
// A distinct nature per species: distinct personalities, as in a real game.
const hurt=(speciesId:number,hp:number,nickname='TEST')=>encodePokemon({...template(speciesId,5,nickname),nature:speciesId%25,currentHp:hp});
const settle=()=>new Promise(r=>setTimeout(r,80));

async function setup(grant:string,party=[rawPokemon(1,5,'BULBI'),rawPokemon(4,5,'SALA')],money=1000){
 const p=await passivePortal({implemented:implementedPassives});
 const {as,lobby,portal,base,ben,admin}=p;
 portal.services.passives.grant(lobby.id,ben.id,grant,'ADMIN');
 const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',money,party,events:EVENTS,defeats:true});
 await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money,'game');
 await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:ben.id,start:true});
 const progress=()=>portal.services.passives.owned(lobby.id,ben.id).find(o=>o.passiveId===grant)!.progress;
 const act=(body:object)=>as(ben.id).post(`/api/lobbies/${lobby.id}/passives/${grant}/act`,body);
 const order=['starter','rival103','woods','badge1','goods','badge2','letter','museum'];
 const reach=(n:number)=>portal.services.objectives.observe(lobby.id,ben.id,order.slice(0,n));
 const goodWheel=()=>as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,{name:'Bonheur',price:0,icon:'green-1',tone:'GOOD',gages:[{name:'Rien',handler:'NOTICE',params:{}}]}).then(r=>r.body as WheelType);
 const tickets=()=>(p.store.db.prepare("SELECT COUNT(*) AS n FROM wheel_tickets WHERE recipient_account_id=?").get(ben.id) as {n:number}).n;
 return {...p,game,progress,act,reach,goodWheel,tickets,close:async()=>{game.close();await p.close();}};
}

test('Prime de dresseur: +5 % of the native trainer reward, once per event',async()=>{
 const t=await setup('trainer-payday');
 try{
  const id=crypto.randomUUID();
  await t.game.trainerVictory(1000,id);
  await until(()=>t.game.money===1000+1000+50,'payday');
  await t.game.gameEvent('TRAINER_VICTORY',{moneyBefore:1000,moneyAfter:2000,baseReward:1000},id);await settle();
  assert.equal(t.game.money,2050,'a replayed event pays nothing');
 }finally{await t.close();}
});

test('Compagnon fidèle: 3 objectives with the first Pokémon still there heal the team out of battle; leaving resets',async()=>{
 const t=await setup('loyal-companion',[hurt(1,4,'BULBI'),hurt(4,9,'SALA')]);
 try{
  t.game.publish();await until(()=>(t.progress().companion as {name:string}|undefined)?.name==='BULBI','companion');
  await t.reach(1);// catch-up of the save: not counted
  t.game.setSafe(false);
  await until(()=>t.portal.services.currentGame.requireState(t.lobby.id,t.ben.id).state.battle?.safe===false,'in battle');
  await t.reach(2);await t.reach(3);await t.reach(4);
  await until(()=>t.progress().heal===true,'heal armed');
  t.game.publish();await settle();
  assert.equal(decodePokemonCopy(t.game.party[0]!).currentHp,4,'never in battle');
  t.game.setSafe(true);
  await until(()=>t.game.party.every(r=>decodePokemonCopy(r).currentHp===20),'healed');
  assert.equal(t.progress().heal,null);
  // The companion leaves: the next Pokémon becomes the companion, counter at zero.
  t.game.party=[t.game.party[1]!];t.game.publish();
  await until(()=>(t.progress().companion as {name:string}).name==='SALA','new companion');
  assert.equal(t.progress().objectives,0);
 }finally{await t.close();}
});

test('Dernier debout: a battle ended with one conscious Pokémon brings the team to half HP, once per Run',async()=>{
 const t=await setup('last-standing',[hurt(1,3,'BULBI'),hurt(7,15,'CARA')]);
 try{
  await t.game.battleEnded('WIN',2);await settle();
  assert.equal(t.progress().heal??null,null,'two conscious: nothing');
  await t.game.battleEnded('WIN',1);
  await until(()=>decodePokemonCopy(t.game.party[0]!).currentHp===10,'half HP');
  assert.equal(decodePokemonCopy(t.game.party[1]!).currentHp,15,'never lowered');
  await t.game.battleEnded('WIN',1);await settle();
  assert.equal(t.progress().heal,null,'once per Run');
 }finally{await t.close();}
});

test('Alchimiste: one nature among 3, once per Run; personality changed, stats recomputed, the rest kept',async()=>{
 const t=await setup('alchemist');
 try{
  t.game.publish();await until(()=>Array.isArray(t.progress().natures),'offer');
  const natures=t.progress().natures as number[],before=decodePokemonCopy(t.game.party[1]!);
  const nature=natures.find(n=>n!==before.nature)!;
  assert.equal((await t.act({action:'nature',slot:2,nature:(nature+1)%25===natures[0]?nature:[...Array(25).keys()].find(n=>!natures.includes(n))})).body.error.code,'VALIDATION_FAILED');
  assert.equal((await t.act({action:'nature',slot:2,nature})).status,200);
  const after=decodePokemonCopy(t.game.party[1]!);
  assert.equal(after.nature,nature);assert.equal(after.nickname,'SALA');assert.deepEqual(after.ivs,before.ivs);assert.deepEqual(after.moves,before.moves);
  assert.equal(after.personality&0xFFFF,before.personality&0xFFFF,'gender kept');assert.equal(after.shiny,before.shiny);
  assert.equal((await t.act({action:'nature',slot:1,nature})).body.error.code,'CONFLICT');
 }finally{await t.close();}
});

test('ADN instable: every 2 objectives a charge, one random IV of the chosen Pokémon +2',async()=>{
 const t=await setup('unstable-dna');
 try{
  assert.equal((await t.act({action:'iv',slot:1})).body.error.code,'CONFLICT','no charge');
  await t.reach(1);await t.reach(2);await t.reach(3);
  await until(()=>t.progress().charges===1,'charge');
  const before=decodePokemonCopy(t.game.party[0]!).ivs;
  assert.equal((await t.act({action:'iv',slot:1})).status,200);
  const after=decodePokemonCopy(t.game.party[0]!).ivs;
  const changed=Object.keys(before).filter(k=>before[k]!==after[k]);
  assert.equal(changed.length,1);assert.equal(after[changed[0]!]!-before[changed[0]!]!,2);
  assert.equal(t.progress().charges,0);
 }finally{await t.close();}
});

test('Chasseur de trésors: every 10 trainer victories, a random item in the bag',async()=>{
 const t=await setup('treasure-hunter');
 try{
  for(let i=0;i<9;i++)await t.game.trainerVictory(10);
  await settle();assert.equal(t.game.bag.size,0);
  await t.game.trainerVictory(10);

  await until(()=>t.game.bag.size===1,'item');
  await until(()=>(t.progress().items as number[]).length===0,'queue emptied');
 }finally{await t.close();}
});

test('Maître des types: objective with 6 Pokémon covering 10 types gives a TM; offline the TM waits',async()=>{
 const t=await setup('type-master',[1,4,7,10,13,16].map(s=>rawPokemon(s,5)));
 try{
  await t.reach(1);
  t.game.mode={refuse:'bag_full'};
  await t.reach(2);
  await until(()=>(t.progress().items as number[]).length===1,'TM waiting');
  t.game.mode='apply';t.game.publish();
  await until(()=>t.game.bag.size===1,'TM given');
  const [item]=[...t.game.bag.keys()];assert.ok(item!>=289&&item!<=338);
  assert.deepEqual(t.progress().items,[]);
  // Five Pokémon: nothing.
  t.game.party.pop();t.game.publish();await settle();await t.reach(3);await settle();
  assert.equal(t.game.bag.size,1);
 }finally{await t.close();}
});

test('Marathonien: every 25 000 race steps, +10 000 ₽ (deltas only)',async()=>{
 const t=await setup('marathoner');
 try{
  await t.game.setSteps(5000);// baseline
  await t.game.setSteps(29000);await settle();
  assert.equal(t.game.money,1000);
  await t.game.setSteps(100);// new save: new baseline, no negative delta
  await t.game.setSteps(1200);
  await until(()=>t.game.money===11000,'paid');
 }finally{await t.close();}
});

test('Résurrection: once per Run a fainted Pokémon comes back at 1 HP instead of the PC box',async()=>{
 const t=await setup('resurrection');
 try{
  await t.game.pokemonFainted(2,4);
  t.game.faint(2);
  await until(()=>decodePokemonCopy(t.game.party[1]!).currentHp===1,'revived');
  assert.equal(t.game.box.length,0);assert.equal(t.game.party.length,2);
  t.game.faint(2);
  await until(()=>t.game.box.length===1,'second time: boxed');
  assert.equal(t.game.party.length,1);
 }finally{await t.close();}
});

test('Résurrection: a busy game (reward being paid) delays the box and the rescue, the use is not lost',async()=>{
 const t=await setup('resurrection');
 try{
  const {commands}=t.portal.services;
  // Another action holds the player's game while the Pokémon faints (real case: board reward paid after the battle).
  let release!:()=>void;const held=commands.withPlayerLock(t.lobby.id,t.ben.id,()=>new Promise<void>(r=>{release=r;}));
  t.game.faint(2);await settle();
  assert.equal(t.game.box.length,0);assert.equal(t.progress().usedRun??null,null,'not consumed');
  release();await held;
  await until(()=>decodePokemonCopy(t.game.party[1]!).currentHp===1,'revived after the other action');
  assert.equal(t.game.box.length,0);
 }finally{await t.close();}
});

test('Mutagène: 3 learnable moves offered, one replaces a move, once per Run',async()=>{
 const t=await setup('mutagen');
 try{
  assert.equal((await t.act({action:'offer',slot:1})).status,200);
  const offer=t.progress().offer as {moves:{id:number}[]};
  assert.equal(offer.moves.length,3);assert.ok(offer.moves.every(m=>[14,15,70,92].includes(m.id)));
  assert.equal((await t.act({action:'offer',slot:2})).body.error.code,'CONFLICT','one offer per Run');
  const move=offer.moves[0]!.id;
  assert.equal((await t.act({action:'mutate',moveIndex:3,moveId:999})).status,400);
  assert.equal((await t.act({action:'mutate',moveIndex:3,moveId:move})).status,200);
  const moves=decodePokemonCopy(t.game.party[0]!).moves;
  assert.deepEqual(moves.map(m=>m.id),[33,move,0,0],'an empty slot takes the first free place');assert.equal(moves[1]!.pp,20);
  assert.equal((await t.act({action:'offer',slot:1})).body.error.code,'CONFLICT');
  assert.equal(t.progress().used,true,'shown as used for this Run');
 }finally{await t.close();}
});

test('Prime de risque: trainer won under 35 % average HP, one kind ticket per badge',async()=>{
 const t=await setup('risk-bonus',[hurt(1,2),hurt(4,3)]);
 try{
  await t.goodWheel();
  await t.game.trainerVictory(100);
  await until(()=>t.tickets()===1,'ticket');
  await t.game.trainerVictory(100);await settle();
  assert.equal(t.tickets(),1,'same badge');
  t.game.completed=['starter','badge1'];t.game.publish();await settle();
  await t.game.trainerVictory(100);
  await until(()=>t.tickets()===2,'new badge');
 }finally{await t.close();}
});

test('Héritier des légendes: at 50 000 race steps a level 5 legendary joins the team (it obeys: same trainer)',async()=>{
 const t=await setup('legend-heir');
 try{
  await t.game.setSteps(0);await t.game.setSteps(49999);await settle();
  assert.equal(t.game.party.length,2);
  await t.game.setSteps(50000);
  await until(()=>t.game.party.length===3,'hatched');
  const egg=decodePokemonCopy(t.game.party[2]!),own=decodePokemonCopy(t.game.party[0]!);
  assert.ok(legendarySpecies.includes(nationalSpecies.get(egg.internalSpecies)!));
  assert.equal(egg.level,5);assert.equal(egg.trainerId,own.trainerId);assert.equal(egg.otName,own.otName);
  await t.game.setSteps(120000);t.game.publish();await settle();
  assert.equal(t.game.party.length,3,'once');
 }finally{await t.close();}
});
