# PokeCenter / Pokérace — Refonte complète du portail en sprints

## Cahier des charges pour Codex

Ce document décrit la **nouvelle architecture fonctionnelle du portail Pokérace** et l’ordre de réalisation attendu.

L’objectif n’est pas de refaire uniquement l’apparence du site : il faut faire évoluer le modèle de données, l’API, le Web et le client natif afin que les fonctionnalités soient **réellement utilisables avec les clients Pokérace connectés à BizHawk**.

Le travail doit être réalisé **par sprints successifs**, chacun livrant un état cohérent, compilable, testé et utilisable.

---

# 1. Contexte actuel à conserver

Branche de travail :

```text
pokerace-client
```

Architecture déjà validée :

```text
BizHawk
   ↓
Pokerace.BizHawkBridge
   ↓ TCP localhost
Pokerace.Client
   ↓ Socket.IO /client
API Pokérace
   ↓
Web
```

Le repository contient déjà notamment :

```text
bridges/bizhawk/
native/Pokerace.Client/
apps/api/
apps/web/
packages/shared/
emulator/profiles/
```

Le nouveau client possède déjà :

```text
GameAdapterManager
Gen3GameAdapter
GAME_STATE
PublicNativeClient
```

Le lecteur Émeraude Gen III sait déjà lire :

```text
trainer.read
money.read
party.read
location.read
progression.read
```

La lecture est uniquement activée sur une ROM exactement reconnue par le manifeste.

Cette base doit être conservée.

---

# 2. Changement de philosophie du portail

L’ancienne interface avait été conçue autour d’un joueur et de son état de partie courant.

Ce modèle n’est plus suffisant.

Le nouveau modèle est :

```text
ACCOUNT
   │
   └── LOBBY
         │
         └── PARTICIPATION / COURSE DU JOUEUR
                  │
                  ├── RUN #1
                  ├── RUN #2
                  └── RUN #3
```

Les termes doivent être employés de manière cohérente dans le code.

## Account

Identité globale d’un utilisateur.

Contient notamment :

```text
id
name
avatar
isAdmin
createdAt
updatedAt
```

Un account n’appartient pas à une seule course.

## Lobby

Un lobby représente un événement Pokérace entre amis.

Il possède :

```text
id
name
inviteCode
createdBy
status
settings
createdAt
```

Les joueurs rejoignent un lobby grâce à son code.

Un administrateur peut créer un lobby.

## Race / LobbyPlayer

Un joueur inscrit dans un lobby possède une participation à la course.

Cette participation continue même s’il perd plusieurs parties.

Exemple :

```text
Timéo
Race
├── Run #1 LOST
├── Run #2 LOST
└── Run #3 RUNNING
```

## Run

Une Run est **une partie / tentative**.

Statuts minimum :

```text
NOT_STARTED
RUNNING
LOST
COMPLETED
ABORTED
```

Une seule Run peut être `RUNNING` par joueur et par lobby.

Une nouvelle Run ne supprime jamais les précédentes.

---

# 3. Principe essentiel : état serveur et état jeu

Il faut clairement distinguer :

```text
DONNÉES SERVEUR
et
DONNÉES DANS LE JEU
```

Exemples de données serveur :

```text
compte
lobby
historique des Runs
banque
jackpot
tickets
protections
bibliothèque Pokémon
logs
configuration des roues
enchères
```

Exemples de données jeu :

```text
Pokédollars en jeu
équipe Pokémon
PV
niveau
position
progression
```

Les données serveur sont persistées dans SQLite.

Les données jeu viennent du client natif et du `GameAdapter`.

---

# 4. Base de données

Codex est explicitement autorisé et encouragé à faire évoluer la base de données.

Le projet utilise déjà SQLite.

Conserver SQLite pour cette application auto-hébergée.

Ne pas introduire PostgreSQL sans nécessité.

Créer un vrai système de migrations/version de schéma si celui-ci n’existe pas encore.

Exemple :

```text
apps/api/src/db/
├── migrations/
│   ├── 001-base.sql
│   ├── 002-lobbies.sql
│   ├── 003-runs.sql
│   └── ...
├── database.ts
└── repositories/
```

Une autre organisation est possible si elle est plus cohérente avec le code existant.

La migration doit préserver les données existantes lorsque cela est raisonnablement possible.

---

# 5. Modèle de données cible

Le modèle exact peut être ajusté par Codex, mais les concepts suivants doivent exister.

```text
accounts
lobbies
lobby_members
runs
pokemon_library
objectives
objective_completions
auctions
auction_bids
wheel_types
wheel_gages
wheel_tickets
wheel_queue
wheel_resolutions
protections
bank_accounts
money_ledger
jackpot
audit_logs
lobby_settings
```

Ne pas mettre toutes les informations dans une énorme colonne JSON.

