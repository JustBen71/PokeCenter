import {test,expect} from '@playwright/test';

// The profile dialogs open from the top bar but must sit inside the screen (desktop and phone).
const API=`http://127.0.0.1:${process.env.E2E_API_PORT}`;
const post=async(accountId:string,path:string,body:unknown)=>(await fetch(API+path,{method:'POST',headers:{'content-type':'application/json',...(accountId?{'x-account-id':accountId}:{})},body:JSON.stringify(body)})).json();

for(const [label,viewport] of [['ordinateur',{width:1400,height:900}],['téléphone',{width:390,height:760}]] as const)
 test(`P · « Changer d’avatar » reste dans l’écran (${label})`,async({browser})=>{
  const me=(await post('','/api/accounts',{name:`Avatar ${label}`,sprite:'may',admin:false})).id;
  const lobby=await post((await post('','/api/accounts',{name:`Arbitre ${label}`,sprite:'may',admin:true})).id,'/api/lobbies',{name:'Avatar E2E'});
  await post(me,'/api/lobbies/join',{code:lobby.inviteCode});
  const context=await browser.newContext({viewport});
  try{
   await context.addInitScript(([a,l])=>localStorage.setItem('pokerace-session',JSON.stringify({accountId:a,lobbyId:l})),[me,lobby.id]);
   const page=await context.newPage();
   await page.goto('/#/course');
   await page.locator('.profile-button').click();
   await page.getByRole('menuitem',{name:'Changer d’avatar'}).click();
   const dialog=page.getByRole('dialog',{name:'Changer d’avatar'});
   await expect(dialog).toBeVisible();
   const box=(await dialog.boundingBox())!;
   expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
   await page.getByRole('tab',{name:'Pokémon'}).click();
   await page.getByLabel('Rechercher un avatar Pokémon').fill('Poussifeu');
   await page.getByRole('radio').first().check();
   await expect(dialog.getByRole('button',{name:'Enregistrer'})).toBeInViewport();
   await dialog.getByRole('button',{name:'Enregistrer'}).click();
   await expect(page.locator('.toast').filter({hasText:'Profil mis à jour'})).toBeVisible();
   await page.screenshot({path:`test-results/avatar-${label}.png`});
  }finally{await context.close();}
 });
