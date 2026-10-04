# Pokérace — architecture et reprise du projet

État documenté le **4 octobre 2026**, après la refonte du portail en sprints (`README_POKERACE_PORTAL_SPRINTS_CODEX.md`, sprints 0 à 11). Ce README est le point d'entrée pour reprendre le projet. Il décrit le comportement implémenté et ce qui a réellement été vérifié ; il ne prouve pas qu'une version est déployée sur le serveur des joueurs.

## 1. Finalité et état actuel

Pokérace est une plateforme d'événement auto-hébergée pour des courses Pokémon Émeraude entre amis. Chaque joueur utilise sa ROM et ses sauvegardes sur son ordinateur. Le portail suit les parties en direct et pilote les écritures en jeu via le client natif (C# + BizHawk) : enchères, banque, boutique de roues, gages, jackpot, objectifs récompensés.

```text
ACCOUNT ─ LOBBY ─ PARTICIPATION ─ RUN #1, #2…      (une seule Run RUNNING par joueur et par lobby)
```

| Fonction | Client natif C# + BizHawk | Agent historique Python + mGBA |
|---|---|---|
| Lancement Windows | `pokerace.cmd` | `player.cmd` |
| Lecture équipe, argent, position, progression | Oui (ROM reconnue, profil validé) | Oui |
| Écritures métier vérifiées (`game.money.*`, `game.pokemon.insert/remove/replace`, `pokemon.purchase`) | **Oui**, capabilities annoncées si le profil, le bridge et `client.json` l'autorisent | Non (anciennes commandes Lua seulement) |
| Banque, boutique, roues, jackpot, objectifs, enchères du portail | Oui | Non : aucune nouvelle dépendance métier n'est ajoutée à l'ancien pipeline |
| Retrait ou réinjection depuis la fiche ou la bibliothèque | Oui (commande native), sinon repli sur l'agent historique | Oui |

Un administrateur **reste un joueur**. Son rôle est déclaré à la création du compte ; ensuite, seul un admin peut le changer, et l'API vérifie toujours le rôle.

**Important.** Toutes les écritures sont `UNIT_VERIFIED` (mémoire synthétique, vrai `compareWrite` du bridge) et `FAKE_GAME_VERIFIED` (chaîne complète API → client simulé). Aucune n'est encore `REAL_BIZHAWK_VERIFIED` : **les valider manuellement sur une vraie partie Émeraude dans BizHawk avant l'événement** (voir §9).

## 2. Architecture

```text
Navigateur React ── REST + Socket.IO /dashboard (sujets temps réel par lobby)
        │
Caddy (prod) / proxy Vite (dev)
        │
API Express + Socket.IO
  ├─ Portail (base centrale SQLite, migrations versionnées)
  │    comptes · lobbies · Runs · objectifs · ledger/banque/jackpot · enchères · roues/gages
  │    tickets/protections · bibliothèque Pokémon · commandes de jeu · audit
  │    Services : CurrentGameService → GameCommandService → TransactionService (moteur d'argent)
  └─ Course de chaque lobby (createApp) : transports /client (natif) et /agent (historique),
       état des clients natifs en mémoire, anciennes données JSON par lobby

Pokerace.Client (C#) ─ Socket.IO /client ─ API
   └─ Gen3Writes / Gen3Transaction → TCP local → bridge BizHawk (compareWrite atomique) → mémoire du jeu
```