JSON est acceptable pour :

```text
configuration spécifique d’un gage
snapshot contrôlé
payload de log
paramètres évolutifs
```

mais les relations essentielles doivent être réellement modélisées.

---

# 6. Argent : principe de ledger

Toutes les opérations financières côté serveur doivent passer par un **ledger**.

Ne jamais faire uniquement :

```text
balance = balance - 1000
```

sans conserver de trace.

Créer un modèle ressemblant à :

```text
MoneyTransaction
├── id
├── lobbyId
├── accountId
├── runId?
├── type
├── amount
├── source
├── destination
├── status
├── commandId?
├── createdAt
├── confirmedAt?
└── metadata
```

Types possibles :

```text
BANK_DEPOSIT
BANK_WITHDRAW
AUCTION_PAYMENT
SHOP_PURCHASE
WHEEL_TRANSFER
WHEEL_REWARD
JACKPOT_CONTRIBUTION
JACKPOT_REWARD
ADMIN_ADJUSTMENT
OBJECTIVE_REWARD
```

Statuts :

```text
PENDING
APPLYING
CONFIRMED
FAILED
REVIEW
CANCELLED
```

Une transaction incertaine côté émulateur ne doit jamais être rejouée aveuglément.

---

# 7. Moteur commun de transactions

Les fonctionnalités ne doivent pas appeler directement le bridge.

Architecture obligatoire :

```text
Auction
Bank
Wheel
Shop
Objective Reward
Admin action
       │
       ▼
TransactionService / GameCommandService
       │
       ▼
nativeClients.sendCommand(...)
       │
       ▼
Pokerace.Client
       │
       ▼
GameAdapter
       │
       ▼
Bridge
       │
       ▼
BizHawk
```

Le serveur ne doit jamais connaître les adresses mémoire Pokémon.

---

# 8. Commandes métier client

Le protocole `/client` expose actuellement surtout des commandes bridge génériques.

Il doit évoluer vers des commandes métier.

Exemples :

```text
game.money.get
game.money.add
game.money.remove
game.money.set
game.pokemon.add
game.pokemon.remove
game.pokemon.replace
game.party.snapshot
```

Les noms exacts peuvent être ajustés.

Le principe est obligatoire :

```text
Serveur
→ commande métier
→ GameAdapter
→ mémoire spécifique au jeu
```

et non :

```text
Serveur
→ writeMemory adresse 0x...
```

Les commandes mémoire brutes ne doivent jamais être exposées au navigateur.

---

# 9. Capabilities

Chaque GameAdapter doit déclarer précisément ce qu’il sait faire.

Exemple :

```text
trainer.read
money.read
money.write
party.read
party.write
pokemon.insert
pokemon.remove
location.read
progression.read
```

Le Web doit utiliser ces capabilities.

Exemple :

```text
money.write absent
→ bouton banque désactivé
→ enchères interdites
```

et :

```text
pokemon.insert absent
→ attribution d’enchère impossible
```

Ne jamais déduire le support d’une fonctionnalité uniquement depuis :

```text
system = GBA
```

---

# 10. Jeu lié obligatoire pour les actions sensibles

Un joueur peut consulter le portail sans jeu connecté.

Mais toute opération qui modifie la partie exige :

```text
Pokerace.Client connecté
Bridge connecté
jeu chargé
GameAdapter READY
capability nécessaire disponible
Run RUNNING
```

Sinon l’API doit refuser explicitement.

Exemple :

```text
GAME_NOT_CONNECTED
GAME_ADAPTER_NOT_READY
CAPABILITY_MISSING
RUN_NOT_RUNNING
```

Le Web doit afficher clairement la cause.

---

# 11. Navigation générale

L’ancienne structure visuelle peut être abandonnée.

Créer un nouveau shell cohérent.

Exemple desktop :

```text
┌───────────────────────────────────────────────────────────────┐
│ POKÉRACE   Lobby Octobre                 ₽ 24 350    ⚡ Ben   │
├──────────────┬────────────────────────────────────────────────┤
│ Course       │                                                │
│ Carte        │                                                │
│ Enchères     │                 PAGE ACTIVE                    │
│ Boutique     │                                                │
│ Banque       │                                                │
│ Jackpot      │                                                │
│              │                                                │
│ ADMIN        │                                                │
│ Gestion      │                                                │
│ Bibliothèque │                                                │
│ Roues        │                                                │
│ Logs         │                                                │
└──────────────┴────────────────────────────────────────────────┘
```

Responsive obligatoire.

Le menu admin n’apparaît pas aux non-admins.

---

# 12. Pokédollars toujours visibles

Une fois dans un lobby, le solde Pokédollars **dans le jeu** du compte courant doit rester visible en permanence dans le header.

Exemple :

```text
₽ 24 350
```

Afficher une icône Pokédollar cohérente.

