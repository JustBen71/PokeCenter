# Bridge BizHawk Pokérace

External Tool générique C# : BizHawk ↔ TCP JSON Lines sur `127.0.0.1` ↔ futur client local. Aucune logique Pokémon, aucun profil mémoire de jeu commercial, aucun WebSocket. L'agent Python, mGBA, l'API et le dashboard existants restent indépendants.

## Version et validation

Version ciblée : **BizHawk 2.11.1 Windows x64**, External Tool **net48** ; cœur **netstandard2.0** ; CLI/tests **net8.0**. Le SDK .NET 8 et PowerShell 7 sont requis pour les commandes ci-dessous. Les références .NET Framework proviennent du package Microsoft officiel, pas de faux types BizHawk.

État détaillé, résultats et limites : [VALIDATION.md](VALIDATION.md). Une compilation ne prouve pas le chargement de la DLL dans BizHawk. Le job `e2e-bizhawk` doit réellement réussir avant de revendiquer `E2E_BIZHAWK_VERIFIED`.

Sources officielles vérifiées au tag 2.11.1 :

- [Target Framework de BizHawk](https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Client.EmuHawk/BizHawk.Client.EmuHawk.csproj).
- [IExternalToolForm](https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Client.Common/Api/IExternalToolForm.cs), [injection des API](https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Client.Common/Api/ApiInjector.cs), [réinjection lors des changements de core](https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Client.EmuHawk/tools/ToolManager.cs).
- [Domaines mémoire](https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Emulation.Common/Interfaces/Services/IMemoryDomains.cs), [MemoryDomain](https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Emulation.Common/Base%20Implementations/MemoryDomain.cs).
- [Options CLI](https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Client.Common/ArgParser.cs), [chargement et empreintes des External Tools](https://github.com/TASEmulators/BizHawk/blob/2.11.1/src/BizHawk.Client.EmuHawk/tools/ExternalToolManager.cs).

## Compiler et tester

Depuis la racine du dépôt :

```powershell
./bridges/bizhawk/e2e/prepare-bizhawk.ps1
dotnet restore bridges/bizhawk/Pokerace.BizHawkBridge.sln
dotnet build bridges/bizhawk/Pokerace.BizHawkBridge.sln --configuration Release --no-restore
dotnet test bridges/bizhawk/Pokerace.BizHawkBridge.sln --configuration Release --no-build
```

Le téléchargement officiel est épinglé et vérifié par SHA-256 avant extraction. Les binaires restent ignorés par Git. Pour une copie officielle déjà préparée, passer `-p:BizHawkDir=C:/chemin/BizHawk-2.11.1` au build. La solution compile **aussi l'adaptateur réel** dans la CI.

Pour tester uniquement le cœur sans télécharger BizHawk :

```powershell
dotnet test bridges/bizhawk/tests/Pokerace.BizHawkBridge.Tests --configuration Release
```

## Installer et lancer

Copier `Pokerace.BizHawkBridge.dll` et `Pokerace.BizHawkBridge.Core.dll` depuis `src/Pokerace.BizHawkBridge/bin/Release/net48/` vers le dossier `ExternalTools` de BizHawk 2.11.1. BizHawk fournit déjà Newtonsoft.Json ; ne pas remplacer ses dépendances.

Dans la console qui lancera BizHawk et le CLI :

```powershell
$env:POKERACE_BRIDGE_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:POKERACE_BRIDGE_PORT = '43821'
& 'C:/chemin/BizHawk/EmuHawk.exe' --open-ext-tool-dll=Pokerace.BizHawkBridge
```

Accepter l'avertissement BizHawk pour la DLL que vous avez compilée, ou ouvrir **Tools → External Tools → Pokerace BizHawk Bridge**. La fenêtre indique le port actif. Un token absent/trop court, un port invalide ou déjà occupé laisse le bridge arrêté. Fermer l'External Tool arrête son écoute et ferme le client actif. Les nouvelles variables d'environnement demandent de relancer le processus BizHawk.

`POKERACE_BRIDGE_LOG` est un chemin de journal optionnel. Ni les requêtes ni le token ne sont journalisés. Le token comporte au moins 32 caractères ; générer une valeur aléatoire et la renouveler à chaque session. Il est transmis en clair uniquement sur loopback ; ce mécanisme n'isole pas des processus malveillants exécutés sous le même compte.

## Protocole version 1

UTF-8 strict, un objet JSON par ligne terminée par `\n` (`\r\n` accepté). `id` est une chaîne optionnelle, recopiée dans chaque réponse. Les noms sur le fil sont en camelCase et sensibles à la casse.

Le premier message est obligatoirement :

```json
{"id":"1","type":"hello","protocolVersion":1,"sessionToken":"votre-secret-de-session"}
```

Réponse : `{"id":"1","ok":true,"type":"hello","protocolVersion":1}`. Un handshake invalide est suivi d'une fermeture ; **aucune commande**, même une lecture, n'est exécutée avant authentification.

| Commande | Champs supplémentaires | Réponse utile |
|---|---|---|
| `ping` | — | `type: "pong"` |
| `getStatus` | — | `bridge`, `protocolVersion`, `connected`, `systemId`, `gameLoaded` |
| `getSystem` | — | `systemId` réel du core ; `null` sans jeu |
| `getGameInfo` | — | `game: {name, systemId, hash, region}` ou `null` |
| `listMemoryDomains` | — | `domains: [{name, size, writable}]` |
| `readMemory` | `domain`, `address`, `length` | `data` hex minuscule |
| `writeMemory` | `domain`, `address`, `data` | `written`, `verified: true` |

Les adresses sur le fil sont des entiers JSON décimaux de 64 bits. Le CLI accepte aussi `0x...`. Les domaines proviennent du core actif, y compris leur taille et leur indicateur d'écriture. Aucun domaine/adresse n'est deviné. Sans jeu, les commandes mémoire retournent `no_game`. Un core sans service mémoire retourne une liste vide. Pause/reprise ne font pas partie de cette version.

```json
{"id":"2","type":"readMemory","domain":"RAM","address":768,"length":4}
{"id":"2","ok":true,"data":"11223344"}
{"id":"3","type":"writeMemory","domain":"RAM","address":768,"data":"deadbeef"}
{"id":"3","ok":true,"written":4,"verified":true}
```

Ces adresses illustrent uniquement le fixture NES fourni. Ne pas les réutiliser pour un autre jeu.

Limites : un client actif, requête de 65 536 octets maximum avant le saut de ligne, profondeur JSON de 16, transfert de 1 à 4 096 octets, délai de 15 secondes pour recevoir/exécuter une requête (y compris client inactif), 2 secondes pour envoyer sa réponse. Le client supplémentaire reçoit `busy` puis est fermé. Les clés JSON dupliquées sont rejetées. Les entrées erronées reçoivent une erreur structurée quand la connexion permet encore une réponse :

```json
{"id":"4","ok":false,"error":{"code":"invalid_range","message":"Range is outside the domain or exceeds 4096 bytes."}}
```

Autres codes : `invalid_json`, `invalid_request`, `invalid_data`, `invalid_utf8`, `truncated_request`, `request_too_large`, `handshake_required`, `unauthorized`, `protocol_mismatch`, `unknown_command`, `unknown_domain`, `read_only`, `no_game`, `write_failed`, `verification_failed`, `host_error`, `timeout`, `internal_error`.

Chaque écriture valide la plage avant mutation puis relit immédiatement les octets sur le même thread que l'émulateur. `verified: true` signifie que cette comparaison immédiate a réussi. Une erreur n'annule pas les octets déjà écrits ; la réponse le précise. La mémoire peut évoluer ensuite. Les opérations sont bornées mais un core qui bloque dans son API ne peut pas être interrompu sans risque.

## Diagnostic

```powershell
$cli = 'bridges/bizhawk/tools/Pokerace.BizHawkBridge.Cli/bin/Release/net8.0/Pokerace.BizHawkBridge.Cli.dll'
dotnet $cli status
dotnet $cli system
dotnet $cli domains
dotnet $cli doctor
dotnet $cli read RAM 0x300 4
# Seulement sur la ROM homebrew de test :
dotnet $cli doctor --domain RAM --address 0x300 --length 4 --expect 11223344
dotnet $cli doctor --write-test --domain RAM --address 0x300 --data deadbeef --expect 11223344
```

`doctor` retourne 1 si la connexion, le handshake ou une étape demandée échoue. Sans plage explicite, il contrôle les métadonnées et affiche `[SKIP]` pour lecture/écriture : aucune plage universellement sûre ne peut être choisie par un bridge générique (certaines lectures de bus ont des effets de bord). Avec `--domain` et `--address`, il effectue la lecture ; seul `--write-test` active l'écriture et la restauration dans un `finally`. Une restauration non confirmée est une erreur. `write <domain> <address> <hex>` est une écriture volontaire sans restauration automatique.

## Architecture et validation continue

`TcpBridgeServer → BridgeSession/Protocol → BridgeService → IEmulatorHost → BizHawkHostAdapter`.

Le réseau est asynchrone. `FormDispatcher` transmet l'opération mémoire entière au thread WinForms. Une opération encore en attente est annulée après expiration et ne s'exécute pas ultérieurement. Les services de BizHawk sont réinjectés lors d'un changement de core : les domaines ne sont jamais conservés entre les requêtes.

Tests : `FakeEmulatorHost`, mémoire de 64 Kio, changements de jeu/domaines, bornes et overflow, domaines lecture seule/défectueux, écritures multiples, handshake, fragmentation TCP, JSON invalide, client supplémentaire, expiration, fermeture et CLI réel sur serveur factice.

Le [workflow](../../.github/workflows/bizhawk-bridge.yml) comporte deux jobs Windows jetables : build/tests et vrai BizHawk. Voir [le harness E2E](e2e/README.md) et [le smoke-test initial](INTEGRATION_TEST.md). Aucune ROM privée, aucun BIOS et aucun accès distant au PC du mainteneur ne sont nécessaires.
