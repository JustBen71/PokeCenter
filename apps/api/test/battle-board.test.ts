import test from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {boardReward,encodePokemon,type BattleEncounter,type BoardSnapshot,type BoardTeam,type LobbyNotification,type WheelResolution,type WheelType} from '@pokerace/shared';
import {passivePortal} from './support/passive-portal.js';
import {FakeGameClient,template,until} from './support/fake-game-client.js';

async function eventually(check:()=>Promise<boolean>,label:string){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw new Error(`Timed out waiting for ${label}`);}

test('Tableau des combats: first come first served, loss puts the team back, win pays the reward once, forfeit, wheel team',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,ben,tim,lobby,base,portal}=p;
  const board=`/api/lobbies/${lobby.id}/board`;
  const team=async(id:string)=>((await as(ben.id).get(board)).body as BoardSnapshot).teams.find(t=>t.id===id)!;
  const watch=client(base+'/dashboard',{path:`/rooms/${lobby.id}/socket.io`,auth:{accountId:tim.id},transports:['websocket'],reconnection:false});closers.push(()=>watch.close());
  const notes:string[]=[];watch.on('notification',(n:LobbyNotification)=>notes.push(n.message));
  const benGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Ben',battles:true,party:[encodePokemon(template(258,12,'GOBOU'))]});closers.push(()=>benGame.close());
  const timGame=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',battles:true,money:1000,party:[encodePokemon(template(255,20,'POUSSIFEU'))]});closers.push(()=>timGame.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,ben.id).game.money&&!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'games');

  // Only admins create; the team is drawn once and the reward suggested.
  const body={trainer:{name:'ROXANE',spriteId:'lady'},slots:[{mode:'FIXED',speciesId:74,level:14,moves:[33,88]},{mode:'RANDOM',minLevel:10,maxLevel:12,legendary:'NO'}]};
  assert.equal((await as(ben.id).post(board,body)).status,403);
  const created=(await as(admin.id).post(board,body)).body as BoardTeam;
  assert.equal(created.status,'OPEN');
  assert.deepEqual(created.party[0],{speciesId:74,level:14,moves:[33,88],heldItem:0,nature:created.party[0]!.nature,ev:0});
  assert.ok(created.party[1]!.level>=10&&created.party[1]!.level<=12);
  assert.deepEqual(created.party[1]!.moves,[33,45]);
  assert.equal(created.reward,boardReward(created.party));
  await until(()=>notes.some(n=>n.startsWith('🗡 Nouveau combat au tableau : ROXANE')),'new team notification');

  // A Run is needed to take a team.
  assert.equal((await as(ben.id).post(`${board}/${created.id}/challenge`)).body.error.code,'RUN_NOT_RUNNING');
  for(const id of [ben.id,tim.id])await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:id,start:true});
  // First come, first served: Ben takes it, Tim cannot.
  assert.equal((await as(ben.id).post(`${board}/${created.id}/challenge`)).body.status,'CHALLENGED');
  assert.equal((await as(tim.id).post(`${board}/${created.id}/challenge`)).body.error.code,'CONFLICT');
  assert.equal((await as(admin.id).post(`${board}/${created.id}/withdraw`)).body.error.code,'CONFLICT');
  await until(()=>benGame.battle.active!==null,'battle armed in Ben’s game');
  assert.deepEqual(benGame.battle.spec!.party,created.party);
  assert.deepEqual(benGame.battle.spec!.trainer,{name:'ROXANE',spriteId:'lady'});
  // Ben loses: the team goes back on the board.
  benGame.battleStarted();benGame.endBattle('LOSS');
  await eventually(async()=>(await team(created.id)).status==='OPEN','back on the board');
  assert.equal((await team(created.id)).challengerId,null);
  await until(()=>notes.some(n=>n.includes('Ben a perdu contre ROXANE')),'loss notification');

  // Tim wins: the reward is paid into his game, once.
  assert.equal((await as(tim.id).post(`${board}/${created.id}/challenge`)).body.status,'CHALLENGED');
  await until(()=>timGame.battle.active!==null,'battle armed in Tim’s game');
  timGame.battleStarted();timGame.endBattle('WIN');
  await eventually(async()=>(await team(created.id)).rewardStatus==='PAID','reward paid');
  const won=await team(created.id);
  assert.equal(won.status,'WON');assert.equal(won.winnerId,tim.id);
  assert.equal(timGame.money,1000+created.reward);
  assert.equal(timGame.received.filter(c=>c.command==='game.money.add').length,1);
  await until(()=>notes.some(n=>n.includes(`Tim a vaincu ROXANE au tableau : +${created.reward.toLocaleString('fr-FR')} ₽`)),'win notification');
  assert.equal((await as(ben.id).post(`${board}/${created.id}/challenge`)).body.error.code,'CONFLICT');

  // Wallet full (999 999 ₽): the reward waits without using its attempts, then is paid once money goes down.
  const third=(await as(admin.id).post(board,{slots:[{mode:'RANDOM',minLevel:5,maxLevel:5}],reward:500})).body as BoardTeam;
  timGame.money=999800;timGame.publish();
  await as(tim.id).post(`${board}/${third.id}/challenge`);
  await until(()=>timGame.battle.active===created.id||timGame.battle.active!==null,'third battle armed');
  timGame.battleStarted();timGame.endBattle('WIN');
  await eventually(async()=>(await team(third.id)).status==='WON','third won');
  for(let i=0;i<8;i++){timGame.step();await new Promise(r=>setTimeout(r,30));}
  assert.equal((await team(third.id)).rewardStatus,'PENDING');assert.equal((await team(third.id)).attempts,0);
  timGame.money=1000;timGame.publish();
  await eventually(async()=>(await team(third.id)).rewardStatus==='PAID','paid once the wallet has room');
  assert.equal(timGame.money,1500);
  // Forfeit before the battle starts: the team goes back, the battle is cancelled.
  const second=(await as(admin.id).post(board,{slots:[{mode:'RANDOM',minLevel:5,maxLevel:5}],reward:777})).body as BoardTeam;
  assert.equal(second.reward,777);assert.equal(second.trainer.name,'DÉFI');
  benGame.setSafe(false);
  await as(ben.id).post(`${board}/${second.id}/challenge`);
  assert.equal((await as(tim.id).post(`${board}/${second.id}/forfeit`)).status,403);
  assert.equal((await as(ben.id).post(`${board}/${second.id}/forfeit`)).body.status,'OPEN');
  const battles=((await as(admin.id).get(`/api/lobbies/${lobby.id}/battles`)).body.encounters as BattleEncounter[]).filter(e=>e.sourceRefId===second.id);
  assert.deepEqual(battles.map(e=>e.status),['CANCELLED']);
  // Admin: new draw keeps a custom reward; reward change; withdraw.
  assert.equal(((await as(admin.id).post(`${board}/${second.id}/reroll`)).body as BoardTeam).reward,777);
  assert.equal(((await as(admin.id).post(`${board}/${second.id}/reward`,{reward:900})).body as BoardTeam).reward,900);
  assert.equal(((await as(admin.id).post(`${board}/${second.id}/withdraw`)).body as BoardTeam).status,'WITHDRAWN');

  // Wheel: a team drawn around the beneficiary's level (Ben: 12 ± 2) appears on the board.
  const wheel=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels`,{name:'Défi',price:0,icon:'green-2',tone:'GOOD',gages:[{name:'Défi',handler:'BOARD_BATTLE',params:{count:2,spread:2}}]})).body as WheelType;
  const r=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheels/${wheel.id}/spin`,{ownerId:ben.id})).body as WheelResolution;
  const applied=(await as(admin.id).post(`/api/lobbies/${lobby.id}/wheel-resolutions/${r.id}/apply`,{})).body as WheelResolution;
  assert.equal(applied.status,'SUCCESS',JSON.stringify(applied));
  assert.match(applied.result!,/Nouveau combat au tableau : DÉFI \(2 Pokémon/);
  const drawn=((await as(ben.id).get(board)).body as BoardSnapshot).teams[0]!;
  assert.equal(drawn.origin,'WHEEL');assert.equal(drawn.status,'OPEN');
  assert.ok(drawn.party.every(m=>m.level>=10&&m.level<=14),JSON.stringify(drawn.party));
 }finally{for(const c of closers)c();await p.close();}
});

