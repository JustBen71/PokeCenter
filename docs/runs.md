# Lobbies, participations et Runs

```text
ACCOUNT ─ LOBBY ─ PARTICIPATION (lobby_members) ─ RUN #1, RUN #2, …
```

- **Account** : identité globale (`accounts`).
- **Lobby** : un événement (`lobbies`). Il a un code d'invitation unique, un statut (`OPEN`, `RUNNING`, `FINISHED`, `ARCHIVED`) et des paramètres (`lobby_settings`). Créer un lobby crée aussi ses paramètres par défaut et inscrit le créateur, dans une seule transaction.
- **Participation** : une ligne de `lobby_members`. Elle dure tout l'événement, même si le joueur perd plusieurs Runs. Rejoindre deux fois ne change rien et garde la première date d'adhésion.
- **Run** : une tentative. Les numéros sont propres à chaque joueur dans un lobby. Une nouvelle Run ne supprime jamais les précédentes.

## États d'une Run

```text
NOT_STARTED ──► RUNNING ──► LOST | COMPLETED | ABORTED
      └────────────────────► ABORTED
```

`LOST`, `COMPLETED` et `ABORTED` sont terminaux. `started_at` est fixé au passage à `RUNNING`, `ended_at` à l'entrée dans un état terminal.

Il y a au plus une Run `RUNNING` par joueur et par lobby. `RunService` le vérifie, et un index unique partiel l'impose aussi dans SQLite. Un conflit renvoie `RUN_ALREADY_RUNNING`.

La « Run courante » est la Run `RUNNING`. Sinon, c'est la dernière Run `NOT_STARTED`.

## Service

`apps/api/src/runs/run-service.ts` : `create(lobbyId, accountId, {start})`, `transition(id, status)`, `start(id)`, `current`, `running`, `history`, `listForLobby`.

Erreurs : `NOT_LOBBY_MEMBER`, `RUN_NOT_FOUND`, `RUN_ALREADY_RUNNING`, `INVALID_RUN_TRANSITION`.

## Routes (Sprint 2)

| Route | Accès | Effet |
|---|---|---|
| `GET /api/lobbies/:id/runs` | membre ou admin | Toutes les Runs du lobby |
| `POST /api/lobbies/:id/runs` | admin | `{accountId, start}` : nouvelle Run (démarrée ou non) |
| `POST /api/lobbies/:id/runs/:runId/status` | admin | `{status}` : transition validée |

Chaque changement est tracé dans l'audit (`RUN`) et poussé en temps réel sur le Socket.IO `/dashboard` du lobby (événement `runs`). Une adhésion ou une modification du lobby pousse l'événement `lobby`. Une page peut redemander un sujet avec `topic:get`.

## Page Course

- Une carte par participant, même sans jeu, classée par progression réelle (champion > Conseil 4 > badges > histoire). Les égalités partagent le même rang.
- Chaque carte affiche le rang, l'avatar, le nom, la Run et son statut, l'état du client (en jeu, client sans jeu lu, hors ligne avec dernières données, jamais connecté), la position, les Pokédollars et les 6 emplacements (sprite, nom, niveau, PV).
- Un clic sur le joueur ouvre un panneau latéral : partie, équipe, historique des Runs, actions admin, état du client natif.
- Un clic sur un Pokémon ouvre sa fiche (stats, IV/EV, attaques, nature, dresseur d'origine) à partir de la copie exacte. Les admins y trouvent la sauvegarde vers la bibliothèque.