Si le jeu n’est pas connecté :

```text
₽ 24 350
dernière valeur connue
```

ou état indisponible clairement signalé.

Les actions financières doivent rester bloquées si une valeur fraîche et un jeu connecté sont nécessaires.

---

# 13. Sprint 0 — Architecture, base de données et contrats

## Objectif

Préparer la nouvelle architecture sans casser le client existant.

## Travail

Créer/documenter :

```text
Account
Lobby
LobbyMember / Race
Run
MoneyLedger
AuditLog
```

Mettre en place :

```text
migrations SQLite
repositories/services
contrats shared
codes d’erreur communs
```

Créer un service central :

```text
CurrentGameService
```

ou équivalent permettant de résoudre :

```text
account
→ client connecté
→ Run courante
→ GameAdapter
→ capabilities
```

## Tests

Tester :

```text
migration d’une base vide
migration d’une ancienne base
création account
création lobby
adhésion lobby
création Run
une seule Run RUNNING
ledger atomique
rollback transaction DB
```

## Definition of Done

```text
[ ] schéma documenté
[ ] migrations automatiques
[ ] anciens tests verts
[ ] aucune donnée mémoire exposée au Web
```

---

# 14. Sprint 1 — Login simple, comptes et lobby

## Login

Première page :

```text
Qui es-tu ?

[ Ben ▼ ]

[ Entrer ]

ou

[ Créer un compte ]
```

Il n’est pas demandé de construire une sécurité complexe.

C’est un outil entre amis sur un réseau privé.

Conserver néanmoins :

```text
validation serveur
IDs non devinés comme autorisation suffisante pour les actions admin
contrôle du rôle admin côté API
```

Ne jamais faire confiance uniquement au bouton caché du frontend.

## Création de compte

Champs :

```text
Nom
Avatar
Administrateur oui/non
```

Avatars :

```text
sprites de dresseurs existants
sprites Pokémon existants
```

Réutiliser les assets déjà présents.

## Profil

En haut à droite :

```text
avatar
nom
rôle
solde Pokédollars
```

Cliquer ouvre un menu permettant :

```text
changer nom
changer avatar
changer de compte
```

Ne pas autoriser un non-admin à s’auto-promouvoir admin après la création si cela crée un problème fonctionnel.

Le mode exact de promotion peut rester simple pour ce projet privé mais doit être géré côté serveur.

## Lobby

Tout utilisateur peut :

```text
rejoindre lobby par code
```

Admin :

```text
créer lobby
```

Lobby :

```text
nom
code invitation
statut
participants
```

## Definition of Done

```text
[ ] sélection account
[ ] création account
[ ] édition profil
[ ] création lobby admin
[ ] rejoindre par code
[ ] session navigateur restaurée
[ ] permissions API testées
```

---

# 15. Sprint 2 — Runs et page Course

## Objectif

Faire de la page Course le tableau de bord principal.

Chaque membre possède :

```text
Run courante
historique des Runs
```

Admin doit pouvoir au minimum :

```text
démarrer Run
marquer Run perdue
marquer Run terminée
créer nouvelle Run
```

Automatiser plus tard si le GameAdapter permet de détecter précisément une perte.

## Carte joueur

Afficher :

```text
rang
avatar compte
nom joueur
numéro Run
statut Run
position textuelle
Pokédollars
état client
```

Puis les 6 slots Pokémon.

Pour chaque Pokémon :

```text
sprite
espèce
surnom
niveau
PV actuel / max
barre PV
```

## Interaction rapide

Cliquer sur un joueur ouvre un drawer/panneau détaillé.

Cliquer sur un Pokémon ouvre une fiche détaillée.

Ne pas imposer une navigation complète pour consulter une information.

## Temps réel

Utiliser Socket.IO.

Les changements :

```text
PV
niveau
équipe
position
argent
connexion
Run
```

doivent être visibles sans recharger la page.

Ne pas faire de polling toutes les secondes si un événement Socket.IO existe.

## Definition of Done

```text
[ ] historique Run
[ ] Run courante
[ ] équipes natives affichées
[ ] position native
[ ] argent natif
[ ] client déconnecté clairement visible
[ ] temps réel
```

---

# 16. Sprint 3 — Écritures GameAdapter et bibliothèque Pokémon

Cette étape est critique.

## GameAdapter Gen III

Étendre l’adaptateur existant avec les écritures nécessaires.

Minimum :

```text
money.write
pokemon.insert
pokemon.remove
pokemon.replace
```

Réutiliser la logique validée de l’ancien Lua lorsque pertinent.

Ne pas inventer les offsets.

## Cycle d’écriture

Toute écriture doit suivre autant que possible :

```text
RECEIVED
→ VALIDATE
→ WAIT_SAFE_STATE si nécessaire
→ READ_BEFORE
→ WRITE
→ READ_AFTER
→ VERIFY
→ COMPLETED / FAILED / REVIEW
```

