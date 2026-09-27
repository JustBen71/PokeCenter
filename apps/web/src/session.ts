export function apiFetch(input:string,init:RequestInit={}){
 const headers=new Headers(init.headers);const id=sessionStorage.getItem('pokerace-account');if(id)headers.set('x-account-id',id);
 return fetch(input,{...init,headers});
}
