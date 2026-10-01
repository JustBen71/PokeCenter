# Pokérace — Consignes Codex : Bridge BizHawk uniquement

## Objectif

Implémenter **uniquement le bridge BizHawk** de Pokérace.

Le bridge doit fonctionner comme un **External Tool BizHawk en C#** et exposer une petite API locale au futur client Pokérace.

Architecture visée :

```text
BizHawk
  ↕ API mémoire / état émulateur
Pokerace.BizHawkBridge.dll
  ↕ TCP localhost / JSON Lines
Pokerace Client local
  ↕ WebSocket
Serveur / interface Pokérace
```

Le bridge **ne doit contenir aucune logique Pokémon ni logique métier Pokérace**.

Il ne doit pas connaître :

- les Pokémon ;
- les générations ;
- les adresses mémoire d'Émeraude, Platine, etc. ;
- les enchères ;
- les roulettes ;
- l'argent Pokérace ;
- les comptes joueurs ;
- le serveur WebSocket Pokérace.

Il doit seulement permettre au client local de dialoguer proprement avec BizHawk.

---

## Travail demandé

Créer dans le dépôt une nouvelle zone indépendante :

```text
bridges/
└── bizhawk/
    ├── src/
    │   └── Pokerace.BizHawkBridge/
    ├── tests/
    │   └── Pokerace.BizHawkBridge.Tests/
    ├── Pokerace.BizHawkBridge.sln
    └── README.md
```

Ne pas modifier l'agent Python, le Lua mGBA, l'API, le dashboard ou les règles Pokérace sauf si une modification minimale de configuration/build est strictement nécessaire.

Le travail doit rester isolé afin d'être développé sur une branche dédiée.

---

## 1. External Tool BizHawk

Créer un External Tool C# compatible avec la version actuelle de BizHawk utilisée pour le développement.

**Important :** ne pas inventer les API BizHawk.

Avant d'implémenter :

1. identifier les assemblies/API réellement exposées par la version BizHawk ciblée ;
2. utiliser les interfaces officielles existantes pour accéder à l'émulateur et aux domaines mémoire ;
3. choisir le Target Framework compatible avec cette version de BizHawk ;
4. documenter dans `bridges/bizhawk/README.md` la version BizHawk contre laquelle le bridge a été compilé et testé.

Si une API supposée n'existe pas, adapter l'implémentation à l'API réelle au lieu de créer un faux wrapper qui ne compile pas.

---

## 2. Responsabilités du bridge

Le bridge doit exposer au minimum les opérations suivantes :

```text
PING
GET_STATUS
GET_SYSTEM
GET_GAME_INFO
LIST_MEMORY_DOMAINS
READ_MEMORY
WRITE_MEMORY
```

Optionnel si l'API BizHawk le permet proprement :

```text
GET_PAUSE_STATE
PAUSE
RESUME
```

### GET_STATUS

Retourner au minimum :

```json
{
  "bridge": "pokerace-bizhawk",
  "protocolVersion": 1,
  "connected": true,
  "systemId": "GBA",
  "gameLoaded": true
}
```

### GET_SYSTEM

Retourner l'identifiant système fourni par BizHawk sans logique spécifique Pokérace.

Exemples possibles selon le core :

```text
GB
GBC
GBA
NDS
3DS
```

Ne pas fabriquer un identifiant si BizHawk n'en fournit pas un de façon fiable.

### GET_GAME_INFO

Retourner les informations génériques disponibles dans BizHawk concernant le jeu chargé.

Ne pas parser Pokémon ici.

### LIST_MEMORY_DOMAINS

Retourner la liste des domaines mémoire réellement exposés par le core actif avec, au minimum :

```json
{
  "name": "System Bus",
  "size": 33554432,
  "writable": true
}
```

Les valeurs doivent provenir de BizHawk.

### READ_MEMORY

Entrée conceptuelle :

```json
{
  "id": "request-id",
  "type": "readMemory",
  "domain": "System Bus",
  "address": 33554432,
  "length": 32
}
```

Réponse :

```json
{
  "id": "request-id",
  "ok": true,
  "data": "001122aabbcc..."
}
```

`data` doit être une représentation hexadécimale déterministe des octets lus.

### WRITE_MEMORY

Entrée conceptuelle :

