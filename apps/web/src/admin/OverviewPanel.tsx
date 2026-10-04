import type {AuctionsSnapshot,JackpotSnapshot,ShopSnapshot,WheelsSnapshot} from '@pokerace/shared';
import {auctionStatusLabels} from '@pokerace/shared';
import {useLive,useLiveTopic} from '../realtime/live-context';
import {PokeDollar} from '../components/PokeDollar';

// At-a-glance state of the lobby with shortcuts to the dedicated admin pages.
export function OverviewPanel(){
 const {views}=useLive();
 const jackpot=useLiveTopic<JackpotSnapshot|null>('jackpot',null);
 const {auctions}=useLiveTopic<AuctionsSnapshot>('auctions',{auctions:[],generating:false});
 const shop=useLiveTopic<ShopSnapshot|null>('shop',null);
 const {resolutions}=useLiveTopic<WheelsSnapshot>('wheels',{wheels:[],resolutions:[]});
 const auction=auctions.find(a=>['OPEN','SETTLING','REVIEW'].includes(a.status));
 const pendingGages=resolutions.filter(r=>['DRAWN','AWAITING_CHOICE','REVIEW'].includes(r.status)).length;
 const tiles=[
  {label:'Joueurs en jeu',value:String(views.filter(v=>v.display.connected&&v.source==='native').length),href:'#/course'},
  {label:'Jackpot',value:jackpot?jackpot.balance.toLocaleString('fr-FR'):'—',money:true,href:'#/jackpot'},
  {label:'Enchère',value:auction?auctionStatusLabels[auction.status]:'Aucune',href:'#/encheres'},
  {label:'Roues en attente',value:String(shop?.queue.filter(t=>t.status==='QUEUED').length??0),href:'#/gestion'},
  {label:'Gages à finir',value:String(pendingGages),href:'#/roues'}
 ];
 return <section className="overview">{tiles.map(t=><a key={t.label} className="overview-tile" href={t.href}><small>{t.label}</small><strong>{t.money&&<PokeDollar size={18}/>}{t.value}</strong></a>)}</section>;
}
