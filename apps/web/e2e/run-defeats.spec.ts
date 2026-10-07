import {test,expect,type Page} from '@playwright/test';
import {FakeGameClient,rawPokemon} from '../../api/test/support/fake-game-client.ts';

// End of Run decided by the game, in a real browser: a fallen Pokémon goes to the PC box, a blackout ends the Run,
// starts the next one and resets the game. Real API/SQLite/Socket.IO; the game is a Fake Game Client.
const API=`http://127.0.0.1:${process.env.E2E_API_PORT}`;
async function call<T=any>(accountId:string,method:'GET'|'POST',path:string,body?:unknown):Promise<T>{
 const r=await fetch(API+path,{method,headers:{'content-type':'application/json',...(accountId?{'x-account-id':accountId}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const json=await r.json();if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);return json as T;
}
const card=(page:Page,name:string)=>page.locator('.course-card').filter({has:page.getByRole('button',{name:`Détails de ${name}`})});

test('R1 · Pokémon tombé envoyé dans la boîte, blackout = Run perdue, Run suivante et jeu redémarré',async({browser})=>{
 const account=(n:string,admin=false)=>call<{id:string}>('','POST','/api/accounts',{name:n,sprite:'may',admin}).then(a=>a.id);
 const adminId=await account('Arbitre R',true),zoeId=await account('Zoé R');
 const lobby=await call<{id:string;inviteCode:string}>(adminId,'POST','/api/lobbies',{name:'Fin de Run E2E'});
 await call(zoeId,'POST','/api/lobbies/join',{code:lobby.inviteCode});
 const game=await FakeGameClient.connect({base:API,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Zoé R',playerId:'fake-zoe-r',defeats:true,heartbeatMs:2000,
  party:[rawPokemon(1,5,'PIOU'),rawPokemon(1,5,'BRINDILLE')]});
 const context=await browser.newContext();
 try{
  await context.addInitScript(([a,l])=>localStorage.setItem('pokerace-session',JSON.stringify({accountId:a,lobbyId:l})),[zoeId,lobby.id]);
  const page=await context.newPage();
  await page.goto('/#/course');
  await call(adminId,'POST',`/api/lobbies/${lobby.id}/runs`,{accountId:zoeId,start:true});
  await expect(card(page,'Zoé R')).toBeVisible();
  game.faint(2);
  await expect(page.locator('.toast').filter({hasText:'BRINDILLE (Bulbizarre, niv. 5) de Zoé R est tombé'}).first()).toBeVisible();
  await expect.poll(()=>game.box.length).toBe(1);
  await game.defeated('WHITE_OUT');
  await expect(page.locator('.toast').filter({hasText:'Zoé R a perdu sa Run #1'}).first()).toBeVisible();
  await expect.poll(()=>game.resets).toBe(1);
  await card(page,'Zoé R').getByRole('button',{name:'Détails de Zoé R'}).click();
  const drawer=page.locator('.drawer');
  await expect(drawer.locator('.run-history li').filter({hasText:'Run #2'})).toContainText('En cours');
  await expect(drawer.locator('.run-history li').filter({hasText:'Run #1'})).toContainText('Perdue');
  await expect(drawer.locator('.run-journal')).toContainText('Run #1 de Zoé R perdue dans le jeu');
  await expect(drawer.locator('.run-journal')).toContainText('BRINDILLE (Bulbizarre, niv. 5) de Zoé R est K.O. : envoyé dans la boîte 1');
  await expect(drawer.locator('.run-journal')).toContainText('redémarré sans sauvegarde');
 }finally{game.close();await context.close();}
});
