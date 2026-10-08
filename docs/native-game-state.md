# Client natif, état public et lecture Émeraude

> Mise à jour du 4 octobre 2026 : le client natif prend désormais en charge les achats aux enchères, même seul, et la copie exacte vers la bibliothèque. Les mentions de lecture seule ci-dessous concernent l’ancien périmètre ; réinjection, suppression et gages restent sur l’agent historique. Voir le README principal pour l’état actuel.

État actuel : voir le [README principal](../README.md). Les cahiers des charges décrivent aussi des étapes historiques.

## Utilisation

Lancer `pokerace.cmd` ou la distribution Windows `Pokerace.Client.exe`, sélectionner sa ROM et utiliser le compte du portail. Le site affiche la connexion du client, celle du bridge, le système chargé et le diagnostic de lecture. Pour la ROM Émeraude FR BPEF v0 validée dans le manifeste existant, il affiche aussi le dresseur, l’argent, le temps de jeu, la zone, les six emplacements de l’équipe et la progression.

Une seule carte est affichée par compte, même si l’ancien agent et le client natif sont connectés ensemble. Les données natives valides ont priorité pour les équipes et la carte de progression. Sinon, l’affichage reprend les données de l’ancien agent ou indique uniquement la connexion native.

Les copies bibliothèque et achats natifs sont disponibles. Réinjection, suppression et gages restent sur /agent.

## Reconnaissance et lecture locales

Le lanceur calcule le SHA-256 du fichier sélectionné et le conserve uniquement en mémoire. Le fichier reste ouvert en lecture pendant la session afin d’empêcher son remplacement sous Windows. Le SHA-256 est comparé exactement à `emulator/profiles/rom-manifest.json` ; le profil associé doit être `read-validated` et l’entrée du manifeste `validated: true`. Le profil anglais candidat reste désactivé.

Le SHA-1 est calculé séparément pour corréler le fichier sélectionné avec le hash annoncé par BizHawk. Le client accepte une correspondance exacte avec l’un des deux hashes calculés, éventuellement préfixé par son algorithme. Il ne traite jamais automatiquement `game.Hash` comme un SHA-256. Une absence de correspondance bloque la lecture. Les hashes, chemins et adresses ne sont pas envoyés au serveur.

Le mode manuel `run`, sans fichier sélectionné par le lanceur, annonce `rom_identity_unavailable` pour GBA. Une ROM d’un autre système annonce `unsupported_system`. Charger un autre jeu invalide la corrélation ; revenir au fichier sélectionné réactive la lecture après vérification. Une déconnexion, un changement de jeu ou une erreur de lecture retire l’état précédent de l’affichage natif.

Le mapping pris en charge est celui des domaines mGBA de BizHawk 2.11.1 : `EWRAM` de 256 Kio et `IWRAM` de 32 Kio, avec conversion explicite des adresses GBA en offsets de domaine. Des noms ou tailles différents donnent `memory_domain_unavailable`. Aucun domaine de secours n’est choisi approximativement.

Les profils, caractères, espèces, cartes et objectifs proviennent directement des JSON existants dans `emulator/profiles`, intégrés dans le binaire lors du build. Le client publié fonctionne sans checkout du dépôt. Le décodeur porte la lecture de `emulator/lua/extractor.lua` : pointeurs SaveBlock, XOR de l’argent et des structures Pokémon, 24 permutations, checksums, espèces, niveaux, PV et flags de progression. Une équipe incohérente est rejetée intégralement. Les capacités annoncées sont exclusivement `trainer.read`, `money.read`, `party.read`, `location.read`, `progression.read`, même si les écritures génériques sont autorisées localement.

La lecture tourne toutes les 750 ms, indépendamment des heartbeats et des reconnexions du serveur. Les observations identiques, à l’horodatage près, ne sont pas renvoyées. Une erreur publie `read_error`, puis la boucle retente automatiquement.

## Contrat réseau

Événement `/client` additif, strictement validé, limité à 32 Kio :

