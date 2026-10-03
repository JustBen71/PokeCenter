# Étape suivante — Web + GameAdapter Pokémon Gen III

## Objectif

Faire évoluer la branche `pokerace-client` pour que le nouveau pipeline BizHawk ne soit plus seulement visible comme un client connecté, mais puisse aussi **lire un état Pokémon normalisé via un GameAdapter local** et l'afficher dans le Web.

Architecture cible de cette étape :

```text
BizHawk
   ↓
Pokerace.BizHawkBridge
   ↓ TCP localhost
Pokerace.Client
   ↓
GameAdapter
   ↓ état Pokémon normalisé
Socket.IO /client
   ↓
API Pokérace
   ↓
/dashboard + REST
   ↓
Web
```

Cette étape doit conserver une séparation stricte :

- le **bridge** connaît uniquement BizHawk et la mémoire brute ;
- le **GameAdapter** connaît Pokémon, la génération et les structures mémoire ;
- le **client** sélectionne l'adaptateur, lit l'état et communique avec le serveur ;
- le **serveur** ne connaît aucune adresse mémoire ;
- le **Web** n'accède jamais directement à la mémoire.

---

# 1. Branche et état de départ

Travailler sur :

```text
pokerace-client
```

État déjà validé :

```text
bridges/bizhawk/
    → bridge générique fonctionnel
    → vrai E2E BizHawk validé

native/Pokerace.Client/
    → client local fonctionnel
    → Socket.IO /client fonctionnel
    → lanceur Windows fonctionnel

apps/api/src/native-clients.ts
    → HELLO
    → CLIENT_STATUS
    → BRIDGE_STATUS
    → HEARTBEAT
    → COMMAND_ACK

apps/web/
    → portail historique toujours alimenté par /agent pour Pokémon
```

Ne pas casser les parcours historiques pendant cette étape.

---

# 2. Périmètre de cette tâche

Cette tâche contient **deux sous-étapes obligatoires** :

```text
A. Afficher le nouveau client natif dans le Web
B. Ajouter le premier GameAdapter réel : Pokémon Émeraude / Gen III
```

Le GameAdapter de cette étape est **lecture seule**.

Il doit lire et transmettre au minimum :

```text
identité du jeu
trainer
money
play time
party count
party
location
progression
capabilities
```

Ne pas migrer encore :

```text
enchères vers /client
roulette vers /client
bibliothèque vers /client
injection Pokémon via /client
retrait Pokémon via /client
sabotages
statuts de combat
écriture d'argent
GameAdapter Gen IV+
```

Les écritures métier seront une étape suivante.

---

# 3. Architecture interne du client

Créer une vraie couche jeu dans :

```text
native/Pokerace.Client/src/Pokerace.Client/Games/
```

Structure recommandée :

```text
Games/
├── IGameAdapter.cs
├── IGameAdapterFactory.cs
├── GameAdapterManager.cs
├── GameIdentity.cs
├── GameSnapshot.cs
├── GameCapabilities.cs
│
└── Pokemon/
    └── Gen3/
        ├── Gen3GameAdapter.cs
        ├── Gen3GameAdapterFactory.cs
        ├── Gen3Profile.cs
        ├── Gen3ProfileRegistry.cs
        ├── Gen3PokemonDecoder.cs
        └── Gen3ProgressionReader.cs
```

Les noms exacts peuvent varier, mais les responsabilités doivent rester séparées.

---

# 4. Contrat GameAdapter

Créer une abstraction indépendante de BizHawk.

Exemple conceptuel :

```csharp
public interface IGameAdapter
{
    string AdapterId { get; }
    GameIdentity Identity { get; }
    GameCapabilities Capabilities { get; }

    Task<GameSnapshot> ReadSnapshotAsync(
        CancellationToken cancellationToken);
}
```

L'adaptateur peut recevoir `IBridgeClient` par constructeur.

Il ne doit jamais accéder directement aux assemblies BizHawk.

Interdit :

```text
BizHawk.Client.Common
BizHawk.Emulation.Common
MemoryDomain direct depuis le client
```

Toutes les lectures passent par :

```text
IBridgeClient.ReadMemoryAsync(...)
```

---

