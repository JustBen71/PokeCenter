# Pokerace.Client

Client console **C# / .NET 8**, sans dépendance aux assemblies BizHawk. Il relie le bridge local au serveur Pokérace, annonce l'état de connexion, exécute des commandes génériques et renvoie leur résultat. Il contient également un adaptateur local Émeraude en lecture seule, détaillé dans [le guide de l’état natif](../../docs/native-game-state.md). **Les écritures génériques sont désactivées par défaut.**

```text
BizHawk → Pokerace.BizHawkBridge → TCP 127.0.0.1 → Pokerace.Client
                                                    ↕ WSS / Socket.IO /client
                                              Serveur Pokérace
```

Le projet suit [le cahier des charges client](../../README_POKERACE_CLIENT_CODEX.md). Le bridge existant reste dans `bridges/bizhawk` : aucun déplacement n'est nécessaire et le client livré ne référence ni son projet ni les assemblies internes de BizHawk. Seuls les tests utilisent son cœur indépendant pour simuler un bridge fidèle au protocole réel.

## Démarrage sous Windows

**Lancement automatique recommandé :** double-cliquer sur `pokerace.cmd` à la racine du projet, ou sur l'exécutable de la distribution `pokerace-launcher-win-x64`. Il propose la ROM, prépare BizHawk et démarre le bridge et le client vers votre serveur existant. Voir [le guide du lanceur](../../docs/bizhawk-launcher.md). Les commandes ci-dessous restent disponibles pour une installation manuelle.

Utiliser la distribution `win-x64` ou la construire avec les commandes ci-dessous. Ouvrir une console dans son dossier puis :

```powershell
./Pokerace.Client.exe configure
```

Renseigner l'URL **HTTPS** du serveur, le nom du joueur et le code du salon. Si les comptes sont obligatoires sur le serveur, ce nom doit correspondre à un compte créé sur le portail. Un identifiant local est généré et conservé dans la configuration ; un fichier existant n'est pas écrasé par `configure`.

Le client et BizHawk doivent recevoir le **même token de session**, choisi lors du lancement du bridge :

```powershell
$env:POKERACE_BRIDGE_TOKEN = 'le-token-de-session-utilisé-par-le-bridge'
./Pokerace.Client.exe doctor
./Pokerace.Client.exe run
```

Avec `run` ou `doctor`, le bridge doit déjà être lancé. Voir [son installation](../../bridges/bizhawk/README.md). La commande `play` (ou le double-clic sur la distribution avec lanceur) gère au contraire le choix de ROM et le lancement de BizHawk. `Ctrl+C` arrête proprement le client. Il reste actif si le bridge ou le serveur devient indisponible, puis tente de se reconnecter avec un délai progressif.

Sur Linux/macOS, utiliser `./Pokerace.Client` et définir `POKERACE_BRIDGE_TOKEN` dans l'environnement. Le client est portable ; la disponibilité d'un bridge compatible sur ces OS est une condition séparée. Cette tâche ne revendique pas la compatibilité d'une installation BizHawk sur chaque OS.

## Construire et tester

Prérequis développeur : SDK .NET 8, Node.js 22 et dépendances npm du dépôt pour le test avec le **vrai Socket.IO**. Le binaire final n'a aucune dépendance Node/Python ni package NuGet externe.

Depuis la racine du dépôt :

```powershell
npm ci
npm run build -w @pokerace/shared
dotnet restore native/Pokerace.Client/Pokerace.Client.sln
dotnet build native/Pokerace.Client/Pokerace.Client.sln --configuration Release --no-restore
dotnet test native/Pokerace.Client/Pokerace.Client.sln --configuration Release --no-build
npm run typecheck -w @pokerace/api
npm run test -w @pokerace/api
```

Pour développer sans distribution publiée :

