import {test,expect} from '@playwright/test';
import {FakeGameClient,rawPokemon} from '../../api/test/support/fake-game-client.ts';

// « Combat commandité » drawn by a player: he picks the player himself in the wheel window (or himself = mirror).
const API=`http://127.0.0.1:${process.env.E2E_API_PORT}`;
async function call<T=any>(accountId:string,method:'GET'|'POST',path:string,body?:unknown):Promise<T>{
 const r=await fetch(API+path,{method,headers:{'content-type':'application/json',...(accountId?{'x-account-id':accountId}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const json=await r.json();if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);return json as T;
}

test('W1 · Sacha tire « Combat commandité » et choisit lui-même le combattant (Claude, puis lui-même)',async({browser})=>{
 const account=(n:string,admin=false)=>call<{id:string}>('','POST','/api/accounts',{name:n,sprite:'may',admin}).then(a=>a.id);
 const adminId=await account('Arbitre W',true),sacha=await account('Sacha W'),claude=await account('Claude W');
 const lobby=await call<{id:string;inviteCode:string}>(adminId,'POST','/api/lobbies',{name:'Commandité E2E'});
 for(const id of [sacha,claude])await call(id,'POST','/api/lobbies/join',{code:lobby.inviteCode});
 const games=[await FakeGameClient.connect({base:API,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Sacha W',playerId:'fake-sacha-w',battles:true,heartbeatMs:2000,party:[rawPokemon(4,10),rawPokemon(7,12),rawPokemon(1,14)]}),
  await FakeGameClient.connect({base:API,lobbyId:lobby.id,inviteCode:lobby.inviteCode,playerName:'Claude W',playerId:'fake-claude-w',battles:true,heartbeatMs:2000,party:[rawPokemon(25,30),rawPokemon(6,32)]})];
 for(const id of [sacha,claude])await call(adminId,'POST',`/api/lobbies/${lobby.id}/runs`,{accountId:id,start:true});
 const wheel=await call<{id:string}>(adminId,'POST',`/api/lobbies/${lobby.id}/wheels`,{name:'Commandité',price:0,icon:'green-2',tone:'GOOD',
  gages:[{name:'Combat commandité',handler:'START_BATTLE',params:{builder:'OTHER_PLAYER',fighter:'TARGET',scaling:{mode:'MATCH_PLAYER_AVERAGE',delta:1}}}]});
 const context=await browser.newContext();
 try{
  await context.addInitScript(([a,l])=>localStorage.setItem('pokerace-session',JSON.stringify({accountId:a,lobbyId:l})),[sacha,lobby.id]);
  const page=await context.newPage();
  await page.goto('/#/course');await page.waitForTimeout(1500);
  for(const [who,id,label,levels] of [['Claude W',claude,'Sacha W','30 / 32 / 34'],['Sacha W',sacha,'Miroir','11 / 13 / 15']] as const){
   await call(adminId,'POST',`/api/lobbies/${lobby.id}/wheels/${wheel.id}/spin`,{ownerId:sacha});
   const overlay=page.getByRole('dialog',{name:'Roue Commandité'});
   await expect(overlay.getByLabel('Cible')).toBeVisible({timeout:10000});
   await expect(overlay.getByText('En attente de l’administrateur')).toHaveCount(0);
   await overlay.getByLabel('Cible').selectOption({label:who});
   await overlay.getByRole('button',{name:'Appliquer'}).click();
   await expect(overlay.locator('.outcome')).toContainText(`Combat lancé : ${who.split(' ')[0]}`);
   await expect(overlay.locator('.outcome')).toContainText(`niv. ${levels}`);
   const battle=(await call<{encounters:{accountId:string;sourceLabel:string;status:string;id:string}[]}>(adminId,'GET',`/api/lobbies/${lobby.id}/battles`)).encounters[0];
   expect(battle.accountId).toBe(id);expect(battle.sourceLabel).toContain(label.split(' ')[0]);
   await page.screenshot({path:`test-results/commandite-${who.split(' ')[0]}.png`});
   await call(adminId,'POST',`/api/lobbies/${lobby.id}/battles/${battle.id}/cancel`,{}).catch(()=>{});
   await overlay.getByRole('button',{name:'Fermer'}).click();
  }
 }finally{await context.close();for(const g of games)g.close();}
});
