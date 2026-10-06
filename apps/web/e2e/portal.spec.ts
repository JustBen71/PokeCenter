import {test,expect,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {FakeGameClient,rawPokemon,until} from '../../api/test/support/fake-game-client.ts';

// One lobby lived through end to end, in order: each scenario builds on the previous one.
// Real browser + built Web + real API/SQLite/Socket.IO; the game is the Fake Game Client.
test.describe.configure({mode:'serial'});

const API=`http://127.0.0.1:${process.env.E2E_API_PORT}`;
const n=(value:number)=>new RegExp(value.toLocaleString('fr-FR').replace(/\s/g,'\\s')); // "12 000" uses a narrow no-break space
const state={adminId:'',playerId:'',lobbyId:'',inviteCode:'',protectionPrice:0};
let admin:{context:BrowserContext;page:Page},player:{context:BrowserContext;page:Page},game:FakeGameClient;

async function open(browser:Browser){
 const context=await browser.newContext();const page=await context.newPage();
 page.on('dialog',dialog=>void dialog.accept()); // window.confirm of purchases, closing an auction…
 await page.goto('/');
 return {context,page};
}
async function apiAs(accountId:string,method:'GET'|'POST'|'PATCH',path:string,body?:unknown){
 const response=await fetch(API+path,{method,headers:{'content-type':'application/json','x-account-id':accountId},body:body===undefined?undefined:JSON.stringify(body)});
 const json=await response.json();
 if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
 return json;
}
async function createAccount(page:Page,name:string,avatar:string,isAdmin:boolean){
 const create=page.getByRole('button',{name:'Créer un compte'});
 await expect(page.getByRole('heading',{name:/Nouveau dresseur|Qui es-tu/})).toBeVisible();
 if(await create.isVisible())await create.click();
 await page.getByLabel('Nom').fill(name);
 await page.getByRole('radiogroup',{name:'Avatar'}).getByText(avatar,{exact:true}).click();
 if(isAdmin)await page.getByLabel('Administrateur').check();
 await page.getByRole('button',{name:'Créer et entrer'}).click();
 await expect(page.getByRole('heading',{name:'Choisis ta course.'})).toBeVisible();
 const accounts=await (await fetch(`${API}/api/accounts`)).json() as {id:string;name:string}[];
 return accounts.find(a=>a.name===name)!.id;
}
const card=(page:Page,name:string)=>page.locator('.course-card').filter({has:page.getByRole('button',{name:`Détails de ${name}`})});
const toast=(page:Page,text:string|RegExp)=>expect(page.locator('.toast').filter({hasText:text}).first()).toBeVisible();

test.afterAll(async()=>{game?.close();await admin?.context.close();await player?.context.close();});

test('1 · compte admin, avatar, création et entrée dans un lobby',async({browser})=>{
 admin=await open(browser);const {page}=admin;
 state.adminId=await createAccount(page,'Admin','Flora',true);
 await expect(page.locator('.profile-button')).toContainText('Admin');
 await page.getByLabel('Nom du lobby').fill('Course E2E');
 await page.getByRole('button',{name:'Créer',exact:true}).click();
 await toast(page,'Lobby « Course E2E » créé');
 const lobbyCard=page.locator('.lobby-card').filter({hasText:'Course E2E'});
 state.inviteCode=(await lobbyCard.locator('.code-line code').textContent())!.trim();
 expect(state.inviteCode).toMatch(/^\w{4,}$/);
 await lobbyCard.getByRole('button',{name:/Entrer/}).click();
 // Header: lobby, profile with role; sidebar: admin section and the active lobby code.
 await expect(page.locator('.brand')).toContainText('Course E2E');
 await expect(page.locator('.profile-button')).toContainText('Administrateur');
 await expect(page.locator('.profile-button img')).toHaveAttribute('src','/trainers/may.svg');
 const nav=page.getByRole('navigation',{name:'Menu principal'});
 await expect(nav).toContainText('ADMIN');
 for(const link of ['Gestion','Roues','Logs'])await expect(nav.getByRole('link',{name:link})).toBeVisible();
 await expect(nav.locator('.nav-code code')).toHaveText(state.inviteCode);
 await expect(page.getByRole('heading',{name:'Course',exact:true})).toBeVisible();
 const lobbies=await apiAs(state.adminId,'GET','/api/lobbies') as {id:string;name:string}[];
 state.lobbyId=lobbies.find(l=>l.name==='Course E2E')!.id;
});

test('2 · un joueur rejoint avec le code ; la Course affiche les deux comptes, avatars et Runs',async({browser})=>{
 player=await open(browser);const {page}=player;
 state.playerId=await createAccount(page,'Joueur','Red',false);
 await page.getByLabel('Code d’invitation').fill(state.inviteCode);
 await page.getByRole('button',{name:'Rejoindre'}).click();
 await expect(page.locator('.brand')).toContainText('Course E2E');
 await expect(page.locator('.profile-button')).toContainText('Joueur');
 await expect(page.getByRole('navigation',{name:'Menu principal'})).not.toContainText('ADMIN');
 for(const accountId of [state.adminId,state.playerId])await apiAs(state.adminId,'POST',`/api/lobbies/${state.lobbyId}/runs`,{accountId,start:true});
 for(const p of [admin.page,page])for(const [name,sprite] of [['Admin','may'],['Joueur','red']]){
  const row=card(p,name);
  await expect(row).toBeVisible();
  await expect(row.locator('.course-card-head img')).toHaveAttribute('src',`/trainers/${sprite}.svg`);
  await expect(row).toContainText(/Run #1 · En cours/);
 }
});

test('3 · Fake Game Client : Pokédollars, position, équipe, PV, niveau, surnom et état client',async()=>{
 const party=[rawPokemon(1,12,'BULBI'),rawPokemon(4,8,'SALA'),rawPokemon(7,5),rawPokemon(25,20,'PIKA'),rawPokemon(63,9,'ABRA')];
 game=await FakeGameClient.connect({base:API,lobbyId:state.lobbyId,inviteCode:state.inviteCode,playerName:'Joueur',money:12000,party,
  location:{mapGroup:0,mapNumber:16,label:'Route 101'},heartbeatMs:2000});
 expect(game.state().capabilities).toContain('money.write');
 await expect(player.page.locator('.profile .money')).toContainText(n(12000));
 const row=card(admin.page,'Joueur');
 await expect(row.locator('.client-pill')).toHaveText('En jeu');
 await expect(row).toContainText('Route 101');
 await expect(row.locator('.money-inline')).toContainText(n(12000));
 await expect(row.locator('.slot:not(.empty)')).toHaveCount(5);
 const bulbi=row.getByRole('button',{name:'Fiche de BULBI'});
 await expect(bulbi).toContainText('Bulbizarre');await expect(bulbi).toContainText('Niv. 12');await expect(bulbi).toContainText('20/20 PV');
 await expect(row.getByRole('button',{name:'Fiche de PIKA'})).toContainText('Niv. 20');
 await expect(card(admin.page,'Admin').locator('.client-pill')).toHaveText('Jamais connecté');
});

test('4 · banque : dépôt taxé, jackpot, retrait — confirmés par le jeu, double clic sans double débit',async()=>{
 const {page}=player;
 await page.goto('/#/banque');
 const tiles=page.locator('.money-tile');
 await expect(tiles.nth(0)).toContainText(n(12000));
 await page.getByLabel('Montant à déposer').fill('1000');
 await page.getByRole('button',{name:'Déposer'}).dblclick();
 await toast(page,/1\s000 ₽ déposés/);
 await expect(tiles.nth(1)).toContainText(n(900));
 await expect(tiles.nth(2)).toContainText(n(100));
 await expect(tiles.nth(0)).toContainText(n(11000));
 expect(game.money).toBe(11000);
 expect(game.received.filter(c=>c.command==='game.money.remove')).toHaveLength(1);
 await page.getByLabel('Montant à retirer').fill('500');
 await page.getByRole('button',{name:'Retirer'}).click();
 await toast(page,/500 ₽ retirés/);
 await expect(tiles.nth(1)).toContainText(n(400));
 await expect(tiles.nth(0)).toContainText(n(11500));
 expect(game.money).toBe(11500);
 await expect(page.locator('.profile .money')).toContainText(n(11500));
});

test('5 · boutique : création de roue, achat de ticket et de protection, file persistante',async()=>{
 const a=admin.page;
 await a.goto('/#/roues');
 await a.getByRole('button',{name:'Nouvelle roue'}).click();
 const editor=a.locator('form.wheel-editor');
 await editor.getByLabel('Nom').first().fill('Roue E2E');
 await editor.getByLabel('Prix ₽').fill('1000');
 await editor.locator('fieldset.gage-editor').getByLabel('Nom').fill('Danse de la victoire');
 await editor.getByRole('button',{name:'Ajouter un gage'}).click();
 await editor.locator('fieldset.gage-editor').nth(1).getByLabel('Nom').fill('Chanson du Bourg');
 await editor.getByRole('button',{name:'Enregistrer'}).click();
 await toast(a,'Roue créée');
 await expect(a.locator('.wheel-type').filter({hasText:'Roue E2E'})).toBeVisible();

 const p=player.page;
 state.protectionPrice=(await apiAs(state.adminId,'GET',`/api/lobbies/${state.lobbyId}/settings`)).protectionPrice;
 await p.goto('/#/boutique');
 const item=p.locator('.shop-item').filter({hasText:'Roue E2E'});
 await item.getByRole('button',{name:/1\s000 ₽/}).click();
 await p.getByRole('button',{name:/Payer 1\s000 ₽/}).dblclick();
 await toast(p,'Ticket « Roue E2E » acheté');
 const tickets=p.locator('.panel').filter({has:p.getByRole('heading',{name:'Mes tickets'})}).locator('li');
 await expect(tickets).toHaveCount(1);
 await expect(tickets.first()).toContainText('Roue E2E');
 await expect(p.locator('.profile .money')).toContainText(n(10500));
 expect(game.money).toBe(10500);

 await p.locator('.shop-item.protection').getByRole('button').dblclick();
 await toast(p,'Protection active');
 await expect.poll(async()=>(await apiAs(state.playerId,'GET',`/api/lobbies/${state.lobbyId}/shop`)).protections.length).toBe(1);
 await expect(p.locator('.shop-page .summary')).toContainText(/1\s*protection active/);
 expect(game.money).toBe(10500-state.protectionPrice);
 // The queue is server state: still there after a reload.
 await p.reload();
 await expect(tickets).toHaveCount(1);
 await expect(tickets.first()).toContainText(/En attente|Résolu/);
});

test('6 · roue : overlay gris, roulette verticale animée, résultat et notification pour tout le lobby',async()=>{
 const a=admin.page,p=player.page;
 await a.goto('/#/roues');
 await a.locator('.wheel-type').filter({hasText:'Roue E2E'}).getByRole('button',{name:'Lancer'}).click();
 await a.getByRole('button',{name:'Tourner'}).click();
 for(const page of [a,p]){
  const overlay=page.getByRole('dialog',{name:'Roue Roue E2E'});
  await expect(overlay).toBeVisible();
  await expect(page.locator('.wheel-overlay')).toHaveCSS('position','fixed');
  await expect(page.locator('.wheel-overlay')).toHaveCSS('background-color',/^rgba\(5, 6, 12, 0\.8\d*\)$/); // grey veil over the page
  await expect(overlay.locator('.wheel-strip li').first()).toBeVisible();
 }
 // The strip slides vertically for ~3 s, then stops on the gage drawn by the server.
 await expect(a.locator('.wheel-strip')).toHaveCSS('transform',/matrix\(1, 0, 0, 1, 0, -\d+/);
 for(const page of [a,p]){
  const result=page.locator('.wheel-result');
  await expect(result.getByRole('heading',{name:/Danse de la victoire|Chanson du Bourg/})).toBeVisible();
  await expect(page.locator('.wheel-strip li.winner')).toHaveCount(1);
 }
 await expect(a.locator('.wheel-result .outcome')).toContainText('✔');
 await a.locator('.wheel-result').getByRole('button',{name:'Fermer'}).click();
 await p.locator('.wheel-result').getByRole('button',{name:'Fermer'}).click();
 await expect(a.getByRole('dialog',{name:'Roue Roue E2E'})).toBeHidden();
});

test('7 · enchère : lot généré, mise de 1 ₽, clôture admin, achat accepté par le jeu',async()=>{
 const a=admin.page,p=player.page;
 const money=game.money,count=game.party.length;
 await a.goto('/#/encheres');
 await a.getByRole('button',{name:'Générer un lot'}).click();
 await toast(a,'Nouveau lot généré');
 await p.goto('/#/encheres');
 await expect(p.locator('.lot')).toBeVisible();
 await p.getByLabel('Montant de la mise').fill('1');
 await p.getByRole('button',{name:'Miser'}).dblclick();
 await toast(p,/Mise de 1 ₽ enregistrée/);
 const auctions=await apiAs(state.playerId,'GET',`/api/lobbies/${state.lobbyId}/auctions`) as {auctions:{status:string;bids:unknown[]}[]};
 expect(auctions.auctions.find(x=>x.status==='OPEN')!.bids).toHaveLength(1);
 await expect(a.locator('.lot .best')).toContainText('Joueur');
 await a.getByRole('button',{name:'Clôturer'}).click();
 await toast(a,'Enchère clôturée');
 await until(()=>game.received.some(c=>c.command==='pokemon.purchase'),'pokemon.purchase');
 expect(game.money).toBe(money-1);
 expect(game.party).toHaveLength(count+1);
 const history=a.locator('.auction-history');
 await expect(history).toContainText('Vendue');
 await expect(history).toContainText(/Joueur pour 1 ₽/);
 await a.goto('/#/course');
 await expect(card(a,'Joueur').locator('.slot:not(.empty)')).toHaveCount(count+1);
 await expect(card(a,'Joueur').locator('.money-inline')).toContainText(n(money-1));
});

test('8 · logs : les opérations effectuées sont journalisées',async()=>{
 const a=admin.page;
 await a.goto('/#/logs');
 await expect(a.getByRole('heading',{name:'Logs'})).toBeVisible();
 const list=a.locator('.log-list');
 await expect(list.locator('li').first()).toBeVisible();
 for(const action of ['lobby.create','lobby.join',/bank|BANK/,/shop|ticket/,/auction/,/wheel/])
  await expect(list).toContainText(action);
});

test('9 · ACK perdu puis reconnexion : REVIEW visible dans Gestion, jamais rejouée, le joueur repasse en ligne',async()=>{
 const a=admin.page,p=player.page,path=`/api/lobbies/${state.lobbyId}`;
 const reviews=async()=>await apiAs(state.adminId,'GET',`${path}/game-commands?status=REVIEW`) as {id:string}[];
 game.mode='ack-lost';
 await p.goto('/#/banque');
 await p.getByLabel('Montant à déposer').fill('100');
 await p.getByRole('button',{name:'Déposer'}).click();
 await expect(p.locator('.toast.error').first()).toBeVisible({timeout:15_000});
 const money=game.money; // the game did apply the deposit
 expect(await reviews()).toHaveLength(1);

 game.close();
 await a.goto('/#/course');
 await expect(card(a,'Joueur').locator('.client-pill')).not.toHaveText('En jeu');
 await expect(p.locator('.notice')).toContainText('Ton jeu doit être connecté');
 await expect(p.locator('.profile .money')).toContainText('—');

 game=await game.reconnect();
 await expect(card(a,'Joueur').locator('.client-pill')).toHaveText('En jeu');
 await expect(p.locator('.profile .money')).toContainText(n(money));
 await expect(p.locator('.notice')).toBeHidden();
 await p.getByLabel('Montant à déposer').fill('10');
 await expect(p.getByRole('button',{name:'Déposer'})).toBeEnabled();
 await new Promise(r=>setTimeout(r,1000));
 expect(game.received,'the REVIEW command is not replayed after reconnection').toHaveLength(0);
 expect(await reviews()).toHaveLength(1);

 await a.goto('/#/gestion');
 const panel=a.locator('.panel').filter({has:a.getByRole('heading',{name:'Opérations à vérifier'})});
 await expect(panel).toContainText('Retrait de Pokédollars');
 await expect(panel).toContainText('Joueur');
 await panel.getByRole('button',{name:'Appliquée',exact:true}).click();
 await toast(a,'Opération résolue');
 await expect(panel).toContainText('Aucune opération en attente');
 await expect(p.locator('.money-tile').nth(1)).toContainText(n(490));
});

test('10 · sans client connecté, les pages de consultation restent utilisables et les actions expliquent pourquoi',async()=>{
 const a=admin.page,p=player.page;
 game.close();
 for(const [hash,heading] of [['#/course','Course'],['#/carte','Progressions'],['#/jackpot','Jackpot'],['#/encheres','Enchères']] as const){
  await p.goto('/'+hash);
  await expect(p.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  await expect(p.getByText('Une erreur d’affichage est survenue')).toHaveCount(0);
 }
 await expect(p.locator('.auction-history')).toContainText('Vendue');
 await p.goto('/#/banque');
 await expect(p.locator('.notice')).toContainText('Ton jeu doit être connecté');
 await p.getByLabel('Montant à retirer').fill('10');
 await expect(p.getByRole('button',{name:'Retirer'})).toBeDisabled();
 await p.goto('/#/boutique');
 await expect(p.locator('.shop-page .notice')).toContainText('Ton jeu doit être connecté');
 await a.goto('/#/logs');
 await expect(a.locator('.log-list li').first()).toBeVisible();
 await expect(a.getByText('Une erreur d’affichage est survenue')).toHaveCount(0);
});