```powershell
dotnet run --project native/Pokerace.Client/src/Pokerace.Client --configuration Release -- configure
dotnet run --project native/Pokerace.Client/src/Pokerace.Client --configuration Release -- doctor
dotnet run --project native/Pokerace.Client/src/Pokerace.Client --configuration Release -- run
```

Créer un dossier autonome, sans installation de .NET sur le poste cible :

```powershell
./native/Pokerace.Client/tools/build.ps1 -Runtime win-x64
# Autres cibles : linux-x64, osx-x64, osx-arm64
```

Ou directement :

```text
dotnet publish native/Pokerace.Client/src/Pokerace.Client/Pokerace.Client.csproj --configuration Release --runtime linux-x64 --self-contained true -o native/Pokerace.Client/artifacts/linux-x64
```

Distribuer **le dossier de sortie entier**, pas uniquement l'exécutable. Les binaires générés sont ignorés par Git. La CI prépare un artefact pour chaque architecture et exécute aussi `--help` sur le binaire produit sur son OS.

## Configuration

Emplacements par défaut :

| OS | Fichier |
|---|---|
| Windows | `%LOCALAPPDATA%/Pokerace/client.json` |
| Linux | `$XDG_CONFIG_HOME/Pokerace/client.json`, sinon `~/.config/Pokerace/client.json` |
| macOS | `~/Library/Application Support/Pokerace/client.json` |

Toutes les commandes acceptent `--config <chemin>`. Voir [client.example.json](client.example.json). Ne pas partager un `playerId` entre plusieurs joueurs : utiliser `configure` pour en générer un propre à chaque poste.

| Champ | Rôle |
|---|---|
| `serverUrl` | Origine HTTPS/WSS, sans chemin, identifiants intégrés ni paramètres d'URL |
| `roomCode` | Code de salon joueur ; aucun `ADMIN_TOKEN` n'est requis |
| `playerName` | Nom du compte/joueur, 1 à 32 caractères |
| `playerId` | Identité persistante obligatoire dans le fichier |
| `bridgeHost` | Obligatoirement `127.0.0.1` |
| `bridgePort` | Port du bridge, `43821` par défaut |
| `allowMemoryWrites` | `false` par défaut ; seul un changement local à `true` autorise l'écriture |
| `allowInsecureLocalServer` | `false` ; mode de test HTTP/WS limité à `localhost`, `127.0.0.1` ou `::1` |
| `heartbeatSeconds` | 5 par défaut, de 1 à 60 secondes |

Le token du bridge vient uniquement de l'environnement `POKERACE_BRIDGE_TOKEN` (au moins 32 caractères), jamais du fichier. Un redémarrage du bridge avec un nouveau token nécessite de relancer le client avec ce nouveau token. Une reconnexion à token inchangé est automatique.

Le fichier ne contient ni ROM, ni sauvegarde, ni dump mémoire, ni secret administrateur. Les champs inconnus sont refusés. L'écriture du fichier est atomique ; ses permissions Unix sont limitées à l'utilisateur (`0600`). Sous Windows, il hérite des permissions du dossier utilisateur. Les paramètres sont chargés au démarrage : relancer le client après une modification.

## Protocole bridge — version 1

Le client applique le protocole **réel** déjà livré : JSON Lines UTF-8 avec `id`, commandes camelCase et version négociée lors de `hello`. Il ne remplace pas ce contrat par les champs conceptuels `requestId` des exemples du cahier des charges.

```json
{"id":"uuid","type":"hello","protocolVersion":1,"sessionToken":"secret"}
{"id":"uuid","ok":true,"type":"hello","protocolVersion":1}
```

Opérations exposées par `IBridgeClient` : connexion/déconnexion, ping, état, système, métadonnées du jeu, domaines, lecture et écriture. Les octets sont transportés en hexadécimal. Les plages demandées sont bornées à 4 096 octets ; les lignes reçues sont bornées à 65 536 octets ; les réponses doivent correspondre à l'identifiant de la requête. Une écriture n'est confirmée que si le bridge indique `verified: true` et le nombre exact d'octets.