# 5. Le bridge reste générique

Ne pas ajouter au bridge :

```text
readPokemon
readMoney
readTrainer
givePokemon
getBadges
```

Le bridge continue à exposer uniquement des primitives génériques :

```text
getStatus
getSystem
getGameInfo
listMemoryDomains
readMemory
writeMemory
```

Le GameAdapter interprète les octets.

---

# 6. Identification exacte de la ROM

IMPORTANT : une adresse mémoire ne doit jamais être activée pour une ROM inconnue.

Le projet possède déjà :

```text
emulator/profiles/rom-manifest.json
emulator/profiles/emerald-fr-bpef-v0.json
emulator/profiles/emerald-en-bpee-v0.json
```

Réutiliser ces données comme source de vérité autant que possible.

Ne pas recopier les adresses en constantes C# dispersées.

## SHA-256

Le lanceur `PlayerLauncher` possède le chemin de la ROM choisie avant de lancer BizHawk.

Il doit calculer localement :

```text
SHA-256 ROM
```

puis transmettre cette identité **en mémoire uniquement** au `GameAdapterManager`.

Le SHA complet :

```text
NE DOIT PAS être envoyé au navigateur
NE DOIT PAS être affiché publiquement
NE DOIT PAS être requis par le serveur
```

Il sert uniquement à sélectionner localement un profil mémoire validé.

Ne pas supposer que `game.Hash` renvoyé par BizHawk utilise le même algorithme que le manifeste existant.

Si le client est lancé en mode `run` sans chemin de ROM disponible et qu'aucune identité exacte ne peut être établie :

```text
GameAdapter = non activé
status = rom_identity_unavailable
```

Ne jamais deviner le profil.

---

# 7. Profils mémoire

Le client doit consommer les profils existants depuis :

```text
emulator/profiles/
```

Au build/publish, les profils nécessaires doivent être intégrés au client ou copiés de façon déterministe dans son artefact.

Le binaire distribué doit fonctionner sans dépendre du checkout Git.

Préférer des ressources embarquées ou un dossier de profils inclus dans l'artefact.

Ne pas créer deux sources de vérité divergentes pour les mêmes adresses.

---

# 8. Premier adaptateur supporté

Implémenter uniquement :

```text
Pokémon Emerald
Gen III
GBA
```

Commencer par le profil réellement validé présent dans le manifeste.

Si plusieurs profils sont présents mais pas validés au même niveau, l'adaptateur doit annoncer clairement leur statut et ne pas activer les lectures risquées comme si tout était confirmé.

La détection doit suivre :

```text
system == GBA
+
SHA-256 exact dans le manifeste
+
profil associé valide
```

Sinon :

```text
adapterStatus = unsupported / unknown_rom
```

---

# 9. Portage du lecteur Gen III

Utiliser comme référence le code déjà existant dans :

```text
emulator/lua/extractor.lua
```

et les profils existants.

Ne pas réinventer les structures Gen III sans justification.

Porter en C# uniquement les parties nécessaires à la lecture :

```text
SaveBlock1
SaveBlock2
trainer
money
location
party count
party
progression
```

Pour les Pokémon Gen III, conserver les vérifications déjà présentes dans l'implémentation actuelle :

```text
structure 100 octets
personality
OT ID
permutation des substructures
XOR / déchiffrement
checksum
species
niveau
PV
shiny
```

Une structure invalide doit être rejetée ou marquée invalide, pas partiellement interprétée silencieusement.

---

# 10. Domaines mémoire BizHawk

Le GameAdapter doit demander les domaines disponibles via :

```text
listMemoryDomains
```

Il ne doit pas supposer sans test qu'un nom de domaine mémoire est identique sur tous les cores.

Le mapping utilisé par le profil/adaptateur doit être explicite et testé.

Si le domaine attendu est absent :

```text
adapterStatus = memory_domain_unavailable
```

et aucune lecture arbitraire ne doit être tentée.

---

# 11. Snapshot normalisé

Créer un modèle propre au nouveau client.

Exemple :