```json
{
  "id": "request-id",
  "type": "writeMemory",
  "domain": "System Bus",
  "address": 33554432,
  "data": "001122aabbcc"
}
```

Le bridge doit :

1. vérifier que le domaine existe ;
2. vérifier que la plage demandée est valide ;
3. vérifier que le domaine est inscriptible si l'API BizHawk permet de le déterminer ;
4. écrire les octets ;
5. relire immédiatement la zone écrite ;
6. comparer la relecture aux données demandées ;
7. retourner `ok: true` uniquement si la vérification réussit.

Exemple de réponse :

```json
{
  "id": "request-id",
  "ok": true,
  "written": 6,
  "verified": true
}
```

Une écriture partielle ou une relecture différente doit produire une erreur explicite.

---

## 3. Transport local

Utiliser un serveur **TCP uniquement sur `127.0.0.1`**.

Protocole recommandé : **JSON Lines / NDJSON**.

Une requête = une ligne JSON UTF-8 terminée par `\n`.

Une réponse = une ligne JSON UTF-8 terminée par `\n`.

Exemple :

```text
{"id":"1","type":"ping"}\n
{"id":"1","ok":true,"type":"pong"}\n
```

Contraintes :

- ne jamais écouter sur `0.0.0.0` ;
- port configurable ;
- taille maximale d'une requête ;
- timeout raisonnable ;
- maximum un client Pokérace actif au début ;
- toute erreur doit produire une réponse structurée ;
- une mauvaise requête ne doit pas faire planter BizHawk.

Prévoir une séparation claire entre :

```text
Transport TCP
Protocol parser
Bridge service
BizHawk adapter
```

afin que la majorité du code soit testable sans lancer BizHawk.

---

## 4. Sécurité locale minimale

Ajouter un `sessionToken` configurable au lancement du bridge.

Le premier message du client doit faire un handshake :

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "sessionToken": "..."
}
```

Tant que le handshake n'est pas validé :

- aucune lecture mémoire ;
- aucune écriture mémoire.

Ne jamais logger le token complet.

---

## 5. Aucune logique Pokémon

Interdiction d'ajouter au bridge des méthodes comme :

```text
ReadPokemon
ReadMoney
GivePokemon
GiveItem
ReplacePokemon
ReadBadges
ReadTrainer
```

Le bridge expose uniquement des primitives d'émulation.

La logique Pokémon sera ajoutée plus tard dans le client Pokérace via des `GameAdapter`.

---


---

# Règle de validation : aucun accès au PC du mainteneur

Codex ne doit **jamais dépendre d'un accès à la machine personnelle du mainteneur** pour développer ou valider ce bridge.

La validation doit être conçue en **trois niveaux** :

```text
Niveau A — automatique, réalisé par Codex
  build + tests unitaires + tests TCP + faux adaptateur BizHawk

Niveau B — E2E automatique avec vrai BizHawk
  vrai processus BizHawk + vraie DLL + ROM homebrew de test + lecture/écriture/relecture

Niveau C — validation humaine initiale seulement
  smoke-test ponctuel par le mainteneur pour confirmer que le montage E2E correspond au comportement réel attendu
```

L'objectif à terme est que **les régressions ne dépendent plus du tout d'une vérification humaine**. Une fois le premier smoke-test réel validé, la CI E2E avec vrai BizHawk devient la référence de non-régression.

Codex ne doit pas demander :

- un accès distant au PC ;
- TeamViewer / AnyDesk / RDP / SSH vers la machine personnelle ;
- l'accès à une ROM privée ;
- l'accès à une sauvegarde privée ;
- l'accès à un BizHawk déjà installé sur la machine du mainteneur.

Le code doit être suffisamment découplé pour que **la quasi-totalité du fonctionnement soit prouvée sans lancer BizHawk**.

---

# Stratégie obligatoire de testabilité

Créer une abstraction explicite entre le code réseau/protocole et les API BizHawk réelles.

Exemple conceptuel :

```csharp
public interface IEmulatorHost
{
    string? GetSystemId();
    bool IsGameLoaded();
    IReadOnlyList<IMemoryDomainAdapter> GetMemoryDomains();
}

public interface IMemoryDomainAdapter
{
    string Name { get; }
    long Size { get; }
    bool Writable { get; }