Utiliser `commandId` unique.

Pas de retry automatique d’une écriture au résultat incertain.

## Combat

Pour Gen III :

```text
gPlayerParty = persistant
gBattleMons = copie de combat
```

Une modification structurelle de Pokémon pendant un combat peut être dangereuse.

Si l’adaptateur ne peut pas la garantir :

```text
queue pour état sûr
```

ou refus explicite.

## Bibliothèque

Visible uniquement aux admins.

Elle est globale au compte/admin et indépendante des Runs.

Permet :

```text
sauvegarder Pokémon depuis une équipe
supprimer Pokémon de bibliothèque
réinjecter Pokémon
créer Pokémon
```

Le bouton disquette apparaît à côté de chaque Pokémon pour les admins.

Le bouton suppression de Pokémon dans une équipe est également admin uniquement.

## Copie Pokémon

La bibliothèque doit stocker toutes les données nécessaires à une réinsertion fiable dans la génération concernée.

Ne pas limiter le modèle long terme à :

```text
100 octets Gen III
species <= 386
```

Créer une abstraction versionnée.

Exemple :

```text
PokemonArtifact
├── format
├── gameFamily
├── generation
├── species
├── display
└── payload
```

Pour Gen III, le payload peut contenir la structure nécessaire.

## Créateur Pokémon

Deux modes :

```text
Automatique
Manuel
```

Automatique :

```text
espèce
niveau
```

puis calcul :

```text
stats
expérience
attaques
PP
```

à partir d’une API/données existantes.

Manuel : grand formulaire avec tous les champs disponibles.

Conserver le code existant du builder s’il est correct au lieu de le réécrire inutilement.

## Definition of Done

```text
[ ] suppression réelle via client
[ ] insertion réelle via client
[ ] read-after-write
[ ] bibliothèque persistante
[ ] création auto
[ ] création manuelle
[ ] tests mémoire synthétique
[ ] aucune écriture ROM inconnue
```

---

# 17. Sprint 4 — Carte, objectifs et classement

## Page Carte

Visible par tous.

Afficher la carte correspondant au jeu/course du lobby.

Les joueurs sont représentés par **leur avatar de compte**.

Les positions exactes peuvent être regroupées par zone.

## Objectifs

Un lobby possède une liste ordonnée d’objectifs.

Chaque objectif :

```text
id
name
description
order
rewardMoney
mapPosition
gameCondition
```

Afficher :

```text
atteint
non atteint
récompense
```

Les objectifs servent au classement.

## Récompenses d’objectif

Si un objectif verse des Pokédollars :

```text
ObjectiveService
→ MoneyTransaction
→ GameCommandService
→ game.money.add
→ confirmation
→ AuditLog
```

Une récompense ne doit être appliquée qu’une fois.

## Definition of Done

```text
[ ] carte
[ ] avatars
[ ] objectifs
[ ] récompenses visibles
[ ] classement temps réel
[ ] récompenses idempotentes
```

---

# 18. Sprint 5 — Moteur financier, banque et jackpot de base

Avant enchères/boutique/roues, stabiliser l’argent.

## Trois valeurs distinctes

```text
GAME MONEY
BANK MONEY
JACKPOT
```

### Game Money

Argent réel dans la partie.

Source :

```text
GameAdapter
```

### Bank Money

Argent serveur persistant propre au joueur dans le lobby.

### Jackpot

Pot serveur global au lobby.

## Dépôt banque

Exemple :

```text
jeu : -10 000
taxe : 10 %
banque : +9 000
jackpot : +1 000
```

Le pourcentage est configurable par l’admin.

Ordre sûr :

```text
validation
→ verrou joueur
→ commande jeu
→ confirmation
→ transaction DB atomique
→ audit
```

En cas de confirmation incertaine :

```text
REVIEW
```

et blocage d’une répétition automatique.

## Retrait banque

```text
banque : -5 000
jeu : +5 000
```

Pas de taxe par défaut.

## Nouvelle Run

La banque reste disponible quand un joueur perd une Run.

Elle appartient à :

```text
lobby + account
```

et non à la Run.

## Definition of Done

```text
[ ] dépôt
[ ] taxe
[ ] jackpot
[ ] retrait
[ ] persistance entre Runs
[ ] ledger complet
[ ] commandes idempotentes
[ ] verrouillage concurrence
```

---

# 19. Sprint 6 — Enchères

Visible par tous.

Interaction d’administration :

```text
Générer lot
Clôturer
Annuler si nécessaire
```

Les joueurs peuvent miser.

## Génération Pokémon

Le niveau est basé sur la moyenne des Pokémon pertinents des joueurs actifs.

Le Pokémon reçoit :