```csharp
public sealed record GameSnapshot(
    GameIdentity Game,
    TrainerSnapshot? Trainer,
    LocationSnapshot? Location,
    IReadOnlyList<PokemonSnapshot> Party,
    ProgressionSnapshot? Progression,
    DateTimeOffset ObservedAt);
```

Le format réseau peut ressembler à :

```json
{
  "gameStateVersion": 1,
  "adapter": {
    "id": "pokemon-gen3-emerald",
    "status": "ready",
    "profileId": "emerald-fr-bpef-v0"
  },
  "game": {
    "family": "pokemon",
    "generation": 3,
    "title": "emerald",
    "language": "fr",
    "revision": "BPEF v0"
  },
  "trainer": {
    "name": "BEN",
    "money": 12500,
    "playTimeSeconds": 12345,
    "partyCount": 3
  },
  "location": {
    "mapGroup": 0,
    "mapNumber": 9,
    "label": "..."
  },
  "party": [
    {
      "slot": 1,
      "speciesId": 255,
      "speciesName": "Poussifeu",
      "nickname": "POUSSIFEU",
      "level": 12,
      "currentHp": 30,
      "maxHp": 34,
      "shiny": false
    }
  ],
  "progression": {
    "version": 1,
    "completed": []
  },
  "capabilities": [
    "trainer.read",
    "money.read",
    "party.read",
    "location.read",
    "progression.read"
  ],
  "observedAt": "2026-10-03T...Z"
}
```

Le SHA-256 complet de la ROM ne doit pas figurer dans ce payload public.

---

# 12. Capabilities

Introduire des capacités normalisées.

Pour cette étape :

```text
trainer.read
money.read
party.read
location.read
progression.read
```

Ne pas annoncer :

```text
money.write
party.write
pokemon.write
battle.write
```

même si le bridge sait techniquement écrire en mémoire.

Une capacité signifie :

```text
fonction GameAdapter implémentée + validée
```

et non simplement :

```text
bridge connecté
```

---

# 13. Boucle de lecture

Le `ClientRuntime` doit lancer la lecture du GameAdapter lorsque :

```text
bridge connecté
jeu chargé
adaptateur reconnu
profil validé
```

Fréquence par défaut raisonnable :

```text
500 ms à 1 seconde
```

Ne pas lire à chaque frame.

Le client doit :

```text
READ SNAPSHOT
→ valider
→ comparer au dernier snapshot
→ envoyer seulement si utile
```

Le heartbeat reste indépendant.

Une erreur ponctuelle de lecture ne doit pas tuer le processus client.

Après plusieurs erreurs, publier un état d'adaptateur en erreur puis continuer les tentatives raisonnables.

---

# 14. Nouvel événement Socket.IO

Ajouter côté `/client` un événement dédié, par exemple :

```text
GAME_STATE
```

Le contrat doit être validé strictement côté API.

Exemple :

```json
{
  "type": "GAME_STATE",
  "protocolVersion": 1,
  "gameStateVersion": 1,
  "state": { }
}
```

Le changement est additif au protocole `/client` actuel.

Si Codex estime qu'un changement de `protocolVersion` est réellement requis, il doit l'expliquer dans la documentation et mettre à jour client + serveur + tests ensemble. Ne pas casser silencieusement la version 1.

---

# 15. État GameAdapter sans jeu supporté

Le client doit pouvoir annoncer un état d'adaptateur même sans snapshot détaillé.

Exemples :

```text
no_game
unsupported_system
unknown_rom
rom_identity_unavailable
profile_not_validated
memory_domain_unavailable
ready
read_error
```

Le Web doit pouvoir distinguer :

```text
BizHawk fonctionne
```

et :

```text
Pokérace sait lire ce jeu
```

---

# 16. Projection publique du client natif

Ne jamais envoyer directement l'état interne complet de `native-clients.ts` au navigateur.

Créer un type public partagé, par exemple :

```ts
export type PublicNativeClient = {
  accountId: string;
  playerId: string;
  playerName: string;
  ready: boolean;
  lastSeenAt: string;
  clientVersion: string | null;
  platform: string | null;
  emulator: { name: "BizHawk" } | null;
  bridge: {
    type: "bizhawk";
    connected: boolean;
    gameLoaded: boolean;
    protocolVersion: number | null;
  };
  system: string | null;
  allowMemoryWrites: boolean;
  adapter: {
    id: string | null;
    status: string;
    profileId: string | null;
    capabilities: string[];
  };
  gameState: PublicNativeGameState | null;
};
```