Une seule requête TCP s'exécute à la fois. Timeout de connexion/handshake : 5 secondes ; timeout d'une opération : 10 secondes. Une coupure/expiration ferme cette connexion pour empêcher de confondre une réponse tardive avec une nouvelle requête. Le gestionnaire sonde l'état toutes les 2 secondes et publie les changements de jeu/système/connexion.

## Protocole serveur — version 1

La nouvelle connexion utilise exclusivement **Socket.IO sur WebSocket**, namespace `/client`, chemin `/socket.io/`, Engine.IO 4 / protocole Socket.IO 5. HTTPS devient WSS avec validation TLS normale. Aucun port Internet entrant n'est ouvert. Le transport supporte les événements texte et ACK, sans polling ni pièces jointes binaires, conformément aux [spécifications Socket.IO](https://github.com/socketio/socket.io-protocol) et [Engine.IO](https://github.com/socketio/engine.io-protocol).

L'authentification transporte `protocolVersion`, `playerId`, `playerName`, `accountName` et `roomCode`. Le serveur vérifie le salon et, si activée, l'existence du compte. `SERVER_STATUS` confirme la version avant le démarrage. Chaque événement porte un objet JSON dont `type` correspond au nom de l'événement et dont `protocolVersion` vaut `1`.

| Direction | Événements |
|---|---|
| Client → serveur | `HELLO`, `CLIENT_STATUS`, `BRIDGE_STATUS`, `HEARTBEAT`, `COMMAND_ACK` |
| Serveur → client | `COMMAND`, `SERVER_STATUS` |

À chaque connexion/reconnexion, le client renvoie `HELLO`, `CLIENT_STATUS`, l'état courant du bridge et un heartbeat. Les tentatives de reconnexion utilisent un backoff d'environ 1, 2, 4, 8, 16 puis 30 secondes avec une légère variation. Le ping/pong Engine.IO est traité indépendamment de l'exécution des commandes.

`HELLO` indique la version du client et la plateforme réelle. Il ne prétend pas connaître la version de BizHawk : le bridge ne la fournit pas. Le système et l'état du jeu proviennent des réponses du bridge ; en son absence, les informations inconnues restent `null`.

```json
{
  "type": "COMMAND",
  "protocolVersion": 1,
  "commandId": "85701bfe-395a-435a-af92-8c76842ec7df",
  "command": "bridge.readMemory",
  "payload": {"domain": "RAM", "address": 768, "length": 4}
}
```

```json
{
  "type": "COMMAND_ACK",
  "protocolVersion": 1,
  "commandId": "85701bfe-395a-435a-af92-8c76842ec7df",
  "ok": true,
  "result": {"data": "11223344"}
}
```

Commandes autorisées : `bridge.ping`, `bridge.getStatus`, `bridge.getSystem`, `bridge.getGameInfo`, `bridge.listMemoryDomains`, `bridge.readMemory`, `bridge.writeMemory`. Les adresses sur le fil sont des entiers décimaux. Cet exemple de RAM est illustratif : aucune adresse de jeu n'est codée dans le client.

Le module serveur additionnel [`apps/api/src/native-clients.ts`](../../apps/api/src/native-clients.ts) expose `snapshot()` et `sendCommand(playerId, command)`, accessibles via `createApp(...).nativeClients`. `sendCommand` attend un `COMMAND_ACK` corrélé et rejette les déconnexions/timeouts sans prétendre que l'opération n'a pas eu lieu. Il s'agit d'une API interne pour la future orchestration, pas d'un endpoint public d'écriture mémoire.

Les anciens namespaces `/agent` et `/dashboard`, `player.cmd`, l'agent Python, mGBA et les commandes Pokémon restent distincts. Ce nouveau client ne publie aucune fausse équipe Pokémon dans le dashboard et ne réalise ni enchère, ni roulette, ni lecture d'équipe. Une interface dédiée et des `GameAdapter` pourront être ajoutés ensuite.

