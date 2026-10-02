# Pokerace.Client — Cahier des charges Codex

## Objectif

Créer un **client local Pokérace** indépendant de BizHawk et indépendant de la logique du site web.

Le client tourne sur la machine du joueur et sert d’intermédiaire entre :

```text
BizHawk + Pokerace.BizHawkBridge
            │
            │ TCP localhost uniquement
            ▼
      Pokerace.Client
            │
            │ WSS / Socket.IO
            ▼
      Serveur Pokérace
            │
            ▼
      Dashboard Web
```

Le client :

- se connecte au bridge BizHawk en local ;
- maintient la connexion avec le bridge ;
- se connecte au serveur Pokérace en WebSocket sécurisé ;
- transmet au serveur l’état de connexion de l’émulateur ;
- reçoit des commandes du serveur ;
- transmet ces commandes au bridge lorsque cela est approprié ;
- reçoit les réponses du bridge ;
- renvoie un ACK explicite au serveur ;
- gère les déconnexions et reconnexions ;
- ne contient, dans cette première étape, **aucune logique spécifique à Pokémon**.

Cette tâche ne doit pas modifier le fonctionnement actuel de la branche principale. Le projet sera développé dans une branche dédiée.

---

# 1. Emplacement dans le repository

Créer le projet dans le même repository Pokérace.

Structure cible :

```text
PokeCenter/
├── apps/
├── deploy/
├── docs/
├── emulator/
├── packages/
├── native/
│   ├── Pokerace.BizHawkBridge/
│   └── Pokerace.Client/
│       ├── src/
│       ├── tests/
│       ├── tools/
│       └── README.md
└── ...
```

Le bridge BizHawk et le client sont deux projets indépendants.

Le client **ne doit jamais référencer directement les assemblies internes de BizHawk**.

Toutes les communications avec BizHawk passent par le protocole localhost du bridge.

---

# 2. Technologie

Utiliser :

```text
C#
.NET 8
```

Le client doit pouvoir être compilé pour :

```text
Windows x64
Linux x64
macOS x64
macOS arm64
```

Ne pas construire d’interface graphique complexe dans cette étape.

Une application console propre est suffisante.

La conception doit cependant permettre d’ajouter plus tard une UI native ou un launcher.

---

# 3. Responsabilités du client

Le client doit avoir exactement trois responsabilités principales.

## 3.1 Bridge local

Connexion TCP vers :

```text
127.0.0.1:<port>
```

Aucune connexion du bridge vers Internet.

Le client doit pouvoir :

```text
CONNECT
PING
GET_STATUS
GET_SYSTEM
GET_GAME_INFO
LIST_MEMORY_DOMAINS
READ_MEMORY
WRITE_MEMORY
```

selon les commandes réellement exposées par `Pokerace.BizHawkBridge`.

Le protocole doit être versionné.

Exemple :

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "type": "ping"
}
```

Réponse :

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "ok": true,
  "data": {}
}
```

---

# 4. Connexion au serveur Pokérace

Le client maintient une connexion sortante vers le serveur.

Utiliser :

```text
WSS
```

ou Socket.IO si nécessaire pour rester compatible avec le serveur Pokérace existant.

Aucun port entrant Internet ne doit être nécessaire sur le PC du joueur.

Le client doit pouvoir envoyer au minimum :

```text
HELLO
CLIENT_STATUS
BRIDGE_STATUS
HEARTBEAT
COMMAND_ACK
```

et recevoir :

```text
COMMAND
SERVER_STATUS
```

---

# 5. HELLO initial

Lors de la connexion serveur, envoyer une description du client.

Exemple :

```json
{
  "type": "HELLO",
  "protocolVersion": 1,
  "clientVersion": "0.1.0",
  "playerId": "p-...",
  "platform": "windows-x64",
  "bridge": {
    "type": "bizhawk",
    "connected": true,
    "protocolVersion": 1
  },
  "emulator": {
    "name": "BizHawk",
    "version": "..."
  },
  "system": "GBA"
}
```

Les champs réellement disponibles doivent provenir du bridge.

Ne jamais inventer une version ou une information non disponible.

---

# 6. Configuration locale

Le client doit utiliser un fichier de configuration local.

Exemple :

