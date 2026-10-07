# Pokérace — architecture et reprise du projet

État documenté le **6 octobre 2026**, après la refonte du portail et le sprint de conformité (E2E BizHawk réparé, E2E navigateur, contrat `GAME_STATE` multi-génération). Ce README est le point d'entrée pour reprendre le projet. Il décrit le comportement implémenté et ce qui a réellement été vérifié ; il ne prouve pas qu'une version est déployée sur le serveur des joueurs.

## 1. Finalité et état actuel

Pokérace est une plateforme d'événement auto-hébergée pour des courses Pokémon Émeraude entre amis. Chaque joueur utilise sa ROM et ses sauvegardes sur son ordinateur. Le portail suit les parties en direct et pilote les écritures en jeu via le client natif (C# + BizHawk) : enchères, banque, boutique de roues, gages, jackpot, objectifs récompensés.

```text
ACCOUNT ─ LOBBY ─ PARTICIPATION ─ RUN #1, #2…      (une seule Run RUNNING par joueur et par lobby)
```

| Fonction | Client natif C# + BizHawk | Agent historique Python + mGBA |
|---|---|---|
| Lancement Windows / Linux | `pokerace.cmd` / `./pokerace.sh` | `player.cmd` |
| Lecture équipe, argent, position, progression | Oui (ROM reconnue, profil validé) | Oui |
| Écritures métier vérifiées (`game.money.*`, `game.pokemon.insert/remove/replace`, `pokemon.purchase`) | **Oui**, capabilities annoncées si le profil, le bridge et `client.json` l'autorisent | Non (anciennes commandes Lua seulement) |
| Banque, boutique, roues, jackpot, objectifs, enchères du portail | Oui | Non : aucune nouvelle dépendance métier n'est ajoutée à l'ancien pipeline |
| Retrait ou réinjection depuis la fiche ou la bibliothèque | Oui (commande native), sinon repli sur l'agent historique | Oui |

Un administrateur **reste un joueur**. Son rôle est déclaré à la création du compte ; ensuite, seul un admin peut le changer, et l'API vérifie toujours le rôle.

**Important.** Toutes les écritures sont `UNIT_VERIFIED` (mémoire synthétique, vrai `compareWrite` du bridge) et `FAKE_GAME_VERIFIED` (chaîne complète navigateur → API → client simulé). Aucune écriture Pokémon Émeraude n'est `REAL_BIZHAWK_VERIFIED` : l'E2E BizHawk prouve BizHawk, le bridge, la mémoire, le client et le transport sur une ROM homebrew NES, **pas** les offsets ni les structures d'Émeraude. **Les valider sur une vraie partie Émeraude avant l'événement** (procédure §9.4).

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

### Contrat `GAME_STATE` et générations futures

