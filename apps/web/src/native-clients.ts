import type {PublicNativeClient,PublicPlayer} from '@pokerace/shared';

export const nativeActionUnavailable="Cette action n'est pas encore disponible avec le nouveau client BizHawk.";
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
    game:{name:'pokemon-emerald',language:game?.game.language??null,profileId:game?.adapter.profileId??null,romStatus:game?'recognized':native!.bridge.gameLoaded?'unknown':'missing',revision:game?.game.revision??null,header:null},
    trainer:game?.trainer??null,location:game?.location??null,party:game?.party??[],progression:game?.progression??null,capabilities:game?.capabilities??[],observedAt:game?.observedAt??native!.lastSeenAt,diagnostic:game?null:adapterLabels[native!.adapter.status]}
  };
  return {accountId,legacy,native,display,source,legacyActionsAvailable:legacy?.connected===true};
 });
}
