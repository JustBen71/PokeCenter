# Commandes de jeu (Sprint 3)

Toute modification d'une partie suit le même chemin :

```text
Fonctionnalité (enchère, banque, roue, admin…)
 → verrou du joueur (PLAYER_BUSY si une autre action est en cours)
 → CurrentGameService.requireState : client prêt, bridge, jeu, adaptateur, capability, Run RUNNING, état frais
 → GameCommandService.send : ligne game_commands (UUID) + commande métier sur /client
 → Pokerace.Client → Gen3Writes → bridge compareWrite → BizHawk
```

Le serveur ne connaît aucune adresse mémoire. Le navigateur n'envoie jamais de commande brute.

## Commandes métier du client natif

| Commande | Charge utile | Capability |
|---|---|---|
| `game.money.add` / `game.money.remove` | `{amount, expectedMoney}` | `money.write` |
| `game.money.set` | `{value, expectedMoney}` | `money.write` |
| `game.pokemon.insert` | `{raw, expectedCount}` | `pokemon.insert` |
| `game.pokemon.remove` | `{slot, expectedRaw, expectedCount}` | `pokemon.remove` |
| `game.pokemon.replace` | `{slot, expectedRaw, raw, expectedCount}` | `pokemon.replace` |
| `game.party.snapshot` | `{}` | lecture seule (réconciliation) |
| `pokemon.purchase` | inchangée (enchères existantes) | — |

Le client renvoie `{verified, money, partyCount, party[]}`.

**Préconditions.** Chaque écriture transporte ce que le serveur a observé : argent, nombre de Pokémon et les 100 octets exacts de l'emplacement visé. Le client relit le jeu et refuse avec `state_changed` si l'état ne correspond plus. Le bridge vérifie à nouveau, sur le thread de l'émulateur et dans le même appel : pointeurs des blocs, clé XOR, argent, équipe et compteur. Il écrit, relit tout et tente de restaurer en cas d'échec. Rejouer une commande déjà appliquée est donc refusé, même après un redémarrage du client qui aurait perdu le cache des UUID.

**Retrait.** Comme dans le jeu et dans l'ancien Lua, les Pokémon suivants remontent d'un emplacement, le dernier emplacement est mis à zéro et le compteur diminue. Retirer le dernier Pokémon est refusé.

**Capabilities.** Les écritures (`money.write`, `party.write`, `pokemon.insert/remove/replace`) ne sont annoncées que si trois conditions sont réunies : le profil ROM a `allowWrites: true` (actuellement BPEF v0 seulement), le bridge est transactionnel et `allowPokemonPurchases` est actif dans `client.json`. Ce réglage local coupe désormais **toutes** les écritures métier.

**Combat.** Aucun profil ne contient d'adresse validée indiquant un combat en cours, et aucune n'a été inventée. Toute modification de l'équipe exige donc `confirmOutOfBattle: true` : l'admin confirme que le joueur n'est pas en combat, sinon l'API répond `SAFE_STATE_REQUIRED`. Modifier l'argent est sans risque en combat.

## Issues d'une commande

| Statut | Signification | Ledger |
|---|---|---|
| `COMPLETED` | Le client a confirmé une écriture vérifiée | `CONFIRMED` (soldes serveur appliqués) |
| `FAILED` | Refus explicite avant écriture (`state_changed`, `party_full`, `writes_disabled`…) | `FAILED` |
| `REVIEW` | Délai dépassé, déconnexion, erreur de transport ou d'écriture : **résultat inconnu** | `REVIEW` |

Une commande `REVIEW` n'est jamais renvoyée. L'admin vérifie le jeu, puis la résout dans **Gestion → Opérations à vérifier** (`POST /api/lobbies/:id/game-commands/:commandId/resolve {applied}`). Les lignes de ledger liées passent alors en `CONFIRMED` ou en `FAILED`. Toutes les étapes sont tracées dans l'audit (`GAME_COMMAND`, `ADMIN`).

Codes d'erreur de l'API : `GAME_STATE_CHANGED`, `PARTY_FULL`, `LAST_POKEMON`, `INSUFFICIENT_FUNDS`, `WRITES_DISABLED`, `INVALID_POKEMON`, `GAME_COMMAND_FAILED`, `COMMAND_OUTCOME_UNKNOWN` (504), `PLAYER_BUSY`, `SAFE_STATE_REQUIRED` (428).

## Routes admin

- `POST /api/lobbies/:id/players/:accountId/pokemon` : `{action: insert|remove|replace, slot?, artifactId?, confirmOutOfBattle}`
- `POST /api/lobbies/:id/players/:accountId/money` : `{operation: add|remove, amount, reason?}`, enregistré en `ADMIN_ADJUSTMENT`
- `GET /api/lobbies/:id/game-commands?status=REVIEW`, `POST …/:commandId/resolve`

## Bibliothèque

Elle est **globale** (une seule pour tout le portail), réservée aux admins et indépendante des Runs : table `pokemon_artifacts`. Chaque entrée est un artefact versionné : `format`, `gameFamily`, `generation`, `species`, `display`, `payload`.

- `gen3-party-v1` : copie exacte des 100 octets ;
- `gen3-template-v1` : modèle du créateur, encodé au moment de l'insertion.

Une autre génération ajoutera un format plutôt que d'étirer la structure Gen III. Au premier démarrage, les anciennes bibliothèques de chaque lobby sont copiées **une seule fois** (`library_imports`), donc une suppression ultérieure n'est pas annulée.

Routes : `GET/POST /api/library`, `DELETE /api/library/:id` (admin).

## Tests

- Client C# (`GameWriteTests`) : mémoire synthétique et vrai `compareWrite` du bridge. Couvre l'argent, l'insertion, le retrait avec décalage, le remplacement, les refus et l'interrupteur local.
- API (`game-writes.test.ts`) avec le **Fake Game Client** (`apps/api/test/support/fake-game-client.ts`) : protocole `/client` réel, réponses appliquées, refusées, sans réponse ou à confirmation perdue.

Statuts : `UNIT_VERIFIED`, `FAKE_GAME_VERIFIED`. **`NOT_YET_VERIFIED` sur une vraie partie Émeraude dans BizHawk.**