Le client envoie `gameStateVersion: 2`, un contrat **générique Gen I à IX** (`packages/shared/src/native-client.ts`) : identité du jeu (`generation`, `title`, `language`, `revision`), dresseur, position (`label` + champs propres au jeu), équipe et progression. Chaque Pokémon expose les champs communs (espèce, surnom, niveau, PV, chromatique) ; la copie exacte nécessaire aux écritures est un `artifact` versionné (`gen3-party-v1` aujourd'hui). Les fonctionnalités dépendent des **capabilities**, jamais de la génération. Le serveur accepte encore `gameStateVersion: 1` des anciens clients et le convertit. Seul l'adaptateur Gen III (Émeraude) existe ; des fixtures synthétiques Gen IV/V vérifient que shared, API et Web n'imposent plus Émeraude. La carte passe par une `GameMapDefinition` (`apps/web/src/map/game-maps.ts`) : seule Hoenn est enregistrée. Détails : [docs/native-game-state.md](docs/native-game-state.md).

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
| `apps/api/test/support/fake-game-client.ts` | **Fake Game Client** : client natif simulé (argent, équipe, position, progression, refus, délais, accusés perdus, heartbeat, reconnexion) |
| `apps/web/e2e/`, `apps/web/playwright.config.ts` | **E2E navigateur** Playwright : Web construit + API de test (SQLite jetable, lots d'enchère hors ligne) + Fake Game Client |
| `apps/web/src/app/` | Coque (header, menu latéral responsive) et routes |
| `apps/web/src/{auth,lobby,realtime,api,components}/` | Session, lobbies, temps réel, client API (erreurs stables), toasts, icône ₽ |
| `apps/web/src/{course,map,pokemon,bank,jackpot,shop,auctions,wheels,admin,audit}/` | Une page ou un module par fonctionnalité |
| `packages/shared/src/` | Contrats Zod et types communs (erreurs, lobby, Run, argent, audit, capabilities, enchères, roues, boutique…) |
| `native/Pokerace.Client/src/.../Games/Pokemon/Gen3/` | Lecture (`Gen3GameAdapter`), écritures vérifiées (`Gen3Transaction`, `Gen3Writes`, `Gen3Purchase`) |
| `bridges/bizhawk/` | Bridge local (`compareWrite`), outil BizHawk, tests et E2E avec ROM homebrew |
| `native/Pokerace.Client/tools/e2e-server.mjs` | Serveur de test du client (namespace `/client` de production, `/api/rooms/resolve`, `/health`, port dynamique) utilisé par l'E2E BizHawk et les tests .NET |
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
| Combats commandités | admin / tous | Vrai combat de dresseur dans la partie d'un joueur (Miroir, équipe d'un joueur, du #1, personnalisée), niveaux recalculés, lancé dès que le jeu est sur la carte ; gage de roue START_BATTLE | [battle-encounters.md](docs/battle-encounters.md) |
| Fin de Run en jeu | automatique | Toute défaite termine la Run et lance la suivante, le jeu redémarre sans sauvegarde (3 dernières parties archivées) ; chaque Pokémon K.O. part dans la boîte PC | [end-of-run.md](docs/end-of-run.md) |
| Passifs | tous / admin | Bonus permanents de course : choix initial parmi 3 cartes privées, badges sous chaque équipe, roues qui donnent ou volent un passif | [passives.md](docs/passives.md) |
| Carte | tous | Carte du jeu (Hoenn pour Émeraude) avec les avatars, classement ex æquo par objectifs, récompenses ; sans carte pour un autre jeu, positions dans le classement | [objectives.md](docs/objectives.md) |
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

Double-cliquer `pokerace.cmd`. Le script utilise `native/Pokerace.Client/artifacts/launcher-win-x64/Pokerace.Client.exe`. **Un exécutable existant n'est pas reconstruit automatiquement** : le reconstruire après cette version (elle envoie `gameStateVersion: 2`, le serveur accepte aussi l'ancien format) :

```powershell
./native/Pokerace.Client/tools/build-launcher.ps1
./pokerace.cmd
```

Adresse du serveur acceptée sous la forme `88.184.14.248`, `hôte:port`, `http://…` ou `https://…`. Un formulaire en console (serveur, port, pseudo, salon, ROM) reprend les valeurs précédentes ; une erreur de saisie ou de connexion ramène au champ à corriger sans relancer le programme. Sous Linux : `./pokerace.sh` (Mono requis). Pour donner le port directement : `pokerace.cmd 3000` ou `pokerace.cmd --port 3000` (le port du portail de dev est 3000, celui du Docker 8080 par défaut). Un échec de connexion affiche sa cause : adresse introuvable, connexion refusée, pas de réponse, salon refusé ou configuration invalide.

`%LOCALAPPDATA%\Pokerace\client.json` : `allowPokemonPurchases` (vrai par défaut) autorise **toutes** les écritures métier ; `allowMemoryWrites` (faux par défaut) ne concerne que les écritures génériques de diagnostic.

### Client historique

`player.cmd` lance l'agent Python + mGBA/Lua (voir `docs/player-client.md`, `docs/autosave.md`). Il reste utilisable pour les anciennes fonctions, pas pour les nouvelles.

## 9. Vérifications

### 9.1 Commandes

```bash
npm ci
npm run build
npm run typecheck
npm test                                    # shared + API + Web

npx playwright install --with-deps chromium  # une fois, depuis apps/web
npm run test:e2e -w @pokerace/web           # E2E navigateur (après npm run build)

dotnet restore native/Pokerace.Client/Pokerace.Client.sln
dotnet build native/Pokerace.Client/Pokerace.Client.sln --configuration Release --no-restore
dotnet test native/Pokerace.Client/Pokerace.Client.sln --configuration Release --no-build

# Bridge : la solution complète exige les assemblies BizHawk (Windows, e2e/prepare-bizhawk.ps1).
dotnet test bridges/bizhawk/tests/Pokerace.BizHawkBridge.Tests/Pokerace.BizHawkBridge.Tests.csproj --configuration Release

./bridges/bizhawk/e2e/run-e2e.ps1 -ClientE2E  # vrai BizHawk + ROM homebrew, runner GitHub Windows ou VM jetable (-DisposableCi)
```

L'E2E navigateur démarre lui-même l'API de test et `vite preview` sur des ports libres, attend `/health`, et arrête les processus même en cas d'échec. Il n'a besoin ni de ROM, ni de BizHawk, ni d'internet. Traces, captures et vidéos ne sont conservées qu'en cas d'échec (`apps/web/e2e-results`).

### 9.2 État CI actuel

Résultats obtenus le 6 octobre 2026 sur la branche `pokerace-client` (Linux x64, Node 22, .NET 8.0.425), à relire sur GitHub Actions pour le dernier commit poussé :

```text
Shared          PASS   17 tests
API             PASS   99 tests
Web             PASS   28 tests
Pokerace.Client PASS   178 tests
Bridge Unit     PASS   45 tests
Web E2E         PASS   15 scénarios Playwright (Chromium, dont 3 pour les passifs et 2 pour les combats commandités), exécutés localement ; workflow web-e2e.yml ajouté, pas encore exécuté sur GitHub
BizHawk E2E     NON CONFIRMÉ — correctif appliqué et vérifié contre un bridge simulé ; le workflow réel (Windows + BizHawk) doit être relancé
```

**Cause du BizHawk E2E rouge** (`server_timeout` puis `Client readiness timeout`) : depuis la découverte de salon, le client appelle `POST /api/rooms/resolve` avant le WebSocket ; le serveur de test (`http.createServer()` sans gestionnaire) ne répondait jamais à cette requête. Ce n'était ni le bridge, ni la normalisation d'adresse du lanceur. Le serveur de test répond désormais à toutes les requêtes ; la non-régression tourne sur les quatre OS du workflow client. Détails : [bridges/bizhawk/e2e/README.md](bridges/bizhawk/e2e/README.md).

Workflows : `pokerace-client.yml` (shared/API/Web + client sur Windows, Linux, macOS Intel et ARM), `bizhawk-bridge.yml` (tests du bridge puis E2E réel BizHawk, aussi déclenché par un push sur `pokerace-client`), `web-e2e.yml` (build, typecheck, tests, Playwright). Aucun n'utilise `continue-on-error`.

### 9.3 Niveaux de validation

| Statut | Périmètre |
|---|---|
| `UNIT_VERIFIED` | Migrations, ledger, Runs, audit, contrat `GAME_STATE` v1/v2 et fixtures Gen III/IV/V, normalisation d'adresse serveur et causes d'erreur du lanceur, écritures Gen III sur mémoire synthétique (vrai `compareWrite`) |
| `INTEGRATION_VERIFIED` | Permissions serveur (création de lobby, paramètres, logs, bibliothèque, roues, clôture d'enchère, banque et mises pour autrui), projections envoyées au navigateur sans secret ni adresse mémoire, stats cachées d'une enchère ouverte, lobbies, temps réel, migration d'une ancienne base ; vrai client .NET contre le serveur de test sur port dynamique |
| `FAKE_GAME_VERIFIED` | Navigateur réel (Playwright) : compte, avatar, lobby, deux joueurs, Course, état du jeu, banque, boutique, roue, enchère, logs, double clics, ACK perdu → `REVIEW` résolue dans Gestion sans rejeu, reconnexion, portail sans client. API : équipe, argent, objectifs, roues, jackpot, `REVIEW` après écriture réelle à ACK perdu (banque, boutique, enchère, récompense d'objectif) |
| `REAL_BIZHAWK_VERIFIED` | BizHawk 2.11.1 + bridge + ROM homebrew NES : lecture, écriture, relecture et restauration (confirmées par le dernier workflow) ; chaîne avec le client .NET confirmée le 3 octobre (run 37099201814), cassée ensuite par le timeout corrigé ici, **à reconfirmer** |
| `MANUAL_VERIFIED` | Pages du portail et overlay des roues, vérifiés à la main lors des sprints précédents |
| `MANUAL_VERIFIED` (passifs) | Test utilisateur réel du 6 octobre 2026 (BizHawk Linux, 2 clients, ROM BPEF v0) : sélection, Deuxième souffle, Contre-sort, roues de passifs, vol, Cartographe, redémarrages sans double récompense. Rivalité, Éclaireur, Le sixième homme et les légendaires : tests automatisés seulement |
| `MANUAL_VERIFIED` (combats commandités) | Émeraude réelle, BizHawk Linux, BPEF v0 : combats Miroir et roue START_BATTLE gagnés (XP et argent réels), combat mis en file pendant une cinématique puis parti seul, défaite détectée (K.O. réels, historique), RAM temporaire restaurée (adresses de la section `battle` du profil, justifiées par le code de la ROM FR) |
| `NOT_YET_VERIFIED` | Écritures Émeraude via le lanceur Windows `play` (vérifiées le 6 octobre 2026 sous Linux avec `run --rom`, voir le README du client) ; rendu mobile détaillé ; déploiement du serveur ; adaptateurs Gen IV+ (non implémentés) |

### 9.4 Smoke-test manuel Émeraude (mainteneur)

Seul test qui reste manuel : il exige une ROM Émeraude et une sauvegarde personnelles. **Travailler sur une copie de la sauvegarde.** Lancer un serveur (dev ou Docker), créer un admin et un joueur, démarrer une Run, connecter le client reconstruit, puis vérifier dans l'ordre :

1. lecture de l'état (argent, position, équipe, progression) sur la page Course ;
2. ajout de Pokédollars par l'admin ;
3. retrait de Pokédollars par l'admin ;
4. dépôt en banque ;
5. retrait de la banque ;
6. achat d'un ticket dans la boutique ;
7. enchère à 1 ₽ puis clôture ;
8. ajout d'un Pokémon depuis la bibliothèque (hors combat) ;
9. remplacement d'un Pokémon (hors combat) ;
10. retrait d'un Pokémon hors combat ;
11. sauvegarde en jeu, puis rechargement de la partie ;
12. vérification que l'argent, l'équipe, la banque, le jackpot et les Logs restent cohérents.

Ces écritures ne deviennent `MANUAL_VERIFIED` qu'après cette exécution par le mainteneur.

## 10. Limites et précautions

- **Authentification de confiance entre amis** : compte choisi dans une liste et en-tête `x-account-id`, sans mot de passe. Ne pas exposer le portail à un public hostile.
- **Combat** : non détecté (aucune adresse validée). La confirmation admin est obligatoire pour toucher à une équipe.
- **Vol entre deux joueurs** (`STEAL_MONEY`) : deux commandes successives ; si le crédit échoue après le débit, l'opération passe en `REVIEW` pour une correction manuelle.
- Les anciennes enchères et la roulette Lua restent dans les bases de course et ne sont pas importées dans le nouveau système.
- Profil anglais non validé ; écritures réservées aux profils `allowWrites: true` (BPEF v0).
- Le manifeste, les profils et les sauvegardes ne sont pas des caches. Ne jamais fabriquer une validation de ROM.
- Le serveur ne conserve pas le dernier état natif : après une déconnexion, la carte Course affiche « Client non connecté » (comme pour un joueur qui ne s'est jamais connecté) ; elle repasse « En jeu » dès la reconnexion.
- L'E2E navigateur couvre Chromium sur bureau ; le rendu mobile n'est pas testé automatiquement.

## 11. Documents

Les cahiers des charges de développement (sprints Codex) ont été retirés du dépôt : ce README et les guides ci-dessous décrivent l'état réel. Leur historique reste disponible dans Git.

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
- [passifs de course](docs/passives.md)
- [combats commandités](docs/battle-encounters.md)
- [fin de Run en jeu](docs/end-of-run.md)
- [administration](docs/admin.md)
- [audit](docs/audit.md)
- [lanceur BizHawk](docs/bizhawk-launcher.md)
- [client natif](native/Pokerace.Client/README.md) et [sa validation](native/Pokerace.Client/VALIDATION.md)
- [bridge BizHawk](bridges/bizhawk/README.md) et [E2E réel](bridges/bizhawk/e2e/README.md)
- [état natif](docs/native-game-state.md)
- [compatibilité ROM](docs/rom-compatibility.md)
- [nettoyage](docs/cleanup.md)