test('Tableau des combats: lost confirmation of the reward = to check; the admin says applied (paid) or not (paid again)',async()=>{
 const p=await passivePortal();
 const closers:(()=>void)[]=[];
 try{
  const {as,admin,tim,lobby,base,portal}=p;
  const board=`/api/lobbies/${lobby.id}/board`;
  const team=async(id:string)=>((await as(tim.id).get(board)).body as BoardSnapshot).teams.find(t=>t.id===id)!;
  const game=await FakeGameClient.connect({base,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Tim',battles:true,money:1000,party:[encodePokemon(template(255,20,'POUSSIFEU'))]});closers.push(()=>game.close());
  await until(()=>!!portal.services.currentGame.resolve(lobby.id,tim.id).game.money,'game');
  await as(admin.id).post(`/api/lobbies/${lobby.id}/runs`,{accountId:tim.id,start:true});
  const fight=async(reward:number)=>{
   const t=(await as(admin.id).post(board,{slots:[{mode:'RANDOM',minLevel:5,maxLevel:5}],reward})).body as BoardTeam;
   await as(tim.id).post(`${board}/${t.id}/challenge`);
   await until(()=>game.battle.active!==null,'armed');
   game.mode='timeout';// the money command is never confirmed
   game.battleStarted();game.endBattle('WIN');
   await eventually(async()=>(await team(t.id)).rewardStatus==='REVIEW','to check');
   game.mode='apply';
   return t;
  };
  const resolve=async(t:BoardTeam,applied:boolean)=>{
   const commandId=game.received.filter(c=>c.command==='game.money.add').at(-1)!.commandId;
   assert.equal((await as(admin.id).post(`/api/lobbies/${lobby.id}/game-commands/${commandId}/resolve`,{applied})).body.status,applied?'RESOLVED_APPLIED':'RESOLVED_NOT_APPLIED');
  };
  // Checked in the game: the money arrived.
  const first=await fight(300);
  await resolve(first,true);
  assert.equal((await team(first.id)).rewardStatus,'PAID');
  // Checked in the game: it did not arrive, so it is paid again on the next observation.
  const second=await fight(400);
  const before=game.money;
  await resolve(second,false);
  game.step();
  await eventually(async()=>(await team(second.id)).rewardStatus==='PAID','paid again');
  assert.equal(game.money,before+400);
 }finally{for(const c of closers)c();await p.close();}
});
