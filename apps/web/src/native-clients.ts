import {nativeDisplayState,type PublicNativeClient,type PublicPlayer} from '@pokerace/shared';

export const nativeActionUnavailable="Cette action nécessite une version du client qui la prend en charge. Relancez le lanceur mis à jour pour activer les achats et la copie vers la bibliothèque.";
export const adapterLabels:Record<PublicNativeClient['adapter']['status'],string>={no_game:'Aucun jeu chargé',unsupported_system:'Système non pris en charge',unknown_rom:'ROM non reconnue',rom_identity_unavailable:'Identité de la ROM indisponible — utilisez le lanceur',profile_not_validated:'Profil non validé',memory_domain_unavailable:'Mémoire du jeu indisponible',ready:'Lecture du jeu active',read_error:'Lecture interrompue — nouvelle tentative automatique'};
export type PlayerViewModel={accountId:string;native?:PublicNativeClient;legacy?:PublicPlayer;display:PublicPlayer;source:'native'|'legacy'|'connection';legacyActionsAvailable:boolean};

// This conversion is only for read-only displays (teams/map). Action pages retain
// the original /agent collection and its IDs, raw copies and capabilities.
export function playerViews(players:PublicPlayer[],clients:PublicNativeClient[]):PlayerViewModel[]{
 const rows=new Map<string,{legacy?:PublicPlayer;native?:PublicNativeClient}>();
 for(const legacy of players)rows.set(legacy.account?.id??legacy.playerId,{legacy});
 for(const native of clients)rows.set(native.accountId,{...rows.get(native.accountId),native});
 return [...rows].map(([accountId,{legacy,native}])=>{
  const game=native?.ready&&native.bridge.connected&&native.bridge.gameLoaded&&native.adapter.status==='ready'?native.gameState:null;
  const source=game?'native':legacy?'legacy':'connection';
  const display:PublicPlayer=source==='legacy'?legacy!:{
   account:legacy?.account,playerId:accountId,connected:!!native?.ready,receivedAt:game?.observedAt??native!.lastSeenAt,lastSeenAt:native!.lastSeenAt,
   state:{protocolVersion:1,playerId:accountId,playerName:native!.playerName,
    ...(game?nativeDisplayState(game):{game:{name:'pokemon',language:null,profileId:null,romStatus:native!.bridge.gameLoaded?'unknown' as const:'missing' as const,revision:null,header:null},trainer:null,location:null,party:[],progression:null}),capabilities:[...(game?.capabilities??[]),...(native?.canPurchase?["auction-purchase-v1"]:[])],observedAt:game?.observedAt??native!.lastSeenAt,diagnostic:game?null:adapterLabels[native!.adapter.status]}
  };
  return {accountId,legacy,native,display,source,legacyActionsAvailable:legacy?.connected===true};
 });
}

// Native participants stay visible on action pages without enabling legacy commands.
export function readOnlyParticipants(views:PlayerViewModel[]):PublicPlayer[]{
 return views.filter(v=>v.native&&!v.legacyActionsAvailable).map(v=>v.display);
}
export function participantRoster(players:PublicPlayer[],readOnly:PublicPlayer[]):PublicPlayer[]{
 const ids=new Set(readOnly.map(p=>p.playerId));
 return [...players.filter(p=>!ids.has(p.playerId)),...readOnly];
}

export function purchaseParticipants(views:PlayerViewModel[]):PublicPlayer[]{
 return views.map(v=>v.legacyActionsAvailable?v.legacy!:v.display);
}
export function purchaseReadOnlyParticipants(views:PlayerViewModel[]):PublicPlayer[]{
 return views.filter(v=>v.native&&!v.legacyActionsAvailable&&!v.native.canPurchase).map(v=>v.display);
}