## Sécurité des commandes et doublons

La protection d'écriture existe à deux niveaux : routeur et `BridgeClient`. Un message serveur ne peut pas modifier `allowMemoryWrites`. `doctor` n'écrit jamais, même lorsque cette option vaut `true`.

`commandId` doit être un UUID non nul. Une commande en cours ou terminée est mémorisée pendant **toute la vie du processus client**, y compris après une coupure du serveur ou du bridge. Même UUID et même contenu : résultat précédent ; même UUID avec un autre contenu : `command_id_reused`, sans exécution. Les erreurs et résultats incertains sont aussi conservés : **aucune écriture n'est automatiquement retentée** après un timeout ou une perte d'ACK.

Le cache est borné à 4 096 identifiants et conserve les résultats en RAM. Quand il est plein, les nouvelles commandes reçoivent `command_cache_full` ; les anciennes restent dédupliquées. La file d'attente est bornée à 64 commandes ; une saturation reçoit `client_busy`. Les identifiants ne sont pas évincés pour faire de la place à une nouvelle écriture.

La garantie ne traverse **pas un redémarrage du processus client** : ce cache est temporaire, pas un journal persistant. Le serveur doit alors réconcilier les opérations incertaines avant de retransmettre une écriture. Une erreur d'écriture ne signifie pas que la RAM est inchangée ; les octets déjà écrits peuvent rester modifiés. Le client ne tente pas de restauration arbitraire et n'enregistre aucun dump sur disque.

Les logs sont structurés (date, niveau, événement, code d'erreur), sans token, code du salon, corps de requête, octets mémoire ni exception distante brute. Les données mémoire n'apparaissent que dans le résultat de la commande explicitement demandée.

## Doctor

`Pokerace.Client doctor` vérifie la configuration, le TCP local, le handshake du bridge, ping, l'état, le système, les métadonnées du jeu et les domaines disponibles. Il se connecte ensuite au serveur et attend la confirmation de `HELLO`.

- Jeu absent : domaines `[SKIP]`, mais les connexions sont tout de même diagnostiquées.
- Écritures : toujours `[SKIP]` ; aucun appel à `WRITE_MEMORY`, aucune lecture arbitraire de RAM.
- Succès des étapes applicables : exit code `0`.
- Échec de configuration, connexion, authentification ou protocole : `[FAIL]` avec l'étape et exit code `1`.

Fermer temporairement un client `run` avant `doctor` : le bridge autorise un seul client actif.

## Validation et limites

Voir [VALIDATION.md](VALIDATION.md) pour les commandes réellement exécutées et leurs résultats. Tests : faux hôte mémoire à plusieurs domaines derrière le vrai cœur TCP du bridge, serveur WebSocket factice, vrai Socket.IO avec le module serveur de production, lectures/écritures, protection locale, doublons simultanés, erreurs partielles, reconnexions et diagnostic.

Le [workflow multiplateforme](../../.github/workflows/pokerace-client.yml) teste Windows x64, Linux x64, macOS x64 et macOS arm64. Les statuts `UNIT_VERIFIED`, `INTEGRATION_VERIFIED` et `CROSS_PLATFORM_BUILD_VERIFIED` doivent rester distincts d'une CI réellement verte sur tous les OS et de `E2E_BIZHAWK_CLIENT_VERIFIED`.

L'E2E avec vrai BizHawk est validé en environnement CI jetable : serveur → client → bridge → émulateur → ROM homebrew, avec lecture, écriture, relecture, restauration et fermeture propre. Le commit et les runs de preuve figurent dans [VALIDATION.md](VALIDATION.md). Aucun test n'utilise de ROM privée, sauvegarde, BIOS ou installation BizHawk personnelle. Le client ne contient aucun `GameAdapter` ni aucune logique Pokémon.
