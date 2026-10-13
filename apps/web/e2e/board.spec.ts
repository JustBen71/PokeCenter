import {test,expect,type Browser} from '@playwright/test';
import {FakeGameClient} from '../../api/test/support/fake-game-client.ts';

// Tableau des combats in a real browser: the admin puts a team on the board, a player accepts it, the battle is fought
// in their (fake) game, the win pays the reward. Real API/SQLite/Socket.IO.
const API=`http://127.0.0.1:${process.env.E2E_API_PORT}`;
async function call<T=any>(accountId:string,method:'GET'|'POST',path:string,body?:unknown):Promise<T>{
 const r=await fetch(API+path,{method,headers:{'content-type':'application/json',...(accountId?{'x-account-id':accountId}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const json=await r.json();if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);return json as T;
}
async function open(browser:Browser,accountId:string,lobbyId:string){
 const context=await browser.newContext();
 await context.addInitScript(([a,l])=>localStorage.setItem('pokerace-session',JSON.stringify({accountId:a,lobbyId:l})),[accountId,lobbyId]);
 const page=await context.newPage();page.on('dialog',d=>void d.accept());
 await page.goto('/#/tableau');
 return {context,page};
}

test('T1 · Tableau des combats : équipe mise au tableau, défi accepté, combat gagné, récompense versée',async({browser})=>{
 const account=(n:string,admin=false)=>call<{id:string}>('','POST','/api/accounts',{name:n,sprite:'may',admin}).then(a=>a.id);
 const adminId=await account('Arbitre T',true),ninaId=await account('Nina T');
 const lobby=await call<{id:string;inviteCode:string}>(adminId,'POST','/api/lobbies',{name:'Tableau E2E'});
 await call(ninaId,'POST','/api/lobbies/join',{code:lobby.inviteCode});
 const game=await FakeGameClient.connect({base:API,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Nina T',playerId:'fake-nina-t',battles:true,money:1000,heartbeatMs:2000});
 await call(adminId,'POST',`/api/lobbies/${lobby.id}/runs`,{accountId:ninaId,start:true});
 const admin=await open(browser,adminId,lobby.id),player=await open(browser,ninaId,lobby.id);
 try{
  const form=admin.page.locator('.board-new');
  await form.getByLabel('Nom du dresseur').fill('ROXANE');
  await form.getByLabel('Apparence du dresseur').selectOption({label:'Mademoiselle'});
  await form.getByRole('button',{name:'Ajouter une place'}).click();
  await form.locator('.battle-slot').nth(1).getByLabel('Place').selectOption({label:'Pokémon choisi'});
  await form.getByRole('button',{name:'Mettre au tableau'}).click();
  const card=player.page.locator('.board-team').filter({hasText:'ROXANE'});
  await expect(card).toContainText('Disponible');
  await expect(card).toContainText('Pikachu');
  await expect(player.page.locator('.toast').filter({hasText:'Nouveau combat au tableau : ROXANE'}).first()).toBeVisible();
  const reward=Number((await card.locator('.board-reward').innerText()).replace(/\D/g,''));
  expect(reward).toBeGreaterThan(0);
  await expect(card.getByRole('button',{name:'Retirer'})).toHaveCount(0);// admin actions are not shown to players
  await card.getByRole('button',{name:'Affronter'}).click();
  await expect.poll(()=>game.battle.active).not.toBeNull();
  expect(game.battle.spec!.trainer.name).toBe('ROXANE');
  await expect(card).toContainText('Combat en cours');
  await expect(admin.page.locator('.board-team').filter({hasText:'ROXANE'})).toContainText('Nina T affronte cette équipe');
  game.battleStarted();game.endBattle('WIN');
  await expect(card).toContainText('Remportée par Nina T');
  await expect(card).toContainText('versée');
  await expect(player.page.locator('.toast').filter({hasText:'Nina T a vaincu ROXANE au tableau'}).first()).toBeVisible();
  expect(game.money).toBe(1000+reward);
 }finally{game.close();await admin.context.close();await player.context.close();}
});

test('T2 · Tableau des combats : génération en lot (popup), objets tenus, aveugle, attaques masquées',async({browser})=>{
 const account=(n:string,admin=false)=>call<{id:string}>('','POST','/api/accounts',{name:n,sprite:'may',admin}).then(a=>a.id);
 const adminId=await account('Arbitre L',true),ninaId=await account('Nina L');
 const lobby=await call<{id:string;inviteCode:string}>(adminId,'POST','/api/lobbies',{name:'Lot E2E'});
 await call(ninaId,'POST','/api/lobbies/join',{code:lobby.inviteCode});
 const game=await FakeGameClient.connect({base:API,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Nina L',playerId:'fake-nina-l',battles:true,money:1000,heartbeatMs:2000});
 await call(adminId,'POST',`/api/lobbies/${lobby.id}/runs`,{accountId:ninaId,start:true});
 const admin=await open(browser,adminId,lobby.id),player=await open(browser,ninaId,lobby.id);
 const shots=process.env.E2E_SHOTS;
 try{
  await admin.page.getByRole('button',{name:'Générer plusieurs combats…'}).click();
  const dialog=admin.page.locator('.board-dialog');
  await dialog.getByLabel('Nombre de combats').fill('6');
  await dialog.getByLabel('Niveau min').fill('10');
  await dialog.getByLabel('Niveau max').fill('20');
  await dialog.getByLabel('Écart ±').fill('2');
  await dialog.getByLabel('Part à l’aveugle (%)').fill('50');
  if(shots)await admin.page.screenshot({path:`${shots}/1-popup.png`,fullPage:true});
  await dialog.getByRole('button',{name:'Générer 6 combats'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(player.page.locator('.board-team')).toHaveCount(6);
  await expect(player.page.locator('.toast').filter({hasText:'6 nouveaux combats au tableau (niv. 10–20, dont 3 à l’aveugle)'}).first()).toBeVisible();
  // Player: 3 blind teams show only their average level; the others show held items, never moves.
  const blind=player.page.locator('.board-team').filter({hasText:'Équipe inconnue'});
  await expect(blind).toHaveCount(3);
  await expect(blind.first()).toContainText(/niveau moyen \d+/);
  await expect(blind.first().locator('.battle-team')).toHaveCount(0);
  await expect(player.page.locator('.board-team').filter({hasText:'Tient :'})).toHaveCount(3);
  await expect(player.page.getByText('Attaques (admin)')).toHaveCount(0);
  await expect(admin.page.getByText('Attaques (admin)')).toHaveCount(6);
  if(shots){await player.page.screenshot({path:`${shots}/2-joueur.png`,fullPage:true});await admin.page.screenshot({path:`${shots}/3-admin.png`,fullPage:true});}
  // A blind battle: the game gets the real party (with items), the team is revealed once won.
  const card=blind.first(),reward=Number((await card.locator('.board-reward').innerText()).replace(/\D/g,''));
  await card.getByRole('button',{name:'Affronter'}).click();
  await expect.poll(()=>game.battle.active).not.toBeNull();
  expect(game.battle.spec!.party.length).toBeGreaterThan(0);
  expect(game.battle.spec!.party.every(p=>p.heldItem>0&&p.moves.length>0)).toBe(true);
  game.battleStarted();game.endBattle('WIN');
  const won=player.page.locator('.board-team').filter({hasText:'Remportée par Nina L'});
  await expect(won).toContainText('versée');
  await expect(won.locator('.battle-team li')).toHaveCount(game.battle.spec!.party.length);
  expect(game.money).toBe(1000+reward);
  if(shots)await player.page.screenshot({path:`${shots}/4-revele.png`,fullPage:true});
 }finally{game.close();await admin.context.close();await player.context.close();}
});