Adapter précisément aux données réellement disponibles.

---

# 17. Données interdites côté navigateur

La projection publique ne doit jamais contenir :

```text
roomCode
sessionToken
POKERACE_BRIDGE_TOKEN
socketId
adresse mémoire
dump mémoire
réponse readMemory brute
ADMIN_TOKEN
headers d'authentification
SHA-256 complet de ROM
chemin local de la ROM
chemin de sauvegarde
```

Ajouter des tests explicites.

---

# 18. Identité joueur

Le frontend doit rattacher le client au portail via :

```text
accountId
```

Ne pas supposer :

```text
playerId === accountId
```

Tester explicitement le cas où ils sont différents.

---

# 19. API REST

Ajouter ou conserver :

```http
GET /api/native-clients
```

La réponse doit contenir l'état public du client et, si disponible, son `gameState` normalisé.

Cette route reste une route de lecture.

Aucune commande mémoire brute ne doit être exposée en HTTP.

---

# 20. Temps réel `/dashboard`

Ajouter un événement :

```text
native-clients
```

Le dashboard reçoit :

```text
état initial à la connexion
+
modification client
+
modification bridge
+
chargement/fermeture jeu
+
changement GameAdapter
+
nouveau GameState utile
+
déconnexion
```

Éviter de broadcaster inutilement un snapshot identique plusieurs fois par seconde.

---

# 21. Frontend — affichage client natif

Dans la page `Équipes`, afficher une section dédiée au nouveau client.

Exemple :

```text
BEN                              ● LIVE

Client Pokérace                  ✅ connecté
BizHawk                          ✅ connecté
Jeu                              ✅ chargé
Système                          GBA
GameAdapter                      ✅ Pokémon Emerald Gen III
Profil                           emerald-fr-bpef-v0
Écritures mémoire locales        🔒 désactivées
Plateforme                       windows-x64
Client                           v0.1.0
```

Si l'adaptateur est prêt, afficher ensuite les données détaillées :

```text
Dresseur
Argent
Position
Équipe
Progression
```

Réutiliser autant que possible les composants visuels existants.

Ne pas refaire tout le design.

---

# 22. Web — ne plus être globalement « Émeraude uniquement »

Dans `apps/web/src/App.tsx`, remplacer :

```text
POKÉMON ÉMERAUDE • COURSE EN DIRECT
```

par :

```text
POKÉRACE • COURSE EN DIRECT
```

Mais ne pas prétendre que toutes les générations sont supportées.

Le Web doit afficher le support réel :

```text
Système : GBA
Jeu : Pokémon Emerald
GameAdapter : supporté
```

ou :

```text
Système : NDS
GameAdapter : non disponible
```

---

# 23. Coexistence avec `/agent`

Pendant cette étape, les deux pipelines restent valides :

```text
/agent
→ ancien état Pokémon mGBA/Lua

/client
→ nouveau état BizHawk/GameAdapter
```

Ne pas supprimer `/agent`.

Si les deux existent pour le même compte, le Web doit éviter d'afficher deux joueurs distincts.

Créer un ViewModel par `accountId` capable d'afficher :

```text
connexion native
+
ancien état historique éventuel
+
nouveau GameState éventuel
```

Le nouveau GameState ne doit pas automatiquement déclencher les anciennes commandes Lua.

---

# 24. Source prioritaire pour l'affichage

Pour un compte donné :

```text
si nouveau gameState natif valide → l'utiliser pour l'affichage lecture seule
sinon si ancien /agent disponible → afficher l'état historique
sinon → afficher uniquement l'état du client natif
```

Cette priorité concerne uniquement l'affichage.

Elle ne modifie pas encore le routage des commandes métier.

---

# 25. Parties du Web à adapter dans cette étape

Mettre à jour en priorité :

```text
Équipes
statut joueur
argent affiché
position
party
progression
```

Les pages :

```text
Enchères
Roulette
Bibliothèque
```