Le serveur ne connaît **aucune adresse mémoire** : il envoie des commandes métier avec les préconditions observées (argent, nombre de Pokémon, 100 octets exacts de l'emplacement visé). Le client relit le jeu et refuse si l'état a changé. Le bridge revérifie tout et écrit dans un seul tour de l'émulateur, puis relit.

## 3. Carte des dossiers

| Emplacement | Responsabilité |
|---|---|
| `apps/api/src/db/migrations.ts` | Migrations SQLite numérotées (portée `portal` ou `course`) |
| `apps/api/src/store.ts` | Ouverture de la base, `store.portal` (dépôts du domaine) et accès aux anciennes données de course |
| `apps/api/src/rooms.ts` | `createPortal` : composition, démarrage des courses, sujets temps réel, routes |
| `apps/api/src/services.ts` | Composition des services du portail |
| `apps/api/src/{accounts,lobbies,runs}/` | Comptes, lobbies et participations, Runs |
| `apps/api/src/game/` | `CurrentGameService` (contexte de jeu), `GameCommandService` (commandes, verrous, `REVIEW`), routes admin de jeu |
| `apps/api/src/money/` | Ledger, `TransactionService`, banque, jackpot |
| `apps/api/src/{objectives,auctions,wheels,shop,library,pokemon,audit}/` | Un dossier par domaine (service + routes) |
| `apps/api/src/realtime/lobby-events.ts` | Sujets Socket.IO par lobby (`runs`, `lobby`, `objectives`, `bank`, `jackpot`, `settings`, `auctions`, `wheels`, `shop`) et notifications |
| `apps/api/src/app.ts`, `native-clients.ts` | Course d'un lobby : `/client`, `/agent`, anciennes routes (compatibilité) |
| `apps/api/test/support/fake-game-client.ts` | **Fake Game Client** : client natif simulé (argent, équipe, progression, refus, délais, accusés perdus) |
| `apps/web/src/app/` | Coque (header, menu latéral responsive) et routes |
| `apps/web/src/{auth,lobby,realtime,api,components}/` | Session, lobbies, temps réel, client API (erreurs stables), toasts, icône ₽ |
| `apps/web/src/{course,map,pokemon,bank,jackpot,shop,auctions,wheels,admin,audit}/` | Une page ou un module par fonctionnalité |
| `packages/shared/src/` | Contrats Zod et types communs (erreurs, lobby, Run, argent, audit, capabilities, enchères, roues, boutique…) |
| `native/Pokerace.Client/src/.../Games/Pokemon/Gen3/` | Lecture (`Gen3GameAdapter`), écritures vérifiées (`Gen3Transaction`, `Gen3Writes`, `Gen3Purchase`) |
| `bridges/bizhawk/` | Bridge local (`compareWrite`), outil BizHawk, tests et E2E avec ROM homebrew |
| `emulator/profiles/` | Manifeste exact des ROM et profils mémoire (`allowWrites`). Ne jamais inventer d'adresse ni d'empreinte |
| `apps/web/public/tickets/` | Dix icônes de tickets locales (`scripts/generate-ticket-icons.mjs`) |
| `apps/agent/`, `emulator/lua/` | Ancien client mGBA, conservé pour compatibilité |

## 4. Comptes, lobbies, sessions

1. « Qui es-tu ? » : choisir son compte ou en créer un (nom, avatar dresseur ou Pokémon, admin oui/non).
2. Rejoindre un lobby **par code** ; un admin en crée et voit tous les lobbies.
3. Session : le compte et le lobby sont restaurés au rechargement (`sessionStorage` par onglet, `localStorage` pour un nouvel onglet), puis revalidés par l'API.
4. Le client de jeu envoie son pseudo et le code à `POST /api/rooms/resolve`, puis ouvre `/client` sur le transport du lobby.

L'`accountId` identifie le joueur ; le `playerId` natif identifie l'installation. Le rattachement se fait par le nom normalisé. Détails : [docs/lobbies.md](docs/lobbies.md).

## 5. Données

- **Base centrale** (`DATABASE_PATH`) : tout le domaine, en tables relationnelles avec clés étrangères et contraintes ; le JSON est réservé aux métadonnées et aux configurations validées. Les migrations s'appliquent automatiquement au démarrage, chacune dans sa transaction. Les anciennes tables `accounts` et `rooms` sont converties, et les anciennes bibliothèques de lobby copiées une seule fois.
- **Bases de course** (`DATABASE_PATH.<lobby>.sqlite`) : états `/agent` et anciennes données JSON (anciennes enchères et roulette), conservées pour compatibilité.
- **États des clients natifs** : en mémoire, republiés à la reconnexion.

Sauvegarder **toutes** les bases avant une mise à jour (cohérence SQLite/WAL : arrêt propre ou sauvegarde SQLite). Schéma et invariants : [docs/architecture/database.md](docs/architecture/database.md).

## 6. Argent et écritures en jeu

Toute opération d'argent passe par le **ledger** (`money_transactions`) et le **moteur** `TransactionService` :

```text
verrou joueur (+ verrou jackpot si besoin) → contexte de jeu frais (client, bridge, adaptateur, capability, Run RUNNING)
→ lignes PENDING → APPLYING → commande de jeu (commandId UUID, préconditions)
→ CONFIRMED (banque/jackpot appliqués dans la même transaction SQLite) | FAILED (jeu inchangé) | REVIEW (résultat inconnu)
```

Une commande `REVIEW` n'est **jamais rejouée** : un admin vérifie le jeu puis la résout dans Gestion → Opérations à vérifier. Les éléments liés suivent automatiquement (enchère, ticket, protection, récompense d'objectif). Chaque action de l'utilisateur porte une clé d'idempotence.

