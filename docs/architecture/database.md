# Base de données et migrations

Introduit au Sprint 0 du portail (voir `README_POKERACE_PORTAL_SPRINTS_CODEX.md`).

## Deux portées de base

| Portée | Fichier | Contenu |
|---|---|---|
| `portal` | `DATABASE_PATH` | Comptes, lobbies, membres (participations), paramètres, Runs, ledger, banque, jackpot, audit. Héberge aussi les données de course du lobby `legacy`. |
| `course` | `DATABASE_PATH.<lobbyId>.sqlite` | Données d'une course encore stockées en documents JSON : états `/agent`, bibliothèque, enchères, roulette. |

Les tables du domaine sont relationnelles, avec des clés étrangères et des contraintes `CHECK`. Une table de course passe dans la base centrale lorsque son sprint refait la fonctionnalité (bibliothèque au Sprint 3, enchères au Sprint 6, roues au Sprint 7).

`Store` (`apps/api/src/store.ts`) ouvre la base avec `openDatabase(path, scope)`. Sur la portée `portal`, `store.portal` expose `accounts`, `lobbies`, `runs`, `ledger` et `audit`. Une base `course` n'a pas de comptes : `rooms.ts` lui injecte les membres du lobby.

## Migrations

`apps/api/src/db/migrations.ts` contient la liste ordonnée des migrations. Chaque migration a un numéro, un nom et les portées concernées. Le runner :

- crée `schema_migrations(version, applied_at, name)` ;
- applique chaque migration manquante **dans sa propre transaction**, puis l'enregistre ;
- s'arrête à la première erreur : la base reste à la version précédente, sans état partiel.

| Version | Nom | Portées | Effet |
|---|---|---|---|
| 1 | `legacy-baseline` | portal, course | `player_states` (version déjà enregistrée par l'ancien store) |
| 2 | `course-feature-tables` | portal, course | Tables documents auparavant créées au premier usage |
| 3 | `accounts` | portal | `accounts` relationnelle ; convertit l'ancienne table `data_json` |
| 4 | `lobbies` | portal | `lobbies`, `lobby_members`, `lobby_settings` ; convertit l'ancienne table `rooms` |
| 5 | `runs` | portal | `runs` + index unique partiel « une seule Run RUNNING » |
| 6 | `money-ledger` | portal | `money_transactions`, `bank_accounts`, `jackpots` |
| 7 | `audit-logs` | portal | `audit_logs` |

Ajouter une migration = ajouter une entrée avec le numéro suivant. Ne jamais modifier une migration déjà livrée.

### Reprise d'une ancienne base

- Les comptes gardent leur `id`, leur nom, leur sprite et leur rôle. `createdAt` prend la date de la migration, car l'ancienne base ne la conservait pas.
- Les salons deviennent des lobbies avec le **même id** : le fichier de course et le chemin Socket.IO `/rooms/<id>/socket.io` ne changent pas. Le code devient `invite_code` et le statut `OPEN`.
- Un `ownerId` vide ou inconnu devient `created_by = NULL`. Un membre qui ne correspond à aucun compte est ignoré, car la clé étrangère le refuserait.
- Les anciennes tables `accounts` et `rooms` sont supprimées après la copie, dans la même transaction.

Sauvegarder la base avant la mise à jour, avec la précaution WAL décrite dans le README.

## Schéma

```text
accounts(id PK, name, name_key UNIQUE, avatar, is_admin, created_at, updated_at)
lobbies(id PK, name, invite_code UNIQUE, created_by → accounts, status OPEN|RUNNING|FINISHED|ARCHIVED, created_at, updated_at)
lobby_members(lobby_id → lobbies, account_id → accounts, joined_at)            PK(lobby_id, account_id)
lobby_settings(lobby_id PK → lobbies, bank_deposit_tax_percent, shop/auction/wheel_jackpot_percent, updated_at)
runs(id PK, (lobby_id, account_id) → lobby_members, number, status, started_at, ended_at, …)
     UNIQUE(lobby_id, account_id, number) ; UNIQUE(lobby_id, account_id) WHERE status = 'RUNNING'
bank_accounts((lobby_id, account_id) PK → lobby_members, balance ≥ 0)
jackpots(lobby_id PK → lobbies, balance ≥ 0)
money_transactions(id PK, lobby_id, account_id?, run_id?, type, amount > 0, source, destination ≠ source,
                   status, command_id?, idempotency_key UNIQUE?, created_at, updated_at, confirmed_at?, metadata_json)
audit_logs(id PK, timestamp, lobby_id?, actor_account_id?, target_account_id?, run_id?, category, action,
           status, command_id?, message, error_code?, metadata_json)
```

Le JSON est réservé aux métadonnées (`metadata_json`, validées par `json_valid`). Les relations sont des colonnes.

## Invariants garantis par la base

- Un nom de compte normalisé est unique.
- Un code d'invitation est unique.
- Il y a au plus une Run `RUNNING` par joueur et par lobby (index partiel), même si deux requêtes tombent en même temps.
- Les soldes banque et jackpot ne descendent jamais sous zéro (`CHECK`).
- Une Run, un compte bancaire ou une participation ne peut pas exister sans lobby ni membre.

## Codes d'erreur

Les contrats sont dans `packages/shared/src/errors.ts`, la classe `DomainError` et la correspondance HTTP dans `apps/api/src/errors.ts`. Le format de réponse est :

```json
{"ok": false, "error": {"code": "GAME_NOT_CONNECTED", "message": "…", "details": {}}}
```

Les erreurs inattendues sont renvoyées en `INTERNAL_ERROR`, sans détail technique. Les routes historiques renvoient encore `{error: string}` ; elles passeront au nouveau format quand leur sprint les reprendra.