```text
GAME_STATE { type, protocolVersion: 1, gameStateVersion: 2, adapter, state }
```

`adapter` contient `id`, `status`, `profileId`, `capabilities`. `state` vaut `null` pour un diagnostic ou contient l’observation normalisée. L’objet d’adaptateur est répété dans l’observation et doit être identique à celui de l’enveloppe. Les champs inattendus et états incohérents sont refusés. Schéma : `packages/shared/src/native-client.ts`.

### Version 2 : contrat multi-génération

```text
NativeGameState (gameStateVersion 2)
├── adapter      id, status, profileId, capabilities
├── game         family "pokemon", generation 1–9, title (slug), language (2 lettres), revision
├── trainer      name, money (≤ 9 999 999 ; ≤ 999 999 en Gen III), playTimeSeconds, partyCount
├── location     label, region?, mapId?, mapGroup?/mapNumber? (obligatoires en Gen III)
├── party[]      PokemonLiveState : slot, speciesId, speciesName, nickname, level, currentHp, maxHp, shiny, artifact?
├── progression  version 1, completed[] (identifiants vérifiés contre les objectifs Émeraude en Gen III)
├── capabilities
└── observedAt
```

- La partie commune (`PokemonLiveState`) suffit à l’interface : espèce, surnom, niveau, PV, sprite. `speciesId` est borné par la génération annoncée (151, 251, 386, 493…).
- `artifact` porte la donnée **propre à la génération** utilisée par les écritures : `{format, raw}`. Seul `gen3-party-v1` (100 octets, décodés et vérifiés) est compris aujourd’hui ; un futur `gen4-party-v1` s’ajoutera sans modifier le contrat. Le format doit correspondre à la génération du jeu.
- Les fonctionnalités restent pilotées par les **capabilities**, jamais par la génération : un futur adaptateur peut annoncer `party.read`, `money.read`, `location.read` sans aucune écriture.
- L’API accepte un `GAME_STATE` uniquement si le système du bridge correspond à la génération (`SYSTEMS_BY_GENERATION` : GBA pour la Gen III, NDS pour les Gen IV–V…).
- Compatibilité : un client ≤ 0.1 qui envoie `gameStateVersion: 1` (Émeraude, `raw` directement sur chaque Pokémon) est accepté et converti en version 2 par le serveur (`raw` → `artifact: {format: "gen3-party-v1", raw}`). Le reste du portail ne voit que la version 2.
- Fixtures de contrat synthétiques Gen III, IV et V : `packages/shared/test/native-fixture.ts`. Aucun adaptateur Gen IV+ n’est implémenté.

`GET /api/native-clients` et l’événement `/dashboard` `native-clients` utilisent la même projection explicite `PublicNativeClient` du package shared. Les contrôles de compte existants s’appliquent à la route et au dashboard. L’événement envoie la liste initiale, puis les changements utiles, et retire les clients déconnectés. `accountId` désigne le compte du serveur ; `playerId` désigne l’installation du client. Aucun objet interne de socket n’est publié.

## Validation et limites

Les tests C# utilisent une mémoire synthétique : aucune ROM commerciale ni sauvegarde privée n’est nécessaire. Ils couvrent le refus de lire sans identité valide, les domaines, les structures Pokémon, la progression, les changements de jeu et la reprise après erreur. Un test envoie une observation produite par le décodeur C# à la vraie registration Socket.IO de l’API. Les tests API couvrent également REST, les notifications, le filtrage public et les messages invalides ; les tests Web couvrent la fusion des comptes et la priorité d’affichage.

Les workflows existants exécutent les vérifications shared/API/Web/client sur Windows et Linux. L’E2E BizHawk utilise uniquement la ROM NES homebrew du dépôt : le bridge et le lanceur fonctionnent, l’adaptateur annonce `unsupported_system`, et aucun état Pokémon n’est produit. Cela ne constitue pas une validation de partie Émeraude réelle dans BizHawk. Le lecteur Émeraude réutilise les profils déjà validés dans le manifeste et est vérifié ici sur mémoire synthétique.