peuvent lire le nouveau snapshot si cela ne change pas leur comportement, mais leurs **commandes doivent encore rester sur l'ancien pipeline** jusqu'à leur migration dédiée.

Ne pas envoyer une commande Lua à un joueur qui n'a que `/client`.

Dans ce cas, désactiver proprement l'action avec un message :

```text
Cette action n'est pas encore disponible avec le nouveau client BizHawk.
```

---

# 26. Tests GameAdapter obligatoires

Créer des tests C# sans ROM privée et sans PC du développeur.

Utiliser un faux bridge/mémoire pour construire des fixtures Gen III synthétiques.

Tester au minimum :

```text
profil reconnu
ROM inconnue refusée
identité ROM indisponible refusée
mauvais système refusé
domaine mémoire manquant
trainer lu correctement
money lu correctement
partyCount lu correctement
party 1 Pokémon
party 6 Pokémon
slot vide
Pokémon shiny
Pokémon K.O.
checksum invalide
structure Pokémon invalide
location
progression
reconnexion bridge
changement de jeu
```

---

# 27. Test du SHA et du profil

Tests obligatoires :

```text
SHA exact connu
→ profil activé

SHA différent d'un octet
→ profil refusé

aucun SHA
→ aucune lecture profilée
```

Le test doit prouver qu'une ROM inconnue ne déclenche aucune lecture aux adresses Pokémon du profil.

---

# 28. Tests de lecture mémoire

Les tests doivent remplir la mémoire factice avec des structures contrôlées.

Exemple :

```text
FakeBridge
  domain System Bus
  SaveBlock pointers
  Trainer
  Money
  Party
```

Puis :

```text
Gen3GameAdapter.ReadSnapshotAsync()
```

et vérifier le snapshot exact.

Ne pas dépendre d'une ROM Pokémon dans la CI.

---

# 29. Test E2E BizHawk

Le E2E existant avec la ROM homebrew doit continuer à passer.

Il ne peut pas valider le GameAdapter Pokémon, car la ROM de test est NES et n'est pas Pokémon.

Ajouter au minimum un scénario prouvant que :

```text
NES homebrew
→ bridge OK
→ client OK
→ GameAdapter status = unsupported_system
→ aucun crash
```

Ne jamais ajouter une ROM Pokémon au repository ou aux artefacts CI.

---

# 30. Tests API obligatoires

Tester :

```text
/client se connecte
HELLO valide
GET /api/native-clients contient le client
BRIDGE_STATUS mis à jour
CLIENT_STATUS mis à jour
GAME_STATE valide accepté
GAME_STATE invalide refusé
capabilities projetées
accountId conservé
playerId différent de accountId
déconnexion retire le client
```

Tester aussi qu'un payload GameState trop gros ou invalide ne fait pas tomber le serveur.

---

# 31. Tests de sécurité obligatoires

Sérialiser la projection publique et vérifier l'absence de :

```text
roomCode
socketId
sessionToken
token
ADMIN_TOKEN
memory
address
romSha256
romPath
savePath
raw Pokemon 100-byte copy
```

Le nouveau Web n'a besoin que des données normalisées pour l'affichage.

---

# 32. Tests Socket.IO obligatoires

Tester :

```text
/dashboard reçoit native-clients initial
/client se connecte
/dashboard reçoit mise à jour
/client envoie GAME_STATE
/dashboard reçoit nouveau GameState
/client change de jeu
/dashboard reçoit nouveau statut adaptateur
/client se déconnecte
/dashboard retire le client
```

---

# 33. Tests Web

Ajouter des tests sur les ViewModels/helpers.

Tester au minimum :

```text
client natif seul
ancien /agent seul
client natif + /agent même accountId
nouveau GameState prioritaire pour affichage
GameAdapter unsupported
GameAdapter ready
party affichée
money affiché
progression affichée
action historique désactivée si /agent absent
```

Si nécessaire, extraire :

```text
buildPlayerViewModel(...)
```

comme fonction pure facilement testable.

---

# 34. Compatibilité historique

Ne pas casser :

```text
/api/players
/dashboard players
/agent
roulette
auctions
library
progression
accounts
player.cmd
```

Aucune suppression de code historique dans cette étape.

---

