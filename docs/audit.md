# Audit et logs (Sprint 11)

Toute action significative écrit une entrée `audit_logs` :

```text
id · timestamp · lobbyId? · actorAccountId? · targetAccountId? · runId? · category · action · status · commandId? · message · errorCode? · metadata
```

Catégories : `ACCOUNT`, `LOBBY`, `RUN`, `GAME_COMMAND`, `POKEMON`, `MONEY`, `BANK`, `JACKPOT`, `AUCTION`, `WHEEL`, `TICKET`, `PROTECTION`, `ADMIN`, `ERROR`. Statuts : `SUCCESS`, `FAILED`, `REVIEW`, `PENDING`, `INFO`.

**Jamais enregistré** : `sanitizeMetadata` remplace par `[redacted]` toute clé évoquant un jeton, un secret, un mot de passe, une copie brute, la mémoire ou une empreinte de ROM. Il tronque aussi les textes longs et limite la profondeur. Aucun `sessionToken`, `ADMIN_TOKEN`, secret du bridge ni dump mémoire n'entre dans le journal.

**Erreurs inattendues** : l'API répond toujours `INTERNAL_ERROR`, sans détail, et enregistre une entrée `ERROR` avec la route concernée.

## Page Logs (admin)

Filtres : joueur (acteur ou cible), catégorie, résultat (succès ou erreurs/vérifications), période, `commandId`. Le journal d'un lobby inclut aussi les événements globaux (comptes, rôles).

Une entrée ouverte montre :
- la commande de jeu liée (état, erreur du client, dates d'envoi et de mise à jour) ;
- les transactions du ledger portant le même `commandId` ;
- les autres entrées de cette commande ;
- l'erreur précise et les métadonnées nettoyées.

Routes (admin) :
- `GET /api/lobbies/:id/audit?accountId&category&outcome&commandId&from&to&limit` ;
- `GET /api/lobbies/:id/audit/:logId`.

Statut : `INTEGRATION_VERIFIED` (`audit.test.ts`).