```text
espèce aléatoire
niveau calculé
stats calculées
IV aléatoires
EV aléatoires
nature aléatoire
```

Réutiliser autant que possible le générateur existant.

## Information cachée

Les vraies stats restent côté serveur.

Le Web reçoit des intervalles :

```text
ATK 45–61
DEF 38–55
...
```

Le vrai chiffre ne doit pas être envoyé au navigateur avant la fin si l’objectif est de le cacher.

## Début de l’enchère

Le lot peut être généré avant.

Les enchères commencent réellement dès la première mise valide d’au moins :

```text
1 ₽
```

## Clôture

Admin clique :

```text
Clôturer
```

Le serveur :

```text
fige le gagnant
vérifie solde frais
vérifie jeu connecté
vérifie place équipe
débite
injecte Pokémon
vérifie
confirme
```

Utiliser un état :

```text
OPEN
SETTLING
SOLD
CANCELLED
REVIEW
```

## Bibliothèque

Après clôture, un admin peut :

```text
Copier le Pokémon du lot vers sa bibliothèque
```

sans le retirer au gagnant.

## Definition of Done

```text
[ ] génération
[ ] stats cachées réellement côté serveur
[ ] mises concurrentes sûres
[ ] clôture admin
[ ] paiement game money
[ ] insertion Pokémon
[ ] copie bibliothèque
[ ] reprise REVIEW
```

---

# 20. Sprint 7 — Roues et gages

## Type de roue

Un admin peut :

```text
créer
modifier
supprimer
```

un type de roue.

Champs :

```text
name
description
price
icon
tone
gages
```

`tone` peut être :

```text
GOOD
BAD
NEUTRAL
```

## Gages

Les définitions peuvent rester simples et JSON/configurées.

Exemple :

```json
{
  "id": "steal-1000",
  "name": "Braquage",
  "description": "Vole 1000 ₽ à la cible.",
  "handler": "STEAL_MONEY",
  "requiresTarget": true,
  "params": {
    "amount": 1000
  }
}
```

Le JSON ne doit pas devenir un langage de programmation.

`handler` correspond à du code serveur testé.

Par défaut, tous les gages d’une roue ont le même poids.

## Résolution

Le résultat est choisi côté serveur **avant l’animation**.

```text
serveur choisit gage
→ enregistre résolution
→ frontend anime
→ frontend s’arrête sur le gage choisi
→ formulaire éventuel
→ application
```

## UI roulette

Overlay au-dessus du site :

```text
fond gris/sombre
roulette verticale
```

Principe :

```text
       gage précédent
       gage précédent

▶      GAGE GAGNANT      ◀

       gage suivant
       gage suivant
```

Animation :

```text
≈ 3 secondes
```

Rapide et lisible.

Ne pas faire une roue circulaire.

## Gage immédiat

Après animation :

```text
application automatique
→ notification succès/échec
```

## Gage avec choix

Après animation :

```text
description complète
select cible
bouton Appliquer
```

Puis application automatique.

## Notification obligatoire

Chaque application affiche :

```text
SUCCESS
ou
FAILED
```

avec message clair.

## Definition of Done

```text
[ ] CRUD roues
[ ] CRUD gages configurables
[ ] handlers codés
[ ] overlay vertical
[ ] résultat serveur déterministe
[ ] 3 sec environ
[ ] choix cible
[ ] notifications
[ ] audit
```

---

# 21. Sprint 8 — Boutique, tickets et protections

## Boutique

Visible aux joueurs et admins.

Affiche les types de roues achetables.

## Icônes

Fournir dix variantes d’icônes de tickets :

```text
green-1
green-2
green-3
green-4
green-5
purple-1
purple-2
purple-3
purple-4
purple-5
```

Les cinq vertes doivent évoquer des tickets positifs/gentils.

Les cinq violettes des tickets plus hostiles/méchants.

Les assets doivent être locaux.

## Achat ticket

Processus :

```text
joueur choisit type
joueur choisit cible si nécessaire
vérification solde
game.money.remove
confirmation
ticket créé
jackpot contribution éventuelle
audit
```

Le ticket n’est pas nécessairement résolu immédiatement.

## Queue

Chaque joueur possède une file `wheel_queue`.

## Gestion admin

Page Gestion :

```text
Résoudre les attaques en attente
```

Admin lance les roues une par une.

## Protection

Une protection annule une roue hostile reçue.

Elle ne peut pas annuler rétroactivement une attaque déjà reçue avant son achat.

Règle attendue :

```text
protection disponible AVANT réception
→ peut bloquer

protection achetée APRÈS réception
→ ne bloque pas cette roue
→ peut bloquer la prochaine
```

## Definition of Done

```text
[ ] boutique
[ ] tickets
[ ] icônes
[ ] achat avec Game Money
[ ] queue persistante
[ ] cible
[ ] protections
[ ] résolution admin
```