# 35. Aucune commande mémoire brute dans le Web

Interdit d'ajouter :

```text
READ_MEMORY
WRITE_MEMORY
éditeur d'adresse
console mémoire
domaine mémoire sélectionnable dans le navigateur
```

Le navigateur doit parler uniquement en notions applicatives.

Les futures écritures passeront par :

```text
Web
→ API
→ commande métier
→ Pokerace.Client
→ GameAdapter
→ Bridge
→ BizHawk
```

---

# 36. Build et tests obligatoires

Avant de considérer la tâche terminée :

```bash
npm ci
npm run build -w @pokerace/shared
npm run typecheck -w @pokerace/api
npm run test -w @pokerace/api
npm run typecheck -w @pokerace/web
npm run test -w @pokerace/web
npm run build -w @pokerace/web

dotnet restore native/Pokerace.Client/Pokerace.Client.sln
dotnet build native/Pokerace.Client/Pokerace.Client.sln --configuration Release
dotnet test native/Pokerace.Client/Pokerace.Client.sln --configuration Release --no-build
```

Les tests bridge existants doivent également rester verts si un contrat bridge partagé est touché.

---

# 37. CI

Mettre à jour les workflows existants afin de couvrir :

```text
shared
API
Web
Client
GameAdapter tests
E2E BizHawk existant
```

Ne pas créer des workflows redondants sans raison.

---

# 38. Critères de validation

La tâche est terminée uniquement si :

```text
[ ] /api/native-clients existe
[ ] /dashboard pousse native-clients
[ ] aucun secret n'est exposé
[ ] playerId/accountId restent distincts
[ ] statut client visible dans le Web
[ ] statut bridge visible
[ ] système visible
[ ] GameAdapter status visible
[ ] profils mémoire chargés de façon déterministe
[ ] SHA-256 local exact sélectionne le profil
[ ] ROM inconnue ne lit aucune adresse profilée
[ ] Gen3GameAdapter lit trainer
[ ] Gen3GameAdapter lit money
[ ] Gen3GameAdapter lit party
[ ] Gen3GameAdapter lit location
[ ] Gen3GameAdapter lit progression
[ ] capabilities correctes
[ ] GAME_STATE envoyé via /client
[ ] API valide strictement GAME_STATE
[ ] Web affiche le nouveau snapshot
[ ] fallback /agent fonctionne encore
[ ] aucune commande métier n'est migrée prématurément
[ ] enchères historiques fonctionnent encore
[ ] roulette historique fonctionne encore
[ ] bibliothèque historique fonctionne encore
[ ] tests C# verts
[ ] tests API verts
[ ] tests Web verts
[ ] build Web vert
[ ] E2E BizHawk existant vert
```

---

# 39. Résultat attendu

Avec une ROM Émeraude **exactement reconnue** par un profil validé :

```text
BEN                                 ● LIVE

Client Pokérace                     ✅ connecté
BizHawk                             ✅ connecté
Système                             GBA
Jeu                                 Pokémon Emerald
GameAdapter                         ✅ Gen III
Profil                              emerald-fr-bpef-v0

Dresseur                            BEN
Argent                              12 500 ₽
Position                            ...
Équipe                              3 / 6
Progression                         disponible

Écritures métier via nouveau client
                                    pas encore activées
```

Avec une ROM GBA inconnue :

```text
Client Pokérace                     ✅
BizHawk                             ✅
Système                             GBA
Jeu chargé                          ✅
GameAdapter                         ⚠️ ROM non reconnue
Données Pokémon                     indisponibles
```

Aucune adresse mémoire Pokémon ne doit alors être lue.

---

# 40. Étape suivante après ce README

Ne pas l'implémenter ici.

La prochaine étape sera la **migration des commandes métier** vers le nouveau GameAdapter :

```text
money.write
pokemon.give
pokemon.remove
pokemon.replace
party.write
```

Puis migration progressive de :

```text
enchères
roulette
bibliothèque
cadeaux / sabotages
```

Une fois Emerald totalement fonctionnel avec le nouveau pipeline, ajouter les autres générations sans modifier le bridge :

```text
Gen IV
Gen V
Gen VI
Gen VII
```
