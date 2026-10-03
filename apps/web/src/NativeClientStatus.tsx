import type {PublicNativeClient} from '@pokerace/shared';
import {adapterLabels,nativeActionUnavailable} from './native-clients';

export function NativeClientStatus({client,legacyActionsAvailable}:{client:PublicNativeClient;legacyActionsAvailable:boolean}){
 return <aside className="native-status" aria-label={`Client de ${client.playerName}`}>
  <strong>Client Pokérace · {client.playerName}</strong>
  <dl><div><dt>Client</dt><dd>{client.ready?'Connecté':'Connexion en cours'}</dd></div>
   <div><dt>BizHawk</dt><dd>{client.bridge.connected?'Connecté':'Déconnecté'}</dd></div>
   <div><dt>Jeu</dt><dd>{client.bridge.gameLoaded?'Chargé':'Absent'} · {client.system??'Système inconnu'}</dd></div>
   <div><dt>Lecture</dt><dd>{adapterLabels[client.adapter.status]}</dd></div>
   {client.adapter.profileId&&<div><dt>Profil</dt><dd>{client.adapter.profileId}</dd></div>}
   <div><dt>Version</dt><dd>{client.clientVersion??'—'} · {client.platform??'—'}</dd></div>
   <div><dt>Écritures locales</dt><dd>{client.allowMemoryWrites?'Autorisées dans les réglages':'Désactivées'}</dd></div>
  </dl>
  <small>L’adaptateur du jeu fonctionne uniquement en lecture.</small>
  {!legacyActionsAvailable&&<p className="native-action-notice">{nativeActionUnavailable}</p>}
 </aside>;
}
