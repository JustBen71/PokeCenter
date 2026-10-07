import {test,expect,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {FakeGameClient} from '../../api/test/support/fake-game-client.ts';

// Race passives lived end to end in a real browser: initial choice, live effect from the game,
// legendary won on a wheel, passive stolen. Real API/SQLite/Socket.IO; the games are Fake Game Clients.
test.describe.configure({mode:'serial'});

const API=`http://127.0.0.1:${process.env.E2E_API_PORT}`;
const ids={admin:'',lea:'',tom:'',lobby:'',code:''};
let admin:{context:BrowserContext;page:Page},lea:{context:BrowserContext;page:Page},tom:{context:BrowserContext;page:Page};
const games:FakeGameClient[]=[];

async function call<T=any>(accountId:string,method:'GET'|'POST'|'PATCH',path:string,body?:unknown):Promise<T>{
 const r=await fetch(API+path,{method,headers:{'content-type':'application/json',...(accountId?{'x-account-id':accountId}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const json=await r.json();if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);return json as T;
}
// A browser already signed in (same storage the portal writes) and inside the lobby.
async function open(browser:Browser,accountId:string){
 const context=await browser.newContext();
 await context.addInitScript(([a,l])=>localStorage.setItem('pokerace-session',JSON.stringify({accountId:a,lobbyId:l})),[accountId,ids.lobby]);
 const page=await context.newPage();page.on('dialog',d=>void d.accept());
 await page.goto('/');await expect(page.locator('.shell')).toBeVisible();
 return {context,page};
}
const card=(page:Page,name:string)=>page.locator('.course-card').filter({has:page.getByRole('button',{name:`Détails de ${name}`})});

test.beforeAll(async()=>{
 const account=(n:string,admin=false)=>call<{id:string}>('','POST','/api/accounts',{name:n,sprite:'may',admin}).then(a=>a.id);
 ids.admin=await account('Arbitre',true);ids.lea=await account('Léa');ids.tom=await account('Tom');
 const lobby=await call<{id:string;inviteCode:string}>(ids.admin,'POST','/api/lobbies',{name:'Passifs E2E'});
 ids.lobby=lobby.id;ids.code=lobby.inviteCode;
 for(const id of [ids.lea,ids.tom])await call(id,'POST','/api/lobbies/join',{code:ids.code});
 const base=API;
 for(const [playerName,playerId] of [['Léa','fake-lea'],['Tom','fake-tom']])games.push(await FakeGameClient.connect({base,lobbyId:ids.lobby,inviteCode:ids.code,playerName,playerId,money:5000,heartbeatMs:2000}));
 for(const id of [ids.lea,ids.tom])await call(ids.admin,'POST',`/api/lobbies/${ids.lobby}/runs`,{accountId:id,start:true});
});
test.afterAll(async()=>{for(const g of games)g.close();for(const s of [admin,lea,tom])await s?.context.close();});

test('P1 · sélection initiale : trois cartes privées, choix, départ, badge sous l’équipe, effet en direct',async({browser})=>{
 admin=await open(browser,ids.admin);lea=await open(browser,ids.lea);tom=await open(browser,ids.tom);
 await admin.page.goto('/#/gestion');
 await admin.page.getByRole('button',{name:'Lancer la course : sélection des passifs'}).click();
 // Each player sees exactly their own three cards.
 for(const s of [lea,tom,admin])await expect(s.page.locator('.passive-selection .passive-card')).toHaveCount(3);
 const leaCards=await lea.page.locator('.passive-selection .passive-card h3').allTextContents();
 const leaChoice=leaCards[0];
 for(const s of [lea,tom,admin]){await s.page.locator('.passive-selection .passive-card').first().getByRole('button',{name:'Choisir'}).click();await expect(s.page.locator('.passive-selection')).toHaveCount(0);}
 const panel=admin.page.locator('.passives-admin');
 await expect(panel.locator('.badge',{hasText:'A choisi'})).toHaveCount(3);
 await panel.getByRole('button',{name:'Démarrer la course'}).click();
 await expect(panel.locator('.badge',{hasText:'Course lancée'})).toBeVisible();
 // The chosen passive is public: under Léa's team for everyone, detail on click.
 await tom.page.goto('/#/course');
 const badge=card(tom.page,'Léa').locator('.passive-row .passive-badge',{hasText:leaChoice});
 await expect(badge).toBeVisible();
 await badge.click();await expect(tom.page.locator('.passive-dialog')).toContainText('Choix initial');
 await tom.page.keyboard.press('Escape');
 // A game event moves a passive live: Cartographe follows Léa's position.
 const owned=(await call(ids.admin,'GET',`/api/lobbies/${ids.lobby}/passives`)).owned as {accountId:string;passiveId:string}[];
 if(!owned.some(o=>o.accountId===ids.lea&&o.passiveId==='cartographer'))await call(ids.admin,'POST',`/api/lobbies/${ids.lobby}/passives/grant`,{accountId:ids.lea,passiveId:'cartographer'});
 await lea.page.goto('/#/passifs');
 const cartographer=lea.page.locator('.passive-facts',{hasText:'Cartographe'});
 await expect(cartographer).toBeVisible();
 games[0].location={mapGroup:0,mapNumber:16,label:'Route 101'};games[0].publish();
 await expect(cartographer).toContainText('1 lieu(x) découvert(s)');
 games[0].location={mapGroup:0,mapNumber:17,label:'Route 102'};games[0].publish();
 await expect(cartographer).toContainText('2 lieu(x) découvert(s)');
});

test('P2 · roue bienveillante PASSIVE_GRANT_RARITY(LEGENDARY) : animation, légendaire attribué, badge sous l’équipe',async()=>{
 // Tom's initial pick (P1, random cards) may already be legendary: the wheel adds one more.
 const legendaries=async()=>{const s=await call(ids.admin,'GET',`/api/lobbies/${ids.lobby}/passives`);
  return (s.owned as {accountId:string;passiveId:string}[]).filter(o=>o.accountId===ids.tom&&s.catalog.find((c:{id:string;rarity:string})=>c.id===o.passiveId)?.rarity==='LEGENDARY').length;};
 const before=await legendaries();
 await call(ids.admin,'POST',`/api/lobbies/${ids.lobby}/wheels`,{name:'Roue divine',price:0,icon:'green-5',tone:'GOOD',gages:[{name:'Passif légendaire',handler:'PASSIVE_GRANT_RARITY',params:{rarity:'LEGENDARY'}}]});
 const {page}=admin;
 await page.goto('/#/roues');
 await page.locator('.wheel-type').filter({hasText:'Roue divine'}).getByRole('button',{name:'Lancer',exact:true}).click();
 await page.getByLabel('Bénéficiaire').selectOption({label:'Tom'});
 await page.getByRole('button',{name:'Tourner'}).click();
 // Every viewer plays the same animation, then the result.
 await expect(tom.page.locator('.wheel-overlay')).toBeVisible();
 await expect(page.locator('.wheel-result .outcome')).toContainText(/Tom obtient le passif « .+ » \(Légendaire\)/,{timeout:15000});
 await page.locator('.wheel-result > .btn').click();await expect(page.locator('.wheel-overlay')).toHaveCount(0);
 await lea.page.goto('/#/course');
 await expect(card(lea.page,'Tom').locator('.passive-badge.legendary')).toHaveCount(before+1);
});

test('P3 · roue PASSIVE_STEAL : cible, choix du passif, transfert, badges des deux joueurs changés en direct',async()=>{
 const snapshot=await call(ids.admin,'GET',`/api/lobbies/${ids.lobby}/passives`);
 const legendary=(snapshot.owned as {accountId:string;passiveId:string}[]).find(o=>o.accountId===ids.tom&&snapshot.catalog.find((c:{id:string;rarity:string})=>c.id===o.passiveId)?.rarity==='LEGENDARY')!;
 const legendaryName=snapshot.catalog.find((c:{id:string})=>c.id===legendary.passiveId).name as string;
 await call(ids.admin,'POST',`/api/lobbies/${ids.lobby}/wheels`,{name:'Voleur',price:0,icon:'purple-5',tone:'BAD',gages:[{name:'Vol de passif',handler:'PASSIVE_STEAL',params:{}}]});
 const {page}=admin;
 for(const s of [lea,tom])await s.page.goto('/#/course');
 await expect(card(lea.page,'Tom').locator('.passive-badge',{hasText:legendaryName})).toBeVisible();
 await page.goto('/#/roues');
 await page.locator('.wheel-type').filter({hasText:'Voleur'}).getByRole('button',{name:'Lancer',exact:true}).click();
 await page.getByLabel('Bénéficiaire').selectOption({label:'Léa'});
 await page.getByRole('button',{name:'Tourner'}).click();
 const overlay=page.locator('.wheel-overlay');
 await overlay.getByLabel('Cible').selectOption({label:'Tom'},{timeout:15000});
 await overlay.getByLabel('Passif à voler').selectOption({label:legendaryName});
 await overlay.getByRole('button',{name:'Appliquer'}).click();
 await expect(page.locator('.wheel-result .outcome')).toContainText(`Léa vole « ${legendaryName} » à Tom`);
 // Both teams change at once for every viewer, with the notifications of the thief and the victim.
 await expect(card(tom.page,'Léa').locator('.passive-badge',{hasText:legendaryName})).toBeVisible();
 await expect(card(tom.page,'Tom').locator('.passive-badge',{hasText:legendaryName})).toHaveCount(0);
 await expect(tom.page.locator('.toast').filter({hasText:`Léa t’a volé « ${legendaryName} »`}).first()).toBeVisible();
 await expect(lea.page.locator('.toast').filter({hasText:`tu récupères « ${legendaryName} » de Tom`}).first()).toBeVisible();
});
