import {test,expect,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {FakeGameClient} from '../../api/test/support/fake-game-client.ts';

// Commanded battles in a real browser: admin builder → preview → launch, and the START_BATTLE wheel gage.
// Real API/SQLite/Socket.IO; the games are Fake Game Clients announcing battle.trainer.start.
test.describe.configure({mode:'serial'});

const API=`http://127.0.0.1:${process.env.E2E_API_PORT}`;
const ids={admin:'',lea:'',tom:'',lobby:'',code:''};
let admin:{context:BrowserContext;page:Page},player:{context:BrowserContext;page:Page};
let lea:FakeGameClient,tom:FakeGameClient;

async function call<T=any>(accountId:string,method:'GET'|'POST',path:string,body?:unknown):Promise<T>{
 const r=await fetch(API+path,{method,headers:{'content-type':'application/json',...(accountId?{'x-account-id':accountId}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const json=await r.json();if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);return json as T;
}
async function open(browser:Browser,accountId:string){
 const context=await browser.newContext();
 await context.addInitScript(([a,l])=>localStorage.setItem('pokerace-session',JSON.stringify({accountId:a,lobbyId:l})),[accountId,ids.lobby]);
 const page=await context.newPage();page.on('dialog',d=>void d.accept());
 await page.goto('/');await expect(page.locator('.shell')).toBeVisible();
 return {context,page};
}
const card=(page:Page,name:string)=>page.locator('.course-card').filter({has:page.getByRole('button',{name:`Détails de ${name}`})});

test.beforeAll(async()=>{
 const account=(n:string,isAdmin=false)=>call<{id:string}>('','POST','/api/accounts',{name:n,sprite:'may',admin:isAdmin}).then(a=>a.id);
 ids.admin=await account('Arbitre B',true);ids.lea=await account('Léa B');ids.tom=await account('Tom B');
 const lobby=await call<{id:string;inviteCode:string}>(ids.admin,'POST','/api/lobbies',{name:'Combats E2E'});
 ids.lobby=lobby.id;ids.code=lobby.inviteCode;
 for(const id of [ids.lea,ids.tom])await call(id,'POST','/api/lobbies/join',{code:ids.code});
 lea=await FakeGameClient.connect({base:API,lobbyId:ids.lobby,inviteCode:ids.code,playerName:'Léa B',playerId:'fake-lea-b',battles:true,heartbeatMs:2000});
 tom=await FakeGameClient.connect({base:API,lobbyId:ids.lobby,inviteCode:ids.code,playerName:'Tom B',playerId:'fake-tom-b',battles:true,heartbeatMs:2000});
 for(const id of [ids.lea,ids.tom])await call(ids.admin,'POST',`/api/lobbies/${ids.lobby}/runs`,{accountId:id,start:true});
});
test.afterAll(async()=>{lea?.close();tom?.close();for(const s of [admin,player])await s?.context.close();});

test('C1 · Gestion → Combat commandité : Miroir, prévisualisation, lancement, combat suivi jusqu’à la victoire',async({browser})=>{
 admin=await open(browser,ids.admin);player=await open(browser,ids.lea);
 const {page}=admin;
 await page.goto('/#/gestion');
 const panel=page.locator('.battle-admin');
 await panel.getByLabel('Joueur qui combat').selectOption({label:'Léa B'});
 await panel.getByLabel('Équipe adverse').selectOption({label:'Miroir (sa propre équipe)'});
 await panel.getByLabel('Mode de niveaux').selectOption({label:'± N niveaux'});
 await panel.getByLabel('Écart de niveaux').fill('3');
 await panel.getByLabel('Apparence du dresseur').selectOption({label:'Topdresseuse'});
 await panel.getByRole('button',{name:'Prévisualiser'}).click();
 const preview=panel.locator('.battle-preview');
 await expect(preview).toContainText('LÉA B');await expect(preview).toContainText('niv. 8');// fake team: level 5, +3
 await preview.getByRole('button',{name:'Lancer le combat'}).click();
 // The fake game receives exactly the previewed battle, then the UI follows its lifecycle.
 await expect.poll(()=>lea.battle.active).not.toBeNull();
 expect(lea.battle.spec!.trainer).toEqual({name:'LÉA B',spriteId:'cooltrainer_f'});
 await player.page.goto('/#/course');
 await expect(card(player.page,'Léa B').locator('.battle-banner')).toContainText('Combat Pokérace VS LÉA B');
 lea.battleStarted();
 await expect(card(player.page,'Léa B').locator('.battle-banner')).toContainText('Combat en cours');
 lea.endBattle('WIN');
 await expect(card(player.page,'Léa B').locator('.battle-banner')).toHaveCount(0);
 await expect(panel.locator('.battle-list li').first()).toContainText('Victoire');
 await expect(player.page.locator('.toast').filter({hasText:'Victoire de Léa B contre LÉA B'}).first()).toBeVisible();
 await card(player.page,'Léa B').getByRole('button',{name:'Détails de Léa B'}).click();
 await expect(player.page.locator('.drawer')).toContainText('Combats commandités');
 await expect(player.page.locator('.drawer')).toContainText('VS LÉA B');
 await player.page.keyboard.press('Escape');
});

test('C2 · roue START_BATTLE (joueur choisi) : animation, combat créé dans le jeu du bénéficiaire, défaite affichée',async()=>{
 await call(ids.admin,'POST',`/api/lobbies/${ids.lobby}/wheels`,{name:'Duel de copies',price:0,icon:'purple-3',tone:'NEUTRAL',
  gages:[{name:'Affronte un joueur',handler:'START_BATTLE',params:{builder:'OTHER_PLAYER',scaling:{mode:'COPY_EXACT',delta:0}}}]});
 const {page}=admin;
 await page.goto('/#/roues');
 await page.locator('.wheel-type').filter({hasText:'Duel de copies'}).getByRole('button',{name:'Lancer',exact:true}).click();
 await page.getByLabel('Bénéficiaire').selectOption({label:'Tom B'});
 await page.getByRole('button',{name:'Tourner'}).click();
 const overlay=page.locator('.wheel-overlay');
 await expect(player.page.locator('.wheel-overlay')).toBeVisible();
 await overlay.getByLabel('Cible').selectOption({label:'Léa B'},{timeout:15000});
 await overlay.getByRole('button',{name:'Appliquer'}).click();
 await expect(overlay.locator('.outcome')).toContainText('Combat lancé : Tom B VS LÉA B');
 await expect.poll(()=>tom.battle.active).not.toBeNull();
 tom.battleStarted();
 await expect(overlay.locator('.battle-banner')).toContainText('Combat en cours');
 tom.endBattle('LOSS');
 await expect(overlay.locator('.battle-banner')).toContainText('❌ Défaite contre LÉA B');
});
