import {Gamepad2,Gavel,Landmark,Library,Map,ScrollText,Settings,ShoppingBag,Sparkles,Trophy,type LucideIcon} from 'lucide-react';

export type RouteId='course'|'map'|'auctions'|'shop'|'bank'|'jackpot'|'wheels'|'library'|'management'|'logs';
export type RouteDef={id:RouteId;hash:string;label:string;icon:LucideIcon;admin?:boolean};

// Pages are added here as their sprint lands; the admin section is hidden for players (the API still checks roles).
export const routes:RouteDef[]=[
 {id:'course',hash:'#/course',label:'Course',icon:Gamepad2},
 {id:'map',hash:'#/carte',label:'Carte',icon:Map},
 {id:'auctions',hash:'#/encheres',label:'Enchères',icon:Gavel},
 {id:'shop',hash:'#/boutique',label:'Boutique',icon:ShoppingBag},
 {id:'bank',hash:'#/banque',label:'Banque',icon:Landmark},
 {id:'jackpot',hash:'#/jackpot',label:'Jackpot',icon:Trophy},
 {id:'management',hash:'#/gestion',label:'Gestion',icon:Settings,admin:true},
 {id:'library',hash:'#/bibliotheque',label:'Bibliothèque',icon:Library,admin:true},
 {id:'wheels',hash:'#/roues',label:'Roues',icon:Sparkles,admin:true},
 {id:'logs',hash:'#/logs',label:'Logs',icon:ScrollText,admin:true}
];

// Older links (#/equipes, #/progressions) keep working.
const aliases:Record<string,RouteId>={'#/equipes':'course','#/progressions':'map','#/roulette':'wheels'};
export function routeFromHash(hash:string,admin:boolean):RouteId{
 const id=aliases[hash]??routes.find(r=>r.hash===hash)?.id??'course';
 const route=routes.find(r=>r.id===id)!;
 return route.admin&&!admin?'course':id;
}