---

# 22. Sprint 9 — Jackpot complet

Créer une page publique :

```text
JACKPOT
```

Visible par tous.

Afficher :

```text
montant actuel
historique récent
sources principales
```

## Contribution globale

Les paramètres admin doivent permettre de configurer des pourcentages de contribution.

Exemples :

```text
bankDepositTaxPercent
shopJackpotPercent
auctionJackpotPercent
wheelJackpotPercent
```

Ne pas coder les pourcentages partout.

Utiliser :

```text
LobbySettings
```

## Récompenses Jackpot

Prévoir un service `JackpotService` qui permette à certains gages positifs de :

```text
verser montant fixe
verser pourcentage
partager le jackpot
vider le jackpot
```

avec ledger et logs.

## Definition of Done

```text
[ ] page jackpot
[ ] paramètres admin
[ ] contributions automatiques
[ ] ledger
[ ] gages compatibles
```

---

# 23. Sprint 10 — Gestion administrateur

Page uniquement admin.

Doit centraliser :

```text
Lobby
Runs
Roues
Tickets en attente
Protections
Objectifs
Paramètres financiers
Jackpot
Enchères
```

Ne pas tout mettre dans un seul composant React de 3000 lignes.

Créer des modules/panneaux.

## Paramètres lobby minimum

```text
nom
statut
taxe dépôt banque
contribution jackpot boutique
contribution jackpot enchères
contribution jackpot roues
récompenses objectifs
```

Les futurs réglages doivent pouvoir être ajoutés facilement.

---

# 24. Sprint 11 — Logs / Audit complet

Page admin uniquement.

Toutes les actions significatives doivent produire un audit.

Catégories :

```text
ACCOUNT
LOBBY
RUN
GAME_COMMAND
POKEMON
MONEY
BANK
JACKPOT
AUCTION
WHEEL
TICKET
PROTECTION
ADMIN
ERROR
```

## AuditLog

Minimum :

```text
id
timestamp
lobbyId
actorAccountId?
targetAccountId?
runId?
category
action
status
commandId?
message
errorCode?
metadata
```

Ne jamais logguer :

```text
sessionToken
ADMIN_TOKEN
dump mémoire complet
secret bridge
```

## Interface

Filtres :

```text
joueur
catégorie
succès/erreur
date
commandId
```

En ouvrant une entrée :

```text
transaction
commandId
état
erreur précise
timestamps
```

---

# 25. Notifications globales

Créer un système de notifications/toasts commun.

Toutes les actions utilisateurs doivent produire un retour.

Types :

```text
success
error
warning
info
```

Les erreurs serveur doivent renvoyer des codes stables.

Exemple :

```json
{
  "ok": false,
  "error": {
    "code": "GAME_NOT_CONNECTED",
    "message": "Le jeu de Timéo n'est pas connecté."
  }
}
```

Le frontend traduit/affiche proprement.

Ne pas afficher simplement `Error: 500`.

---

# 26. Temps réel

Le portail est un outil live.

Utiliser Socket.IO pour pousser :

```text
players
game state
balances
runs
ranking
auctions
bids
wheel queue
wheel resolution
jackpot
notifications pertinentes
```

Ne pas créer du polling permanent pour chaque page.

REST reste adapté pour :

```text
création
modification
actions
chargement initial
historique paginé
```

---

# 27. Architecture frontend

Refondre `apps/web` de manière organisée.

Exemple possible :

```text
apps/web/src/
├── app/
├── auth/
├── lobby/
├── course/
├── map/
├── pokemon/
├── library/
├── auctions/
├── wheels/
├── shop/
├── bank/
├── jackpot/
├── admin/
├── audit/
├── api/
├── realtime/
├── components/
└── styles/
```

Ce n’est pas une obligation de nommage mais éviter :

```text
App.tsx = toute l’application
```

---

# 28. Architecture API

Même principe.

Exemple :

```text
apps/api/src/
├── accounts/
├── lobbies/
├── runs/
├── game/
├── transactions/
├── pokemon/
├── library/
├── progression/
├── auctions/
├── wheels/
├── shop/
├── bank/
├── jackpot/
├── audit/
└── realtime/
```

Le fichier `app.ts` doit rester principalement de la composition.

Ne pas y entasser toute la logique métier.

---

# 29. Réutilisation de l’ancien système

Ne pas supprimer du code fonctionnel juste pour le réécrire.

Évaluer et réutiliser :

```text
accounts
avatars
pokemon builder
pokemon library
auction generator
auction rules
roulette handlers pertinents
progression data
sprites
Socket.IO
SQLite
```

En revanche, ne pas forcer l’ancien modèle si celui-ci empêche :

```text
Lobby
Race
Run
Bank
Jackpot
Tickets
```

---