```json
{
  "serverUrl": "https://race.example.com",
  "roomCode": "123",
  "playerName": "Ben",
  "playerId": "p-...",
  "bridgeHost": "127.0.0.1",
  "bridgePort": 32145
}
```

Utiliser un emplacement de configuration adapté à l’OS.

Ne jamais stocker :

- ROM ;
- sauvegarde ;
- dump mémoire ;
- secret serveur en clair si ce secret donne des droits administrateur.

Le client ne doit avoir besoin d’aucun `ADMIN_TOKEN`.

---

# 7. Architecture interne

Créer au minimum les composants suivants :

```text
Pokerace.Client
│
├── Configuration
│
├── Bridge
│   ├── IBridgeClient
│   ├── BridgeClient
│   ├── BridgeProtocol
│   └── BridgeConnectionManager
│
├── Server
│   ├── IServerConnection
│   ├── ServerConnection
│   └── ServerProtocol
│
├── Commands
│   ├── CommandRouter
│   ├── CommandContext
│   └── CommandResult
│
├── Runtime
│   └── ClientRuntime
│
├── Diagnostics
│   └── DoctorCommand
│
└── Program.cs
```

Ne pas mettre toute la logique dans `Program.cs`.

---

# 8. Interface bridge

Créer une abstraction claire.

Exemple conceptuel :

```csharp
public interface IBridgeClient
{
    Task ConnectAsync(CancellationToken cancellationToken);
    Task DisconnectAsync();

    Task<BridgeStatus> GetStatusAsync();
    Task<SystemInfo> GetSystemAsync();
    Task<IReadOnlyList<MemoryDomainInfo>> GetMemoryDomainsAsync();

    Task<byte[]> ReadMemoryAsync(
        string domain,
        long address,
        int length,
        CancellationToken cancellationToken);

    Task WriteMemoryAsync(
        string domain,
        long address,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken);
}
```

Ce contrat est générique.

Il ne doit contenir aucune méthode comme :

```text
ReadPokemon()
GivePokemon()
ReadMoney()
GiveBadge()
```

Ces notions seront ajoutées plus tard via des `GameAdapter`.

---

# 9. CommandRouter

Le serveur peut envoyer une commande au client.

Exemple :

```json
{
  "type": "COMMAND",
  "commandId": "uuid",
  "command": "bridge.readMemory",
  "payload": {
    "domain": "System Bus",
    "address": 33554432,
    "length": 16
  }
}
```

Le client doit :

```text
1. valider le message ;
2. vérifier commandId ;
3. vérifier que le bridge est connecté ;
4. transmettre au bridge ;
5. attendre la réponse ;
6. construire un résultat ;
7. renvoyer COMMAND_ACK au serveur.
```

Exemple :

```json
{
  "type": "COMMAND_ACK",
  "commandId": "uuid",
  "ok": true,
  "result": {
    "data": "00010203"
  }
}
```

---

# 10. Sécurité des écritures

`WRITE_MEMORY` doit être considéré comme une opération sensible.

Dans cette première version :

```text
WRITE_MEMORY doit être désactivé par défaut.
```

La configuration locale doit permettre explicitement :

```json
{
  "allowMemoryWrites": true
}
```

Sans cette option :

```text
WRITE_MEMORY
→ rejet local
→ aucun appel au bridge
```

Même si le serveur demande l’écriture.

La protection est donc côté client et ne dépend pas uniquement du serveur.

---

# 11. Identifiants de commandes

Chaque commande reçue du serveur possède un :

```text
commandId
```

au format UUID.

Le client doit conserver un cache local temporaire des commandes récemment exécutées.

Si la même commande arrive deux fois :

```text
même commandId
```

elle ne doit pas être exécutée une deuxième fois.

Le client renvoie le résultat précédent lorsqu’il est encore disponible.

Objectif :

```text
commande serveur
→ déconnexion réseau
→ reconnexion
→ retransmission
```

ne doit jamais provoquer une double écriture mémoire.

---

# 12. Reconnexion au bridge

Le client doit survivre à :

```text
BizHawk fermé
BizHawk redémarré
bridge redémarré
connexion TCP interrompue
```

Le processus client reste vivant.

État attendu :