    byte ReadByte(long address);
    void WriteByte(long address, byte value);
}
```

Les noms exacts peuvent différer, mais le principe est obligatoire :

```text
BizHawk API réelle
      ↓
BizHawkHostAdapter
      ↓
BridgeService
      ↓
Protocol / TCP
```

En tests :

```text
FakeBizHawkHost
      ↓
BridgeService
      ↓
Protocol / TCP réel
```

Ainsi, les tests ne doivent pas charger BizHawk pour vérifier le comportement métier du bridge.

---

# CI GitHub obligatoire

Ajouter une GitHub Action dédiée au bridge, par exemple :

```text
.github/workflows/bizhawk-bridge.yml
```

Elle doit au minimum exécuter :

```bash
dotnet restore bridges/bizhawk/Pokerace.BizHawkBridge.sln
dotnet build bridges/bizhawk/Pokerace.BizHawkBridge.sln --configuration Release --no-restore
dotnet test bridges/bizhawk/Pokerace.BizHawkBridge.sln --configuration Release --no-build
```

La CI doit échouer si :

- la compilation échoue ;
- un test échoue ;
- le projet de tests ne compile pas.

Si les assemblies BizHawk nécessaires ne peuvent pas être redistribuées ou récupérées légalement/automatiquement dans la CI, ne pas les committer artificiellement. Dans ce cas :

1. isoler l'adaptateur BizHawk réel dans un projet très mince ;
2. compiler/tester tout le cœur du bridge sans dépendance BizHawk ;
3. documenter clairement la procédure de compilation de l'adaptateur réel avec une installation BizHawk fournie par le développeur ;
4. ne jamais remplacer les types BizHawk par de faux types portant les mêmes noms uniquement pour « faire passer » la compilation.

Le résultat GitHub Actions doit être la référence de validation automatique.

---

# E2E automatique obligatoire avec un vrai BizHawk

Après les tests unitaires et les tests TCP sur fake, ajouter un **vrai test end-to-end automatisé** qui démarre BizHawk lui-même dans un environnement CI isolé.

Ce test ne doit pas utiliser la machine personnelle du mainteneur.

Architecture du test :

```text
CI / VM jetable
   ↓
BizHawk réel (version épinglée)
   ↓
Pokerace.BizHawkBridge.dll réel
   ↓
ROM homebrew de test déterministe
   ↓
Pokerace.BizHawkBridge.Cli
   ↓