La position de combat n'étant lisible dans aucun profil validé, toute modification d'équipe exige que l'admin confirme que le joueur **n'est pas en combat**.

Détails : [commandes de jeu](docs/game-commands.md), [ledger](docs/money-ledger.md), [banque et jackpot](docs/bank-jackpot.md), [contexte de jeu](docs/game-context.md).

## 7. Fonctionnalités du portail

| Page | Qui | Résumé | Doc |
|---|---|---|---|
| Course | tous | Cartes joueur en direct (rang, Run, client, position, ₽, 6 Pokémon), panneau joueur, fiche Pokémon | [runs.md](docs/runs.md) |
| Carte | tous | Hoenn avec les avatars, classement, objectifs du lobby et récompenses | [objectives.md](docs/objectives.md) |
| Enchères | tous / admin | Lots générés, statistiques cachées (fourchettes), mises sûres, clôture payée en jeu | [auctions.md](docs/auctions.md) |
| Boutique | tous | Tickets de roue (cible si nécessaire), protections | [wheels.md](docs/wheels.md) |
| Banque | tous | Dépôt taxé (vers le jackpot), retrait ; la banque survit aux Runs | [bank-jackpot.md](docs/bank-jackpot.md) |
| Jackpot | tous | Montant, sources, mouvements ; ajustements admin | [bank-jackpot.md](docs/bank-jackpot.md) |
| Gestion | admin | Vue d'ensemble, roues en attente, opérations à vérifier, Runs, lobby, paramètres, protections, objectifs | [admin.md](docs/admin.md) |
| Bibliothèque | admin | Copies et modèles versionnés, créateur auto/manuel, ajout/remplacement en équipe | [game-commands.md](docs/game-commands.md) |
| Roues | admin | Types de roue, gages (handlers testés), lancement, overlay vertical ≈ 3 s | [wheels.md](docs/wheels.md) |
| Logs | admin | Audit filtrable (joueur, catégorie, résultat, dates, commandId), détail avec transactions et commande | [audit.md](docs/audit.md) |

Erreurs de l'API : `{ok:false,error:{code,message}}` avec des codes stables (`GAME_NOT_CONNECTED`, `CAPABILITY_MISSING`, `RUN_NOT_RUNNING`, `INSUFFICIENT_FUNDS`, `COMMAND_OUTCOME_UNKNOWN`…), affichés en notifications.

## 8. Lancer et reconstruire

### Serveur Docker

Prérequis : Node.js pour les scripts d'initialisation, Docker Engine et Compose v2. Les Dockerfiles utilisent Node 22.

```powershell
node scripts/init-server.mjs
cd deploy/server
docker compose up -d --build
```

Configuration : `deploy/server/.env`, à partir de `.env.example`. Variables principales : `DATABASE_PATH`, `CORS_ORIGIN`, `PUBLIC_DOMAIN`, `HTTP_PORT`, `HTTPS_PORT`, `ADMIN_TOKEN` et, pour la migration historique, `ROOM_CODE`. Caddy sert le front et reverse-proxy `/api/*`, `/rooms/*` et `/socket.io/*`. Le volume `pokerace_data` porte les bases. **Sauvegarder les bases avant de déployer cette version** : les migrations convertissent l'ancien schéma.

### Développement Web/API

```powershell
npm ci
npm run build
node --env-file=.player-runtime/dev.env --import tsx apps/api/src/index.ts   # API, port 3000
npm run dev:web                                                               # site, port 5173
```

`.player-runtime/dev.env` (ignoré par Git) contient `DATABASE_PATH`, `CORS_ORIGIN` et `PORT`. `.claude/launch.json` déclare les mêmes serveurs. Après une modification de `packages/shared`, reconstruire shared (`npm run build -w @pokerace/shared`).

### Client Windows BizHawk

Double-cliquer `pokerace.cmd`. Le script utilise `native/Pokerace.Client/artifacts/launcher-win-x64/Pokerace.Client.exe` (reconstruit le 4 octobre avec les écritures métier). **Un exécutable existant n'est pas reconstruit automatiquement** :