```text
Bridge connected
      ↓
Bridge lost
      ↓
BRIDGE_STATUS disconnected
      ↓
tentatives de reconnexion
      ↓
Bridge connected
      ↓
BRIDGE_STATUS connected
```

Utiliser un backoff raisonnable.

Ne pas créer de boucle agressive consommant le CPU.

---

# 13. Reconnexion au serveur

Même principe pour le serveur :

```text
Internet perdu
serveur redémarré
WebSocket fermé
```

Le client doit automatiquement se reconnecter.

À la reconnexion :

```text
HELLO
BRIDGE_STATUS
HEARTBEAT
```

doivent être renvoyés.

---

# 14. Heartbeat

Envoyer périodiquement un heartbeat.

Exemple :

```json
{
  "type": "HEARTBEAT",
  "clientVersion": "0.1.0",
  "bridgeConnected": true,
  "system": "GBA"
}
```

L’intervalle doit être configurable.

Valeur par défaut raisonnable :

```text
5 secondes
```

---

# 15. Journalisation

Logs structurés et lisibles.

Exemples :

```text
[INFO] Server connected
[INFO] Bridge connected
[INFO] BizHawk system: GBA
[INFO] Command received: ...
[INFO] Command completed: ...
[WARN] Bridge disconnected
[ERROR] Command failed: ...
```

Ne jamais logger :

```text
token
roomCode complet si considéré sensible
contenu mémoire massif
secrets
```

---

# 16. Commande `doctor`

Créer :

```text
Pokerace.Client doctor
```

Cette commande doit diagnostiquer le poste sans modifier la RAM.

Sortie attendue :

```text
Pokérace Client Doctor

[OK] Configuration loaded
[OK] Server URL valid
[OK] Bridge TCP reachable
[OK] Bridge protocol v1
[OK] Emulator: BizHawk
[OK] System: GBA
[OK] Memory domains accessible
[SKIP] Memory writes disabled
[OK] Server WebSocket reachable

Client operational.
```

Si une étape échoue :

```text
[FAIL] Bridge TCP unreachable
```

et retourner un code de sortie non nul.

---

# 17. Tests unitaires obligatoires

Codex doit écrire les tests en même temps que le code.

Aucune fonctionnalité ne doit être considérée terminée sans tests.

Créer :

```text
Pokerace.Client.Tests
```

Utiliser xUnit ou NUnit.

---

# 18. FakeBridge obligatoire

Créer un faux bridge en mémoire :

```text
FakeBridgeServer
```

Il doit simuler :

```text
PING
GET_STATUS
GET_SYSTEM
LIST_MEMORY_DOMAINS
READ_MEMORY
WRITE_MEMORY
```

avec plusieurs domaines mémoire.

Exemple :

```text
System Bus
0x0000 - 0xFFFF

WRAM
0x0000 - 0x7FFF
```

Le fake doit être suffisamment réaliste pour tester le vrai protocole TCP du client.

---

# 19. Tests mémoire obligatoires

Tester au minimum :

```text
écriture 1 octet
écriture plusieurs octets
écriture à plusieurs adresses
lecture après écriture
écriture en début de domaine
écriture en fin de domaine
adresse négative
adresse hors domaine
taille nulle
taille excessive
domaine inexistant
connexion interrompue pendant une requête
```

Exemple obligatoire :

```text
mémoire initiale :
0x1000 = 00 00 00 00

WRITE:
DE AD BE EF

READ:
DE AD BE EF

ASSERT:
valeur lue == valeur écrite
```

Tester aussi plusieurs blocs :

```text
0x1000 → DE AD BE EF
0x2000 → 01 02 03 04
0x3000 → AA BB CC DD
```

puis relire chaque bloc indépendamment.

---

# 20. FakeServer WebSocket obligatoire

Créer également :

```text
FakePokeraceServer
```

Il doit permettre de tester le vrai client WebSocket.

Le test doit pouvoir :

```text
démarrer FakeServer
démarrer FakeBridge
démarrer Pokerace.Client
attendre HELLO
envoyer COMMAND
observer requête bridge
recevoir COMMAND_ACK
```

---

# 21. Test d’intégration complet obligatoire

Écrire un test automatique reproduisant :