hello / ping / status / domains / read / write / read-back / restore
```

## Version BizHawk épinglée

Le workflow E2E doit utiliser une **version précise de BizHawk**, jamais `latest` sans contrôle.

Conserver dans le dépôt, par exemple :

```text
bridges/bizhawk/e2e/bizhawk-version.json
```

avec au minimum :

```json
{
  "version": "VERSION_EXACTE",
  "downloadUrl": "URL_OFFICIELLE_OU_RELEASE",
  "sha256": "SHA256_ATTENDU"
}
```

La CI doit :

1. récupérer cette version ;
2. vérifier son SHA-256 ;
3. échouer si le hash ne correspond pas ;
4. ne jamais télécharger une version flottante silencieusement.

Si la redistribution directe de BizHawk n'est pas appropriée, le workflow peut le télécharger depuis sa source officielle à chaque exécution. Ne pas committer arbitrairement les binaires BizHawk dans le dépôt.

## ROM homebrew de test

Le test E2E ne doit jamais utiliser une ROM Pokémon, une sauvegarde privée ou un BIOS propriétaire.

Utiliser une **ROM homebrew minimale et légalement redistribuable**, idéalement :

```text
bridges/bizhawk/e2e/test-rom/
├── src/
├── build script
└── LICENSE
```

Préférer une ROM construite depuis ses sources dans la CI plutôt qu'un binaire opaque.

La ROM de test doit être volontairement simple et déterministe. Elle peut par exemple :

1. démarrer ;
2. écrire une valeur sentinelle connue dans une zone RAM connue ;
3. rester dans une boucle stable ;
4. permettre au test externe de relire puis modifier cette zone.

Exemple conceptuel :

```text
RAM_TEST_ADDRESS = adresse définie par le fixture E2E
valeur initiale  = 11 22 33 44
```

Le **bridge de production ne doit contenir aucune adresse spécifique à cette ROM**. Toute connaissance de l'adresse de test reste exclusivement dans le harness E2E.

## Harness E2E

Créer par exemple :

```text
bridges/bizhawk/e2e/
├── bizhawk-version.json
├── test-config.json
├── test-rom/
├── run-e2e.ps1
└── README.md
```

`test-config.json` peut contenir les informations spécifiques au fixture, par exemple :

```json
{
  "expectedSystemId": "GBA",
  "preferredDomain": "System Bus",
  "testAddress": "0x02000000",
  "initialBytes": "11223344",
  "writeBytes": "deadbeef"
}
```

Ces valeurs appartiennent **uniquement aux tests E2E**.

## Séquence E2E obligatoire

Le test doit automatiquement :

```text
1. compiler Pokerace.BizHawkBridge.dll en Release
2. préparer/télécharger BizHawk version épinglée
3. préparer la ROM homebrew de test
4. démarrer BizHawk avec la ROM de test
5. charger automatiquement l'External Tool Pokérace
6. attendre que le port localhost du bridge soit disponible
7. effectuer le handshake
8. PING
9. GET_STATUS
10. GET_SYSTEM
11. LIST_MEMORY_DOMAINS
12. READ_MEMORY de la zone de test
13. vérifier la valeur sentinelle initiale
14. WRITE_MEMORY avec une nouvelle valeur
15. READ_MEMORY de la même zone
16. vérifier byte par byte la nouvelle valeur
17. restaurer la valeur initiale
18. relire et vérifier la restauration
19. fermer proprement BizHawk
20. retourner exit code 0 uniquement si toutes les étapes réussissent
```

Le lancement de l'External Tool doit utiliser le mécanisme réellement supporté par la version BizHawk ciblée. **Codex doit vérifier la syntaxe exacte de la CLI/API BizHawk au lieu de l'inventer.**

## Environnement CI

Préférer d'abord un runner GitHub-hosted compatible avec la version BizHawk ciblée.

Si le démarrage d'un vrai BizHawk GUI/External Tool n'est pas fiable sur un runner GitHub-hosted, utiliser une **VM ou un runner CI dédié et jetable**, séparé du PC du mainteneur. Le pipeline doit rester reproductible et documenté.

Un runner personnel permanent ne doit pas devenir une dépendance obligatoire du projet.

Sous un environnement sans écran, utiliser si nécessaire un affichage virtuel ou l'équivalent adapté à l'OS choisi, à condition que BizHawk et l'External Tool fonctionnent réellement dans cet environnement.

## Workflow GitHub Actions

Étendre `.github/workflows/bizhawk-bridge.yml` avec au minimum deux jobs :

```text
unit-and-integration
  → restore
  → build
  → tests FakeBizHawkHost
  → tests TCP

e2e-bizhawk
  → dépend de unit-and-integration
  → vrai BizHawk
  → vraie DLL
  → ROM homebrew
  → doctor / harness E2E
  → lecture + écriture + relecture + restauration
