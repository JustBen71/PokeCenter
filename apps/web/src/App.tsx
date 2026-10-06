import {useState} from 'react';
import {Save,Trash2} from 'lucide-react';
import {ToastProvider} from './components/Toasts';
import {useToast} from './components/toast-context';
import {SessionProvider} from './auth/SessionProvider';
import {useSession} from './auth/session-context';
import {LobbyProvider} from './lobby/LobbyProvider';
import {LiveDataProvider} from './realtime/LiveData';
import {useLive,useLiveTopic} from './realtime/live-context';
import type {ObjectivesSnapshot} from '@pokerace/shared';
import {Shell} from './app/Shell';
import {ErrorBoundary} from './components/ErrorBoundary';
import {useRoute} from './app/use-route';
import {CoursePage} from './course/CoursePage';
import type {CourseRow} from './course/course-model';
import {PokemonSheet} from './pokemon/PokemonSheet';
import {api} from './api/client';
import {useLobby} from './lobby/lobby-context';
import {confirmOutOfBattle,nativeCan,partyAction} from './pokemon/game-actions';
import {AuctionsPage} from './auctions/AuctionsPage';
import {WheelOverlay} from './wheels/WheelOverlay';
import {WheelsAdminPage} from './wheels/WheelsAdminPage';
import {Progressions} from './Progressions';
import {PokemonLibrary,type Capture} from './PokemonLibrary';
import {ManagementPage} from './admin/ManagementPage';
import {BankPage} from './bank/BankPage';
import {ShopPage} from './shop/ShopPage';
import {JackpotPage} from './jackpot/JackpotPage';
import {LogsPage} from './audit/LogsPage';
import {PassivesPage} from './passives/PassivesPage';
import {PassiveSelection} from './passives/PassiveSelection';
import {nativeActionUnavailable} from './native-clients';

export function App(){
 return <ErrorBoundary><ToastProvider><SessionProvider><LobbyProvider><LiveDataProvider><ErrorBoundary><Portal/></ErrorBoundary></LiveDataProvider></LobbyProvider></SessionProvider></ToastProvider></ErrorBoundary>;
}

type Sheet={row:CourseRow;slot:number};

function MapRoute(){
 const {views}=useLive();
 const lobbyObjectives=useLiveTopic<ObjectivesSnapshot>('objectives',{objectives:[],completions:[]});
 return <Progressions players={views.map(v=>v.display)} lobbyObjectives={lobbyObjectives}/>;
}

function Portal(){
 const route=useRoute();const {account}=useSession();const {lobby}=useLobby();const {views,players}=useLive();const toast=useToast();
 const [capture,setCapture]=useState<Capture|null>(null),[sheet,setSheet]=useState<Sheet|null>(null),[busy,setBusy]=useState(false);
 // The sheet follows live data: it closes by itself if the Pokémon leaves the team.
 const pokemon=sheet?views.find(v=>v.accountId===sheet.row.accountId)?.display.state.party.find(p=>p.slot===sheet.slot):undefined;
 const sheetView=sheet&&views.find(v=>v.accountId===sheet.row.accountId);
 const nativeRemove=nativeCan(sheetView??undefined,'pokemon.remove');
 const removePokemon=async()=>{
  if(!sheet||!pokemon?.raw||!confirmOutOfBattle(sheet.row.name,`Retirer ${pokemon.nickname||pokemon.speciesName} de l’équipe de ${sheet.row.name} ?`))return;
  setBusy(true);
  try{
   if(nativeRemove)await partyAction(lobby.id,sheet.row.accountId,{action:'remove',slot:pokemon.slot});
   else await api('/api/pokemon',{method:'POST',body:{action:'remove',playerId:sheetView!.display.playerId,slot:pokemon.slot,raw:pokemon.raw}});
   toast.success('Suppression confirmée par le jeu. Sauvegardez dans le jeu pour la conserver.');setSheet(null);
  }catch(e){toast.error(e);}finally{setBusy(false);}
 };
 return <Shell route={route}>
  {route==='course'&&<CoursePage onPokemon={(row,p)=>setSheet({row,slot:p.slot})}/>}
  {route==='map'&&<MapRoute/>}
  {route==='passives'&&<PassivesPage/>}
  {route==='auctions'&&<AuctionsPage/>}
  {route==='wheels'&&<WheelsAdminPage/>}
  {route==='shop'&&<ShopPage/>}
  {route==='bank'&&<BankPage/>}
  {route==='jackpot'&&<JackpotPage/>}
  {route==='management'&&<ManagementPage/>}
  {route==='logs'&&<LogsPage/>}
  {route==='library'&&<PokemonLibrary capture={capture} clearCapture={()=>setCapture(null)}/>}
  <WheelOverlay/>
  <PassiveSelection/>
  {sheet&&pokemon&&<PokemonSheet pokemon={pokemon} owner={sheet.row.name} onClose={()=>setSheet(null)} actions={account.admin?[
   {label:'Sauvegarder dans la bibliothèque',icon:<Save size={15}/>,disabled:!pokemon.raw,title:pokemon.raw?undefined:nativeActionUnavailable,
    onClick:()=>{setCapture({pokemon:structuredClone(pokemon),source:sheet.row.name,capturedAt:sheetView?.display.state.observedAt??new Date().toISOString()});setSheet(null);window.location.hash='/bibliotheque';}},
   {label:'Retirer de l’équipe',icon:<Trash2 size={15}/>,danger:true,disabled:busy||!pokemon.raw||!(nativeRemove||sheetView?.legacyActionsAvailable)||(sheetView?.display.state.party.length??0)<2,
    title:nativeRemove||sheetView?.legacyActionsAvailable?undefined:'Le jeu de ce joueur ne permet pas cette écriture',onClick:()=>void removePokemon()}
  ]:[]}/>}
 </Shell>;
}