```text
FakePokeraceServer
       │
       │ WebSocket
       ▼
Pokerace.Client
       │
       │ TCP localhost
       ▼
FakeBridgeServer
```

Scénario :

```text
1. Client démarre.
2. Client se connecte au FakeBridge.
3. Client se connecte au FakeServer.
4. FakeServer reçoit HELLO.
5. FakeServer envoie READ_MEMORY.
6. Client transmet au FakeBridge.
7. FakeBridge retourne les octets.
8. Client renvoie COMMAND_ACK.
9. FakeServer vérifie les octets reçus.
```

Puis scénario écriture :

```text
1. allowMemoryWrites = true
2. FakeServer envoie WRITE_MEMORY
3. FakeBridge écrit les données
4. Client reçoit succès
5. FakeServer envoie READ_MEMORY
6. valeur relue == valeur écrite
```

Ce test ne dépend ni de BizHawk réel ni du PC du développeur.

---

# 22. Test de protection d’écriture obligatoire

Tester :

```text
allowMemoryWrites = false
```

Puis envoyer :

```text
WRITE_MEMORY
```

Résultat attendu :

```text
COMMAND_ACK ok=false
```

et :

```text
FakeBridge.WriteMemory()
```

ne doit jamais avoir été appelé.

---

# 23. Tests de reconnexion

Automatiser au minimum :

## Bridge

```text
FakeBridge online
→ client connecté
→ FakeBridge arrêté
→ client détecte perte
→ FakeBridge redémarré
→ client se reconnecte
```

## Serveur

```text
FakeServer online
→ client connecté
→ FakeServer arrêté
→ client reste vivant
→ FakeServer redémarré
→ client se reconnecte
→ HELLO reçu à nouveau
```

---

# 24. Test d’idempotence

Scénario obligatoire :

```text
COMMAND commandId=A
→ exécutée

même COMMAND commandId=A
→ renvoyée au client
```

Le fake bridge doit démontrer que :

```text
WriteMemory()
```

n’a été appelé qu’une seule fois.

---

# 25. Tests de protocole invalide

Tester :

```text
JSON invalide
protocolVersion inconnue
requestId absent
commandId invalide
payload absent
payload trop gros
réponse bridge inconnue
réponse serveur inconnue
```

Le client ne doit pas planter.

---

# 26. Limites de taille

Définir une taille maximale des messages.

Exemple :

```text
64 KiB
```

Toute trame dépassant cette limite doit être rejetée.

Éviter les allocations mémoire non bornées.

---

# 27. GitHub Actions

Créer un workflow CI.

À chaque :

```text
push
pull request
```

exécuter :

```bash
dotnet restore
dotnet build --configuration Release
dotnet test --configuration Release
```

Tester au minimum :

```text
ubuntu-latest
windows-latest
macos-latest
```

Le build doit échouer si un test échoue.

---

# 28. Build multi-plateforme

Préparer les commandes de publication :

```bash
dotnet publish -c Release -r win-x64
dotnet publish -c Release -r linux-x64
dotnet publish -c Release -r osx-x64
dotnet publish -c Release -r osx-arm64
```

Ne pas imposer un runtime global installé chez l’utilisateur final si un build self-contained reste raisonnable.

---

# 29. E2E avec le vrai Bridge BizHawk

Lorsque `Pokerace.BizHawkBridge` dispose de son propre E2E automatisé, ajouter un test supplémentaire capable de chaîner :

```text
FakePokeraceServer
        │
        ▼
Pokerace.Client réel
        │
        ▼
Pokerace.BizHawkBridge réel
        │
        ▼
BizHawk réel
        │
        ▼
ROM homebrew de test
```

Ce test n’utilise aucune ROM Pokémon.

Il doit utiliser la même ROM homebrew légale que le projet Bridge si possible.

Scénario E2E :

```text
1. démarrer BizHawk ;
2. charger Pokerace.BizHawkBridge ;
3. lancer la ROM homebrew ;
4. démarrer Pokerace.Client ;
5. démarrer FakePokeraceServer ;
6. attendre HELLO ;
7. envoyer READ_MEMORY ;
8. vérifier valeur connue ;
9. envoyer WRITE_MEMORY ;
10. relire ;
11. vérifier valeur modifiée ;
12. restaurer la valeur initiale.
```