# 30. Compatibilité historique

Pendant la migration, `/agent` peut rester temporairement disponible.

Mais les nouvelles fonctionnalités doivent être conçues pour :

```text
Pokerace.Client + GameAdapter
```

et non pour Lua.

Ne pas ajouter de nouvelle dépendance métier au vieux pipeline.

---

# 31. Multi-génération

Ne pas coder tout le portail en supposant :

```text
Pokémon Emerald
386 espèces
354 attaques
100 octets par Pokémon
```

Le premier GameAdapter réellement complet peut rester Gen III/Émeraude.

Mais les contrats doivent préparer :

```text
Gen I
Gen II
Gen III
Gen IV
Gen V
Gen VI
Gen VII
```

Toutes les fonctionnalités doivent tester les capabilities.

---

# 32. Transactions atomiques et verrous

Créer des verrous logiques par joueur / Run lorsque nécessaire.

Exemple :

```text
une enchère est en train de payer Timéo
```

pendant ce temps une roue ne doit pas retirer simultanément son argent sans sérialisation correcte.

Créer un mécanisme de type :

```text
PlayerActionLock
```

ou transaction queue.

Ne pas dépendre d’un simple booléen global si cela empêche plusieurs joueurs d’agir en parallèle.

---

# 33. Idempotence

Toutes les commandes qui changent le jeu doivent utiliser :

```text
commandId UUID
```

Le serveur conserve suffisamment d’état pour réconcilier une commande après reconnexion.

Une même commande ne doit pas :

```text
débiter deux fois
injecter deux Pokémon
appliquer deux fois une récompense
```

---

# 34. États incertains

Une perte de connexion après une écriture peut donner :

```text
UNKNOWN OUTCOME
```

Ne jamais transformer automatiquement cela en :

```text
FAILED donc on retry
```

Utiliser :

```text
REVIEW
```

Les logs doivent expliquer :

```text
confirmation perdue
état du jeu à vérifier
```

Prévoir une action admin de résolution manuelle lorsque nécessaire.

---

# 35. Tests obligatoires

Chaque sprint doit ajouter ses tests.

Minimum global :

```text
unit tests services
API tests
SQLite integration tests
Socket.IO tests
frontend helper/component tests
client GameAdapter tests
command idempotence
failure/reconnect tests
```

---

# 36. Tests avec Fake Game Client

Créer/maintenir un serveur/client de test permettant de simuler :

```text
joueur connecté
argent
équipe
position
capabilities
écriture réussie
écriture refusée
timeout
déconnexion
reconnexion
```

Ainsi :

```text
Bank
Auction
Wheel
Shop
```

peuvent être testés sans vraie ROM.

---

# 37. E2E réel

Conserver les tests existants :

```text
vrai BizHawk
vrai Bridge
vrai Pokerace.Client
ROM homebrew
```

Pour les fonctions Pokémon Gen III, utiliser :

```text
mémoire synthétique
fixtures légales
```

tant qu’une ROM Pokémon ne peut pas être distribuée dans la CI.

Ne jamais intégrer une ROM commerciale au repository.

---

# 38. Tests Web E2E

Mettre en place si raisonnable un outil E2E navigateur comme Playwright.

Scénarios minimum à terme :

```text
créer compte
créer lobby
rejoindre lobby
afficher joueur
ouvrir Pokémon
admin bibliothèque
enchère
achat ticket
banque
jackpot
roue
logs
```

Le test utilise un Fake Game Client.

---

# 39. Documentation

Chaque module complexe doit avoir une documentation courte.

Créer par exemple :

```text
docs/architecture/
docs/lobbies.md
docs/runs.md
docs/money-ledger.md
docs/game-commands.md
docs/wheels.md
docs/bank-jackpot.md
```

Documenter aussi :

```text
invariants
états
erreurs
transactions
idempotence
```

---

# 40. Style de code

Priorité :

```text
lisible
modulaire
testable
documenté
extensible
```

Éviter :

```text
fichiers géants
copier/coller de logique financière
conditions admin uniquement frontend
adresses mémoire côté serveur
JSON métier non validé
any TypeScript généralisé
catch silencieux
```

Utiliser les schémas Zod partagés lorsque pertinent.

---

# 41. Ordre obligatoire des sprints

Codex doit travailler dans cet ordre :

```text
Sprint 0
DB + modèle + services fondamentaux

Sprint 1
Accounts + Login + Lobby

Sprint 2
Runs + Dashboard Course

Sprint 3
GameAdapter writes + Bibliothèque Pokémon

Sprint 4
Carte + Objectifs + Classement

Sprint 5
Money Engine + Banque + Jackpot base

Sprint 6
Enchères

Sprint 7
Roues + Gages

Sprint 8
Boutique + Tickets + Protections

Sprint 9
Jackpot complet

Sprint 10
Gestion Admin

Sprint 11
Audit / Logs + durcissement final
```