```powershell
./native/Pokerace.Client/tools/build-launcher.ps1
./pokerace.cmd --configure
```

`%LOCALAPPDATA%\Pokerace\client.json` : `allowPokemonPurchases` (vrai par défaut) autorise **toutes** les écritures métier ; `allowMemoryWrites` (faux par défaut) ne concerne que les écritures génériques de diagnostic.

### Client historique

`player.cmd` lance l'agent Python + mGBA/Lua (voir `docs/player-client.md`, `docs/autosave.md`). Il reste utilisable pour les anciennes fonctions, pas pour les nouvelles.

## 9. Vérifications

```powershell
npm run build
npm run typecheck
npm test
dotnet test native/Pokerace.Client/tests/Pokerace.Client.Tests/Pokerace.Client.Tests.csproj
dotnet test bridges/bizhawk/tests/Pokerace.BizHawkBridge.Tests/Pokerace.BizHawkBridge.Tests.csproj
python -m unittest discover -s tests
```

Résultats du 4 octobre 2026 : build et typecheck OK ; **101 tests npm** (11 shared, 67 API, 23 web) ; **119 tests** client C# ; **45 tests** bridge.

| Statut | Périmètre |
|---|---|
| `UNIT_VERIFIED` | Migrations, ledger, Runs, audit, écritures Gen III sur mémoire synthétique (vrai `compareWrite`) |
| `INTEGRATION_VERIFIED` | Permissions API, lobbies, temps réel, migration d'une ancienne base |
| `FAKE_GAME_VERIFIED` | Modifications d'équipe, corrections d'argent, banque, objectifs, enchères, roues, boutique, protections, jackpot, `REVIEW` |
| `MANUAL_VERIFIED` (navigateur) | Connexion, session, lobbies, Runs, toutes les pages, overlay des roues |
| `NOT_YET_VERIFIED` | **Toute écriture sur une vraie partie Émeraude dans BizHawk** ; rendu mobile détaillé ; déploiement du serveur |

**Recette manuelle conseillée avant l'événement** : sur une copie de sauvegarde, connecter le client reconstruit, puis vérifier dans l'ordre :
1. ajout et retrait d'argent par l'admin ;
2. dépôt et retrait en banque ;
3. achat d'un ticket ;
4. enchère à 1 ₽ ;
5. ajout, remplacement et retrait d'un Pokémon hors combat ;
6. sauvegarde en jeu puis relecture.

## 10. Limites et précautions

- **Authentification de confiance entre amis** : compte choisi dans une liste et en-tête `x-account-id`, sans mot de passe. Ne pas exposer le portail à un public hostile.
- **Combat** : non détecté (aucune adresse validée). La confirmation admin est obligatoire pour toucher à une équipe.
- **Vol entre deux joueurs** (`STEAL_MONEY`) : deux commandes successives ; si le crédit échoue après le débit, l'opération passe en `REVIEW` pour une correction manuelle.
- Les anciennes enchères et la roulette Lua restent dans les bases de course et ne sont pas importées dans le nouveau système.
- Profil anglais non validé ; écritures réservées aux profils `allowWrites: true` (BPEF v0).
- Le manifeste, les profils et les sauvegardes ne sont pas des caches. Ne jamais fabriquer une validation de ROM.
- Les modifications sont **locales et non commitées** au moment de cette documentation.

## 11. Documents

Cahier des charges de la refonte : `README_POKERACE_PORTAL_SPRINTS_CODEX.md`. Les autres `README_*_CODEX.md` et `README_Pokerace.md` sont des cahiers des charges historiques, pas une preuve de l'état courant.

Guides :
- [base de données](docs/architecture/database.md)
- [lobbies et connexion](docs/lobbies.md)
- [Runs et page Course](docs/runs.md)
- [contexte de jeu](docs/game-context.md)
- [commandes de jeu et bibliothèque](docs/game-commands.md)
- [objectifs](docs/objectives.md)
- [ledger](docs/money-ledger.md)
- [banque et jackpot](docs/bank-jackpot.md)
- [enchères](docs/auctions.md)
- [roues, boutique et protections](docs/wheels.md)
- [administration](docs/admin.md)
- [audit](docs/audit.md)
- [lanceur BizHawk](docs/bizhawk-launcher.md)
- [état natif](docs/native-game-state.md)
- [compatibilité ROM](docs/rom-compatibility.md)
- [nettoyage](docs/cleanup.md)