Ce scénario doit pouvoir être exécuté en CI sans accès au PC du développeur.

---

# 30. Pas de dépendance au PC du développeur

Codex ne doit jamais avoir besoin :

- d’un accès distant au PC du développeur ;
- de TeamViewer ;
- de RDP ;
- de fichiers locaux non présents dans le repository ;
- d’une ROM Pokémon ;
- d’une sauvegarde Pokémon ;
- d’une installation BizHawk spécifique non reproductible.

Tout ce qui est nécessaire aux tests automatisés doit être :

```text
créé
mocké
téléchargé de façon reproductible
ou documenté
```

dans la CI.

---

# 31. Aucun GameAdapter dans cette tâche

IMPORTANT.

Ne pas implémenter :

```text
Gen3Adapter
EmeraldAdapter
PokemonReader
MoneyReader
PokemonWriter
BattleReader
```

dans ce projet pour l’instant.

Le client doit simplement fournir l’infrastructure permettant de les ajouter plus tard.

Le travail s’arrête au niveau :

```text
Serveur Pokérace
        ↕
Pokerace.Client
        ↕
Emulator Bridge
```

---

# 32. Aucun changement fonctionnel du site

Ne pas refaire :

```text
dashboard
roulette
enchères
comptes
Pokémon builder
```

Le serveur peut recevoir le minimum de modifications nécessaires pour permettre à ce nouveau client de se connecter dans une branche dédiée.

Toute modification serveur doit :

- être isolée ;
- être documentée ;
- être testée ;
- ne pas casser l’ancien client existant tant que celui-ci est encore présent.

---

# 33. Versionnement

Versionner séparément :

```text
ClientProtocol
BridgeProtocol
```

Exemple :

```text
ClientProtocol = 1
BridgeProtocol = 1
```

Une incompatibilité de protocole doit produire une erreur claire.

Ne jamais continuer silencieusement avec un protocole inconnu.

---

# 34. Critères de validation

Le projet n’est considéré terminé que lorsque :

```text
[ ] dotnet build fonctionne
[ ] tous les tests unitaires passent
[ ] FakeBridge passe
[ ] FakeServer passe
[ ] lecture TCP passe
[ ] écriture TCP passe
[ ] read-after-write passe
[ ] interdiction écriture passe
[ ] idempotence passe
[ ] reconnexion bridge passe
[ ] reconnexion serveur passe
[ ] doctor fonctionne
[ ] CI Windows passe
[ ] CI Linux passe
[ ] CI macOS passe
[ ] README local du client existe
```

Lorsque l’E2E BizHawk réel est disponible :

```text
[ ] E2E_BIZHAWK_CLIENT_VERIFIED
```

---

# 35. Statuts de validation

Employer explicitement les statuts :

```text
UNIT_VERIFIED
INTEGRATION_VERIFIED
CROSS_PLATFORM_BUILD_VERIFIED
E2E_BIZHAWK_CLIENT_VERIFIED
NOT_YET_VERIFIED
```

Ne jamais écrire :

```text
"fonctionne avec BizHawk"
```

si seul `FakeBridge` a été utilisé.

---

# 36. Livrables attendus

Codex doit livrer :

```text
native/Pokerace.Client/
├── src/
├── tests/
├── tools/
├── Pokerace.Client.sln
├── README.md
└── éventuellement scripts de build
```

ainsi que :

```text
.github/workflows/pokerace-client.yml
```

ou un workflow équivalent intégré proprement à la CI existante.

Le README local doit expliquer :

```text
build
tests
configuration
doctor
lancement
protocole bridge
protocole serveur
limitations
statut de validation
```

---

# 37. Principe architectural à respecter

La séparation finale doit rester :

```text
BizHawk
   │
   ▼
Pokerace.BizHawkBridge
   │
   │ primitives mémoire uniquement
   ▼
Pokerace.Client
   │
   │ logique locale + futur GameAdapter
   ▼
Serveur Pokérace
   │
   ▼
Dashboard
```

Le bridge sait manipuler la mémoire.

Le client sait orchestrer l’émulateur et communiquer avec Pokérace.

Le serveur sait gérer la partie multijoueur.

Aucune de ces responsabilités ne doit être mélangée.