Il est acceptable de déplacer un petit prérequis technique dans un sprint précédent.

Il ne faut pas sauter directement au design de la boutique avant d’avoir un ledger d’argent fiable.

---

# 42. Règle de livraison par sprint

À la fin de chaque sprint, Codex doit fournir :

```text
1. résumé des fonctionnalités livrées
2. fichiers principaux modifiés
3. migrations ajoutées
4. commandes de build
5. commandes de test
6. nombre de tests réussis/échoués
7. fonctionnalités réellement vérifiées
8. limites restantes
9. prochain sprint
```

Ne jamais annoncer une fonctionnalité :

```text
fonctionnelle avec BizHawk
```

si elle a seulement été testée avec un fake.

Utiliser des statuts :

```text
UNIT_VERIFIED
INTEGRATION_VERIFIED
FAKE_GAME_VERIFIED
REAL_BIZHAWK_VERIFIED
MANUAL_VERIFIED
NOT_YET_VERIFIED
```

---

# 43. CI obligatoire

À chaque sprint, garder la CI verte.

Minimum :

```bash
npm ci
npm run build
npm run typecheck
npm test
```

et :

```bash
dotnet restore native/Pokerace.Client/Pokerace.Client.sln
dotnet build native/Pokerace.Client/Pokerace.Client.sln --configuration Release
dotnet test native/Pokerace.Client/Pokerace.Client.sln --configuration Release
```

Conserver les workflows Windows/Linux/macOS et BizHawk E2E si applicables.

---

# 44. Définition finale du portail

À terme un joueur doit pouvoir suivre ce flux :

```text
ouvrir Pokérace
↓
choisir/créer son compte
↓
choisir/créer avatar
↓
rejoindre lobby avec code
↓
lancer Pokerace.Client
↓
jeu détecté
↓
Run courante liée
↓
voir :
    rang
    équipe
    PV
    niveaux
    position
    Pokédollars
    objectifs
↓
miser aux enchères
↓
acheter ticket
↓
utiliser banque
↓
voir jackpot
↓
recevoir/résoudre roues
```

Un admin doit pouvoir :

```text
créer lobby
gérer Runs
voir tous les joueurs
sauvegarder/supprimer Pokémon
créer/réinjecter Pokémon
gérer objectifs
gérer enchères
créer/modifier/supprimer roues
gérer gages
lancer les résolutions
configurer prix/taxes
gérer jackpot
consulter tous les logs
résoudre opérations en REVIEW
```

---

# 45. Schéma fonctionnel final

```text
                                 ┌──────────────────┐
                                 │     ACCOUNT      │
                                 │ nom / avatar     │
                                 │ admin            │
                                 └────────┬─────────┘
                                          │
                                          ▼
                                 ┌──────────────────┐
                                 │      LOBBY       │
                                 │ code invitation  │
                                 │ settings         │
                                 └────────┬─────────┘
                                          │
                         ┌────────────────┼────────────────┐
                         │                │                │
                         ▼                ▼                ▼
                      COURSE           BANK           TICKETS
                         │                │                │
                         ▼                │                ▼
                       RUN               │             WHEEL QUEUE
                         │                │
                         ▼                │
                  LIVE GAME STATE        │
                         │                │
                         └───────┬────────┘
                                 ▼
                         TRANSACTION ENGINE
                                 │
                ┌────────────────┼─────────────────┐
                ▼                ▼                 ▼
             AUCTION           WHEEL            SHOP
                │                │                 │
                └────────────────┼─────────────────┘
                                 ▼
                         GAME COMMAND SERVICE
                                 │
                                 ▼
                         Pokerace.Client
                                 │
                                 ▼
                           GameAdapter
                                 │
                                 ▼
                          BizHawk Bridge
                                 │
                                 ▼
                              BizHawk
```

---

# 46. Règle finale

Le portail doit être construit comme une **plateforme d’événement Pokérace extensible**, pas comme un dashboard Émeraude avec des pages ajoutées au fur et à mesure.

Les nouvelles fonctionnalités doivent pouvoir être ajoutées sans modifier dix endroits différents.

Priorités permanentes :

```text
1. cohérence des données
2. sécurité des écritures jeu
3. idempotence
4. logs
5. temps réel
6. modularité
7. simplicité d’utilisation
8. design clair et rapide
```

Le contexte est un intranet entre amis : la connexion utilisateur doit rester volontairement simple.

La simplicité de connexion ne doit cependant jamais conduire à des transactions incohérentes ou à des écritures mémoire non vérifiées.

Cette tâche doit aboutir à un portail réellement utilisable avec `Pokerace.Client`, `GameAdapter`, `Pokerace.BizHawkBridge` et BizHawk, et pas uniquement à une maquette frontend.
