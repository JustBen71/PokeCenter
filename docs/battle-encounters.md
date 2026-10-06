# Combats commandités (Battle Encounters)

Le portail demande au client d'un joueur de déclencher **dans sa propre partie** un vrai combat de dresseur contre une équipe entièrement décidée par Pokérace. Ce n'est pas du PvP temps réel : le joueur affronte avec sa propre équipe une équipe adverse contrôlée par l'IA du jeu. XP, montées de niveau, K.O., argent, évolutions et attaques apprises sont **ceux du jeu**. Rien n'est restauré côté joueur.

```text
Roue / Admin / (Duel, Passif, Événement : à venir)
        │  BattleBuilder (Miroir, joueur, #1, personnalisée) + BattleScalingService
        ▼
BattleEncounterService ── battle_encounters (spec figée, cycle de vie, audit BATTLE)
        │  game.battle.start dès que le jeu est dans un état sûr
        ▼
GameCommandService → Pokerace.Client → Gen3BattleEncounter → bridge compareWrite → BizHawk → Émeraude
```

Le serveur ne connaît aucune adresse mémoire ; le portail décide **qui** affronter et **comment** (niveaux, attaques, apparence), le GameAdapter décide seulement **comment déclencher proprement** le combat.

## Spec envoyée au jeu (`BattleEncounterSpec`)

```json
{"encounterId":"uuid","trainer":{"name":"TIMÉO","spriteId":"cooltrainer_m"},
 "party":[{"speciesId":257,"level":42,"moves":[53,339,280,163],"heldItem":0,"nature":3,"ev":40,"personality":28}],
 "options":{"rewardMode":"GAME_DEFAULT"}}
```

| Champ | Règle |
|---|---|
| `trainer.name` | 1 à 7 caractères de la **table du jeu** (accents compris), normalisé NFC ; jamais d'octets bruts venus du Web |
| `trainer.spriteId` | Catalogue partagé : `youngster`, `bug_catcher`, `rich_boy`, `camper`, `cooltrainer_m` (Gamin, Scout, Richard, Campeur, Topdresseur), `lass`, `school_kid_f`, `lady`, `picnicker`, `cooltrainer_f` (Fillette, Écolière, Mademoiselle, Pique-niqueuse, Topdresseuse) |
| `party` | 1 à 6 ; espèce nationale 1..386, niveau 1..100, 1 à 4 attaques distinctes 1..354, objet 0..376, nature 0..24, EV 0..255 |
| `personality` | Facultatif ; copie exacte (nature, genre, talent). Doit vérifier `personality % 25 = nature`. Sinon dérivé de la nature |

Limites du mécanisme Gen III utilisé (voir plus bas) : **IV fixés à 15**, **un seul EV par Pokémon appliqué aux 6 statistiques** (le builder Miroir prend la moyenne, comme le jeu pour les bases secrètes), pas de surnom affiché (nom d'espèce), **stats calculées par le jeu** à partir du niveau, de la nature et des EV (mode « calculé » ; le mode « stats explicites » n'est pas disponible). PV et PP pleins, aucun statut.

## Builders et scaling

| Builder | Source | Instantané |
|---|---|---|
| `MIRROR` | équipe actuelle du joueur qui combat | copies exactes Gen III envoyées par son client |
| `OTHER_PLAYER` | équipe actuelle d'un autre joueur | idem, au moment de la création |
| `LEADER` | équipe du #1 (hors le joueur), classement serveur identique à la page Course | idem |
| `CUSTOM` | équipe saisie par l'admin | — |

Une équipe source illisible (client hors ligne, copie exacte absente) est refusée (`BATTLE_SOURCE_UNAVAILABLE`) plutôt que devinée ; les œufs sont ignorés. **Une fois le combat créé, l'équipe adverse ne change plus**, même si la source progresse avant le départ.

`BattleScalingService` : `COPY_EXACT`, `DELTA_LEVEL` (±N), `MATCH_PLAYER_AVERAGE` (moyenne du joueur ±N), `MATCH_PLAYER_HIGHEST` (plus haut niveau du joueur ±N), `CUSTOM_LEVELS`. Les niveaux se décalent **en bloc** (écarts relatifs conservés), bornés à 1..100 ; les attaques sont conservées (`KEEP_EXISTING_MOVES`). Exemple : source 50/48/52, moyenne cible 35 → 35/33/37.

## Cycle de vie

