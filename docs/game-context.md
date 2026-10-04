# Contexte de jeu courant

`CurrentGameService` (`apps/api/src/game/current-game-service.ts`) résout, pour un lobby et un compte :

```text
account → Pokerace.Client connecté (/client du lobby) → bridge → jeu chargé → GameAdapter → capabilities → Run courante
```

`resolve(lobbyId, accountId)` renvoie un `GameContext` (contrat partagé dans `packages/shared/src/game.ts`) : état du client et du bridge, statut et capabilities de l'adaptateur, argent observé, fraîcheur de l'observation, Run courante. Le contexte ne contient **ni mémoire brute, ni copie de Pokémon, ni empreinte de ROM**.

`require(lobbyId, accountId, {capabilities, requireRun, requireFresh})` est l'appel à faire avant toute action qui modifie la partie. Il refuse dans cet ordre :

| Code | Cause |
|---|---|
| `LOBBY_NOT_FOUND` / `NOT_LOBBY_MEMBER` | Lobby inconnu ou compte non inscrit |
| `GAME_NOT_CONNECTED` | Pas de client prêt, bridge déconnecté ou aucun jeu chargé (`details.reason` = `client`, `bridge` ou `game`) |
| `GAME_ADAPTER_NOT_READY` | ROM inconnue, profil non validé, erreur de lecture… (`details.adapterStatus`) |
| `GAME_STATE_STALE` | Aucun signe de vie du client (heartbeat) depuis `offlineAfterMs`. Le client n'envoie `GAME_STATE` qu'à chaque changement : une observation ancienne d'un client vivant reste donc l'état courant (désactivable avec `requireFresh: false`) |
| `CAPABILITY_MISSING` | Capability absente (`details.missing`) |
| `RUN_NOT_RUNNING` | Pas de Run `RUNNING` (désactivable avec `requireRun: false`) |

Les capabilities viennent uniquement de l'adaptateur. On ne les déduit jamais du système émulé (`GBA`) ni de l'ancien drapeau `canPurchase`. Depuis le Sprint 3, le client natif annonce aussi les écritures (`money.write`, `pokemon.insert`…), à condition que le profil, le bridge et le réglage local le permettent (voir [commandes de jeu](game-commands.md)). Les préconditions vérifient l'état complet côté serveur (`requireState`). Les capabilities inconnues envoyées par un client plus récent sont ignorées.

Le service est construit par `createPortal` (`rooms.ts`) et exposé dans son retour (`currentGame`). Il lit l'état des clients natifs de chaque lobby, qui est gardé en mémoire.