```

Le job `e2e-bizhawk` doit être exécuté au minimum :

- sur les Pull Requests qui modifient `bridges/bizhawk/**` ;
- sur `master`/branche principale après merge ;
- avant une release du bridge.

S'il est trop coûteux pour chaque commit intermédiaire, il peut être limité aux PR et à la branche principale, mais **il ne doit pas être uniquement manuel**.

## Logs et artefacts CI

En cas d'échec E2E, conserver comme artefacts lorsque possible :

```text
logs du bridge
stdout/stderr de BizHawk
résultat du CLI doctor
version exacte BizHawk
liste des memory domains détectés
étape ayant échoué
```

Ne jamais inclure le `sessionToken` complet dans les logs.

## Critère de réussite E2E

Le test n'est considéré comme réussi que si une **vraie écriture mémoire via le vrai bridge chargé dans le vrai BizHawk** a été relue avec succès puis restaurée.

Un test qui ne fait que vérifier que BizHawk démarre ou que la DLL existe n'est pas suffisant.

---

# Outil `doctor` obligatoire

Le client de diagnostic doit fournir une commande :

```bash
Pokerace.BizHawkBridge.Cli doctor
```

Sans bridge disponible, elle doit expliquer proprement que le bridge n'est pas joignable et retourner un code de sortie non nul.

Avec un bridge disponible, elle doit exécuter automatiquement au minimum :

```text
[OK] Connexion TCP localhost
[OK] Handshake
[OK] PING
[OK] GET_STATUS
[OK] GET_SYSTEM
[OK] LIST_MEMORY_DOMAINS
[OK] READ_MEMORY sur une plage explicitement fournie ou sûre
[SKIP] WRITE_MEMORY tant qu'aucune zone de test n'a été explicitement fournie
```

Par défaut, `doctor` **ne doit jamais écrire arbitrairement dans la mémoire d'un jeu réel**.

Prévoir une option explicite pour un test d'écriture contrôlé, par exemple :

```bash
Pokerace.BizHawkBridge.Cli doctor \
  --write-test \
  --domain "System Bus" \
  --address 0x02000000 \
  --data DEADBEEF
```

Le mode écriture doit :

1. lire la valeur avant ;
2. écrire les données ;
3. relire et vérifier ;
4. si possible, restaurer la valeur initiale ;
5. relire à nouveau pour confirmer la restauration ;
6. afficher précisément chaque étape.

Aucune adresse de test spécifique à Pokémon ne doit être codée en dur dans le bridge ou le CLI.

---

# Faux environnement BizHawk obligatoire pour les tests

Créer un `FakeBizHawkHost` / `FakeEmulatorHost` qui simule :

- aucun jeu chargé ;
- un jeu chargé ;
- différents `systemId` ;
- plusieurs domaines mémoire ;
- domaine lecture/écriture ;
- domaine lecture seule ;
- domaine qui échoue volontairement à l'écriture ;
- disparition/rechargement d'un jeu ;
- changement de domaine entre deux requêtes.

Tester notamment que le bridge reste cohérent lorsque :

```text
aucun jeu -> jeu chargé -> jeu fermé -> autre jeu chargé
```

sans devoir redémarrer le processus de test.

Ajouter aussi un test où plusieurs écritures successives sont effectuées à différentes adresses, puis relues et vérifiées octet par octet.

---

# Ce que Codex doit réellement prouver avant de terminer

Codex doit pouvoir fournir, sans accès au PC du mainteneur :

```text
1. dotnet build -> succès
2. dotnet test -> succès
3. nombre exact de tests passés
4. test TCP réel sur 127.0.0.1 -> succès
5. écriture + relecture + vérification sur FakeMemoryDomain -> succès
6. erreur post-écriture simulée -> correctement détectée
7. changement de jeu simulé -> correctement géré
8. GitHub Actions -> vert
9. CLI doctor -> testé contre le fake/serveur de test
```

Il doit inclure ces résultats dans son compte-rendu final.

**Il ne doit pas déclarer « testé dans BizHawk réel » s'il ne l'a pas effectivement fait dans son propre environnement.**

---

# Tests obligatoires

Les tests ne sont pas optionnels.

Utiliser un projet de tests .NET adapté au dépôt, par exemple xUnit si aucune autre convention n'existe.

Créer une abstraction du domaine mémoire afin de pouvoir utiliser un **FakeMemoryDomain** en tests sans lancer BizHawk.

## Tests mémoire minimum

Créer une mémoire factice, par exemple 64 Kio, initialisée à zéro.

### Test 1 — lecture simple

Insérer manuellement plusieurs octets dans la mémoire factice :

```text
adresse 0x1000
01 02 03 04 05 06
```

Appeler `READ_MEMORY` et vérifier que le résultat est exactement :

```text
010203040506
```

### Test 2 — écriture + relecture

Appeler `WRITE_MEMORY` pour écrire :

```text
adresse 0x2000
DE AD BE EF
```

Puis :

1. vérifier que la mémoire factice contient réellement `DE AD BE EF` ;
2. appeler `READ_MEMORY` ;
3. vérifier que la valeur retournée est `deadbeef` ;
4. vérifier que la réponse d'écriture contient `verified: true`.

### Test 3 — plusieurs blocs/lignes

Écrire plusieurs blocs successifs :

```text
0x3000 -> 00 11 22 33
0x3010 -> 44 55 66 77 88
0x3020 -> AA BB CC DD EE FF
```

Relire chaque bloc et vérifier byte par byte qu'aucune écriture n'a contaminé les zones voisines.

### Test 4 — écrasement partiel

Mémoire initiale :

```text
10 20 30 40 50 60
```

Écrire `AA BB` au milieu.

Résultat attendu :

```text
10 20 AA BB 50 60
```

### Test 5 — limites

Tester :

- adresse négative ;
- longueur nulle si elle est interdite par le protocole ;
- lecture dépassant la fin du domaine ;
- écriture dépassant la fin du domaine ;
- domaine inexistant ;
- données hex invalides ;
- message trop gros.

Toutes ces situations doivent être rejetées proprement sans modifier la mémoire.

### Test 6 — domaine lecture seule

Créer un faux domaine non inscriptible.

Vérifier que :

```text
READ_MEMORY -> fonctionne
WRITE_MEMORY -> refusé
```

### Test 7 — vérification post-écriture

Créer un faux domaine volontairement défectueux qui retourne une valeur différente après écriture.

Le bridge doit retourner :

```text
ok = false
verified = false
```

Il ne doit jamais prétendre que l'écriture a réussi.

### Test 8 — protocole TCP

Démarrer le serveur TCP dans le test sur un port local temporaire.

Tester la séquence complète :

```text
connect
hello
ping
listMemoryDomains
writeMemory
readMemory
close
```

Vérifier les réponses JSON et les IDs de corrélation.

### Test 9 — authentification locale

Tester :

```text
mauvais token -> refus
aucun token -> refus
bon token -> accès autorisé
```

### Test 10 — robustesse

Envoyer :

- JSON invalide ;
- commande inconnue ;
- champs manquants ;
- types incorrects.

Le bridge doit répondre avec une erreur structurée et rester opérationnel pour la requête suivante.

---

# Smoke-test réel BizHawk — validation humaine initiale

Ajouter un document :

```text
bridges/bizhawk/INTEGRATION_TEST.md
```

Ce document est destiné au **mainteneur**, pas à une prise de contrôle de sa machine par Codex.

Codex doit préparer tout ce qui permet au mainteneur de faire ce test lui-même en quelques minutes.

Scénario minimum :

1. compiler le bridge en `Release` ;
2. installer/copier l'External Tool selon la procédure documentée ;
3. démarrer BizHawk ;
4. vérifier que l'External Tool est chargé ;
5. charger un jeu de test légalement fourni par le mainteneur ;
6. exécuter `Pokerace.BizHawkBridge.Cli doctor` ;
7. vérifier `GET_SYSTEM` ;
8. vérifier `LIST_MEMORY_DOMAINS` ;
9. effectuer une lecture contrôlée ;
10. uniquement si le mainteneur choisit explicitement une zone de test sûre, lancer le mode `--write-test` ;
11. confirmer écriture, relecture et restauration éventuelle.

Le README doit préciser les résultats attendus et les messages d'erreur possibles.

Ne pas inclure de ROM, sauvegarde, BIOS ou donnée privée dans le dépôt ou les tests.

Ce smoke-test humain sert à **amorcer et confirmer une première fois** le montage réel. Après cette validation initiale, les régressions doivent être couvertes par le job E2E automatisé avec vrai BizHawk. Son absence dans l'environnement de Codex ne doit jamais l'amener à demander l'accès au PC personnel du mainteneur.

---

# Petit client de diagnostic

Ajouter un outil console minimal, uniquement pour le développement :

```text
bridges/bizhawk/tools/Pokerace.BizHawkBridge.Cli/
```

Il doit permettre au développeur de faire facilement :

```text
status
system
domains
read <domain> <address> <length>
write <domain> <address> <hex>
```

Cet outil sert uniquement à vérifier le bridge avant que le futur client Pokérace soit implémenté.

Il ne doit contenir aucune logique Pokémon.

---

# Qualité attendue

Le code doit :

- compiler sans warning significatif ;
- être nullable-safe si le framework le permet ;
- gérer proprement la fermeture/rechargement d'un jeu ;
- ne pas bloquer le thread principal de BizHawk avec les opérations réseau ;
- stopper proprement le serveur TCP à la fermeture de l'External Tool ;
- libérer sockets et ressources ;
- ne jamais faire planter BizHawk à cause d'une requête réseau invalide ;
- journaliser les erreurs utiles sans exposer de secrets.

---

# Critères de fin de tâche

La tâche est terminée uniquement si :

- [ ] `Pokerace.BizHawkBridge.dll` compile, ou si la dépendance BizHawk empêche une compilation CI autonome, le cœur testable compile et la procédure de build de l'adaptateur réel est documentée ;
- [ ] le cœur du bridge est testable sans BizHawk via `FakeBizHawkHost` ;
- [ ] GitHub Actions exécute build + tests et passe ;
- [ ] le bridge écoute uniquement sur localhost ;
- [ ] le handshake fonctionne ;
- [ ] `PING` fonctionne ;
- [ ] `GET_SYSTEM` fonctionne ;
- [ ] `LIST_MEMORY_DOMAINS` fonctionne ;
- [ ] `READ_MEMORY` fonctionne ;
- [ ] `WRITE_MEMORY` écrit, relit et vérifie ;
- [ ] les erreurs d'adresse/domaine sont gérées ;
- [ ] les tests unitaires de lecture/écriture passent ;
- [ ] les tests TCP passent ;
- [ ] un faux domaine défectueux fait échouer la vérification post-écriture ;
- [ ] la documentation d'installation dans BizHawk existe ;
- [ ] le CLI de diagnostic fonctionne ;
- [ ] la commande `doctor` existe et n'effectue aucune écriture réelle par défaut ;
- [ ] `INTEGRATION_TEST.md` permet au mainteneur de faire seul le smoke-test BizHawk ;
- [ ] un harness E2E lance un vrai BizHawk avec une ROM homebrew légale ;
- [ ] le job E2E charge réellement `Pokerace.BizHawkBridge.dll` ;
- [ ] le job E2E vérifie lecture, écriture, relecture et restauration sur une vraie mémoire émulée ;
- [ ] le job E2E est automatique sur PR/branche principale et ne dépend pas du PC du mainteneur ;
- [ ] les versions/téléchargements BizHawk utilisés en CI sont épinglés et vérifiés par hash ;
- [ ] aucune logique Pokémon n'a été ajoutée au bridge ;
- [ ] aucun accès au PC du mainteneur n'a été nécessaire.

La capacité réelle de BizHawk à charger la DLL doit être clairement classée :

```text
UNIT_VERIFIED        = build + tests unitaires/fakes/TCP réussis
E2E_BIZHAWK_VERIFIED = vrai BizHawk + vraie DLL + ROM homebrew + read/write/read-back réussis en CI
MANUAL_VERIFIED      = confirmé au moins une fois manuellement par le mainteneur
NOT_YET_VERIFIED     = aucun vrai BizHawk n'a encore exécuté le bridge avec succès
```

Une fois `E2E_BIZHAWK_VERIFIED` établi, la non-régression ne doit plus dépendre de `MANUAL_VERIFIED`.

Codex ne doit jamais transformer `NOT_YET_VERIFIED` en `MANUAL_VERIFIED` ou `E2E_BIZHAWK_VERIFIED` par supposition.

Avant de terminer, exécuter tous les tests possibles dans son environnement et inclure dans le compte-rendu final :

```text
- commande de build utilisée
- commande de tests utilisée
- nombre exact de tests passés/échoués
- résultat GitHub Actions unit/integration si disponible
- résultat GitHub Actions E2E BizHawk si disponible
- version exacte + SHA-256 du BizHawk utilisé en E2E
- ROM homebrew de test utilisée/construite + licence
- résultat lecture/écriture/relecture/restauration sur vrai BizHawk
- test TCP exécuté : oui/non + résultat
- test FakeMemoryDomain écriture/relecture : résultat
- commande doctor testée : résultat
- version BizHawk ciblée
- statut de validation : UNIT_VERIFIED / E2E_BIZHAWK_VERIFIED / MANUAL_VERIFIED / NOT_YET_VERIFIED
- limites connues
```

## Hors périmètre

Ne pas implémenter dans cette tâche :

```text
Pokerace Client complet
WebSocket vers le serveur Pokérace
GameAdapter
Gen3Adapter
Gen4Adapter
Détection Pokémon
Lecture d'équipe
Modification Pokémon
Roulette
Enchères
Banque
Launcher universel
Support mGBA natif
```

**Cette tâche doit livrer un bridge BizHawk générique, testable et fiable. Rien de plus.**