```text
CREATED → WAITING_SAFE_STATE → SENDING → STARTING → RUNNING → WON | LOST
                  ▲     │           │                            (DRAW = LOST, ABORTED = FAILED)
                  └─────┘ not_safe   └→ REVIEW (ACK perdu) → RUNNING | WON | LOST | FAILED | CANCELLED
```

- **Un seul combat** en attente, en cours ou à vérifier par joueur (index unique) ; un second est refusé avant toute création (`BATTLE_ALREADY_PENDING`).
- **État sûr** : le combat part dès que le jeu du joueur publie `safe` (sur la carte, aucun script, contrôles libres), y compris immédiatement à la mise en file. Sinon il **attend dans la file** sans délai maximal ; un admin peut l'annuler. Le client revérifie l'état au moment d'écrire : s'il a bougé, il refuse (`not_safe`) et le combat retourne en file.
- **Idempotence** : chaque tentative a un `commandId` neuf (un refus n'est jamais mis en cache pour la suivante) ; le client refuse de démarrer deux fois le même `encounterId` et renvoie l'état connu.
- **REVIEW** : confirmation perdue → jamais renvoyé automatiquement. Le client publie son état (`activeEncounterId`, dernier résultat) à chaque observation : le serveur résout alors RUNNING, WON ou LOST. Un démarrage incertain que le client n'a jamais vu reste à un admin (annulation, ou « Opérations à vérifier » : non appliqué = FAILED).
- **Défaite** : le combat passe LOST et reste dans l'historique du joueur (tiroir, audit `battle.lost`, notification). Le statut de la Run reste géré par les règles de course (pas de Run perdue automatique).
- **Redémarrages** : client (fichier `battle-encounters.json` à côté de `client.json`) et serveur (base) — le résultat est rapporté une seule fois.

Audit `BATTLE` : `battle.created`, `battle.start_requested`, `battle.sent`, `battle.started`, `battle.won`, `battle.lost`, `battle.failed`, `battle.review`, `battle.cancelled`.

## Implémentation Gen III (Émeraude FR BPEF v0)

Mécanisme du jeu lui-même (`pret/pokeemerald`) : le **combat de dresseur « base secrète »**. Pour `TRAINER_SECRET_BASE`, `CreateNPCTrainerParty` ne régénère pas l'équipe ; `AllocateBattleResources` appelle `CreateSecretBaseEnemyParty(&gSaveBlock1Ptr->secretBases[VAR_CURRENT_SECRET_BASE])` : l'équipe (espèce, niveau, attaques, objet, personnalité, EV), le nom et la classe de dresseur viennent d'un enregistrement en RAM.

Le client arme le combat en **un seul `compareWrite`** (une frame), refusé si l'état n'est plus celui lu :

1. enregistrement temporaire `secretBases[19]` (emplacement vide) = dresseur et équipe ; `VAR_CURRENT_SECRET_BASE = 19` ;
2. ce que fait `PrepSecretBaseBattleFlags` : `gTrainerBattleOpponent_A = TRAINER_SECRET_BASE`, `gBattleTypeFlags = TRAINER | SECRET_BASE`, `gSpecialVar_0x8004 = SPECIAL_BATTLE_SECRET_BASE` ;
3. le contexte de script global pointe des **octets existants de la ROM** `special DoSpecialTrainerBattle ; waitstate ; return`, avec pour adresse de retour une séquence `releaseall ; end` ; statut `CONTEXT_RUNNING`, contrôles verrouillés.

Le jeu exécute ensuite **son** flux normal (transition, combat, retour à la carte). Aucun script ne vit en RAM pendant le combat. Au retour sur la carte, le client lit `gBattleOutcome` (1 victoire, 2 défaite, 3 égalité), retrouve l'enregistrement et la variable par le pointeur courant (les save blocks bougent pendant un combat) et **restaure uniquement eux**. Si aucun écran de combat n'apparaît dans les 20 s, le combat est abandonné (`ABORTED`) et restauré.

Conséquences de ce mécanisme : argent gagné = 20 × niveau du premier Pokémon adverse ; une défaite ramène sur la carte sans blackout ni perte d'argent (règle Pokérace : le joueur recommence de lui-même) ; les objets tenus consommés par le joueur pendant le combat lui sont rendus par le jeu (`HandleSpecialTrainerBattleEnd`).

### Adresses (`emulator/profiles/emerald-fr-bpef-v0.json`, section `battle`)

Toutes ont été retrouvées dans **le code de la ROM FR** (aucune adresse inventée, aucune reprise aveugle de la version US) :

| Élément | Adresse | Preuve |
|---|---|---|
| `gMain` / `CB2_Overworld` | `0x030022C0` / `0x08085E6D` | callbacks en ROM, compteur VBlank croissant ; callback2 sur la carte |
| contexte de script global / statut / verrou | `0x03000E40` / `0x03000E38` / `0x03000F2C` | deux `ScriptContext` dont `cmdTable` = `0x081DB39C` (227 commandes) |
| table des specials | `0x081DB784` | 527 pointeurs (= `data/specials.inc`) |
| `gTrainerBattleOpponent_A`, `gBattleTypeFlags` | `0x02038BCA`, `0x02022FEC` | literal pool de `PrepSecretBaseBattleFlags` (special 16), constante `0x08000008` |
| `gSpecialVar_0x8004` | `0x020375E0` | `DoSpecialTrainerBattle` (special 239) : `ldr r2,=0x020375E0 ; ldrh ; switch` |
| `gBattleOutcome` | `0x0202433A` | `GetBattleOutcome` (special 183) |
| script de combat / fin | `0x0825A7A8` / `0x082003D5` | octets `25 EF 00 27 03` / `6B 02` |
| SaveBlock1 vars / bases secrètes | `+0x139C` / `+0x1A9C` (20 × `0xA0`) | struct `SaveBlock1` ; offset des drapeaux `0x1270` du profil identique |

La capability `battle.trainer.start` n'est annoncée que pour un profil dont la section `battle` est `write-validated`, avec les écritures autorisées localement (`allowPokemonPurchases`) et un bridge transactionnel. Le profil anglais n'en a pas.

## Roues

Gage `START_BATTLE` : `builder` (`MIRROR`, `OTHER_PLAYER`, `LEADER`), `fighter` (`OWNER` = bénéficiaire, `TARGET` = cible d'une roue hostile), `scaling`, `spriteId` facultatif. La cible est demandée après le tirage quand elle combat ou quand l'équipe adverse est la sienne. Le gage est un succès quand le combat est créé et mis en file ; l'overlay suit ensuite le combat (« ⚔ Combat contre … », « ✅ Victoire », « ❌ Défaite »).

## Interface et API

- **Gestion → Combat commandité** (admin) : joueur, équipe adverse, niveaux, nom et apparence → **Prévisualiser** (exactement ce que le jeu recevra : JOUEUR VS DRESSEUR, moyennes, équipe finale) → **Lancer le combat** ; liste et annulation.
- **Course** : bandeau « ⚔ Combat Pokérace VS … » ; tiroir joueur : historique des combats commandités.

| Route | Qui |
|---|---|
| `GET /api/lobbies/:id/battles`, `GET …/battles/:battleId` | membre |
| `POST …/battles/preview`, `POST …/battles`, `POST …/battles/:battleId/start`, `…/cancel` | admin (un joueur n'envoie jamais de spec) |

Sujet temps réel `battles`.

## Validation

- Synthétique : contrats (shared), service, scaling, builders, dispatch, roues, redémarrage serveur (API) ; spec, encodage de l'enregistrement, armement, suivi, restauration après déplacement des save blocks, abandon (client C#) ; Playwright (Gestion → victoire, roue → défaite).
- **Réel** (6 octobre 2026, BizHawk 2.11.1 Linux, BPEF v0, sauvegardes de test) : prototype puis client complet : combat Miroir de Claude (3 Poussifeu niv. 3/2/2, « TOPDRESSEUR CLAUDE »), XP réelle (Poussifeu niv. 6 → 8), +60 ₽, retour normal sur la carte, WON enregistré, RAM restaurée. Voir la recette ci-dessous pour la défaite.

### Recette manuelle (copie de sauvegarde)

Lancer le jeu, rester sur la carte, créer un combat Miroir dans Gestion, vérifier le nom, le sprite et l'équipe ennemie, gagner, vérifier XP, PV/PP et argent, sauvegarder, recharger, vérifier la cohérence ; puis perdre un combat et vérifier le retour sur la carte et l'état LOST dans l'historique.

## Hors périmètre

PvP temps réel, câble Link, netplay, combats doubles et sauvages (`battle.double.start`, `battle.wild.start`), stats explicites, IV par statistique, surnoms adverses, récompense personnalisée (`NO_REWARD`, `CUSTOM_REWARD`), duels (le modèle les permet : deux combats croisés à comparer).
