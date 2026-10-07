# Passifs de course

Un passif est un bonus permanent acquis par un joueur pour **toute sa participation à un lobby** (`LOBBY + ACCOUNT`), jamais pour une Run : perdre une Run ne retire aucun passif. Les passifs sont **cumulatifs** ; un même passif n'est possédé qu'une fois par joueur (`stackableCopies = false`, contrainte unique en base).

## Déroulé

```text
Admin : Gestion → Passifs → « Lancer la course : sélection des passifs »
  → phase SELECTION : 3 passifs différents et compatibles tirés côté serveur pour chaque membre (offre privée)
  → chaque joueur choisit 1 carte (overlay prioritaire), les deux autres sont REJECTED
  → « Démarrer la course » (forçable si quelqu'un n'a pas choisi) → phase DONE, lobby RUNNING
```

Avant le départ, l'admin peut générer une **nouvelle offre** pour un joueur (nouvelle génération, l'ancienne passe `CANCELLED`) ou **annuler un choix** (le joueur rechoisit parmi les mêmes cartes). Une offre rechargée ou après reconnexion est la même. Les cartes non choisies ne sont visibles que par leur joueur ; un passif possédé est public.

La phase de sélection vit dans `passive_settings.phase` (`NONE`, `SELECTION`, `DONE`) et non dans le statut du lobby : la contrainte `CHECK` de `lobbies.status` ne peut pas être élargie sans reconstruire une table dont dépendent toutes les autres (suppressions en cascade).

## Raretés et catalogue

Quatre raretés, poids réglables par lobby : Commun 55, Peu commun 30, Rare 12, Légendaire 3. Le tirage choisit une rareté selon les poids **parmi celles qui ont encore un candidat**, puis un passif de cette rareté. Le générateur aléatoire est injectable (tests déterministes).

Le catalogue est **codé** (`packages/shared/src/passives.ts`, `PASSIVE_CATALOG_VERSION`) : chaque entrée nomme un handler serveur (`apps/api/src/passives/passive-handlers.ts`) et les capabilities dont elle a besoin. Le Web active/désactive un passif et règle les poids, sans jamais créer de logique.

Disponibilité calculée par le serveur :

| Statut | Signification |
|---|---|
| `AVAILABLE` | Handler implémenté et toutes les capabilities validées : proposable et attribuable |
| `DISABLED_MISSING_CAPABILITY` | Une capability n'est pas validée (aucune source mémoire vérifiée) : jamais proposé |
| `NOT_YET_IMPLEMENTED` | Pas de handler : jamais proposé |

Un passif désactivé dans le lobby, incompatible ou déjà possédé est exclu des offres, des roues et de l'attribution admin.

### État du catalogue

| Rareté | Passif | Statut | Mécanique |
|---|---|---|---|
| Commun | Prime de dresseur | IMPLEMENTED | +5 % de la récompense native (argent gagné pendant le combat), payé en plus |
| Commun | Cartographe | IMPLEMENTED | Grandes zones (ville, route ; « Ville — Bâtiment » compte pour la ville) ; ticket bienveillant tous les 5 |
| Commun | Compagnon fidèle | IMPLEMENTED | Compagnon = 1er Pokémon (suivi par sa personnalité) ; 3 objectifs sans qu'il parte : équipe soignée (PV, statut) hors combat |
| Commun | Dernier debout | IMPLEMENTED | Une fois par Run : combat fini avec 1 seul Pokémon conscient → équipe à 50 % de PV au moins |
| Commun | Brocanteur | IMPLEMENTED | 3 enchères perdues : une vraie statistique du prochain lot rejoint, en privé |
| Commun | Éclaireur | IMPLEMENTED | Prochain objectif et sa récompense révélés en privé |
| Commun | Collectionneur | IMPLEMENTED | Espèces différentes dans l'équipe ; ticket bienveillant tous les 10 |
| Peu commun | Deuxième souffle | IMPLEMENTED | +1 500 ₽ au départ d'une Run qui suit une Run perdue (3 fois) |
| Peu commun | Contre-sort | IMPLEMENTED | Une roue hostile d'écart avant le même gage ; repli audité `counterspell_fallback` |
| Peu commun | Rivalité | IMPLEMENTED | Le premier joueur dépassé reçoit un ticket hostile aléatoire |
| Peu commun | Alchimiste | IMPLEMENTED | Une fois par Run : 3 natures tirées au début de la Run, le joueur en applique une (personnalité recalculée, genre/chromatique gardés, stats recalculées) |
| Peu commun | Chasseur de trésors | IMPLEMENTED | Objet aléatoire (hors objets rares/CS) tous les 10 combats de dresseurs gagnés ; en attente si la poche est pleine |
| Peu commun | Le sixième homme | IMPLEMENTED | Nouveau badge avec 6 Pokémon : roue bienveillante, une fois par badge |
| Rare | Marathonien | IMPLEMENTED | +10 000 ₽ tous les 25 000 pas cumulés sur la course |
| Rare | ADN instable | IMPLEMENTED | Une charge tous les 2 objectifs ; une charge = +2 sur une IV au hasard d'un Pokémon choisi |
| Rare | Maître des types | IMPLEMENTED | Objectif atteint avec 6 Pokémon couvrant 10 types (types Gen III) : une CT aléatoire |
| Rare | Résurrection | IMPLEMENTED | Une fois par Run : le Pokémon K.O. revient à 1 PV au lieu d'aller dans la boîte (consommé seulement si le jeu confirme) |
| Rare | Mutagène | IMPLEMENTED | Une fois par Run : 3 attaques apprenables (niveau, CT/CS, tuteur) proposées, une remplace une attaque (PP pleins) |
| Rare | Prime de risque | IMPLEMENTED | Victoire contre un dresseur à moins de 35 % de PV moyens : ticket bienveillant, une fois par nombre de badges |
| Légendaire | Héritier des légendes | IMPLEMENTED | 50 000 pas cumulés : un légendaire niv. 5 (même dresseur, il obéit) rejoint l'équipe dès qu'il y a une place |
| Légendaire | Âme liée | IMPLEMENTED | Copie exacte gardée côté serveur, réinjectée par un admin hors combat après une Run perdue |
| Légendaire | Usurpateur | IMPLEMENTED | Une fois : copie un passif non légendaire d'un adversaire |
| Légendaire | Maître du chaos | IMPLEMENTED | Une fois : roue hostile subie → 3 gages, la cible choisit |
| Légendaire | Paradoxe | IMPLEMENTED | Une fois : annule la dernière action négative réversible (ticket hostile en attente, protection consommée, argent pris par une roue) |
| Légendaire | Couronne du champion | IMPLEMENTED | Tant que #1 : une charge par objectif ; 3 charges = un passif Commun/Peu commun parmi 3 |
| Légendaire | Sixième sens | IMPLEMENTED | Roue bienveillante gagnée → 2 gages, le joueur choisit |
| Légendaire | Lien du destin | IMPLEMENTED | Tous les 3 nouveaux objectifs de l'un, l'autre reçoit un ticket bienveillant |

« Le sixième homme » lit les badges dans les drapeaux de progression déjà validés (`progression.read`) au lieu d'un événement `events.badge_obtained` ; les badges déjà possédés à la première observation servent de référence et ne sont jamais récompensés. Aucune écriture avancée (nature, IV, attaques, objets, CT, PV) n'est validée : rien n'a été activé pour elles (phase H).

## Moteur

```text
Services métier ── événements de domaine (id stable) ──► PassiveEngine ──► handlers des passifs du joueur
  RunService : RUN_STARTED (afterLoss), RUN_LOST          (ordre du catalogue, déterministe)
  ObjectiveService : OBJECTIVE_COMPLETED (initial, batch)         │
  AuctionService : AUCTION_JOINED / LOST / WON                    ├─ progressions (passive_progress)
  WheelService : WHEEL_RESOLVED, filtre hostile, tirage à choix   ├─ récompenses (passive_rewards)
  Client natif : GAME_EVENT                                       └─ modificateurs (filtre de gages, choix)
  Observation de jeu : position, équipe, progression (idempotente)
```

- Un événement est enregistré **une seule fois** par joueur dans `passive_events` (contrainte unique `lobby_id + account_id + event_id`) : rejeu, reconnexion ou double requête ne produisent rien.
- `OBJECTIVE_COMPLETED.initial` marque les premières complétions enregistrées pour un joueur (rattrapage d'une sauvegarde existante) ; `batch` regroupe les objectifs atteints dans la même observation, traités comme un seul mouvement de classement.
- Le classement serveur (`ObjectiveService.scores`) est celui de la page Course : objectifs actifs atteints × 1000 + le plus avancé. Un adversaire est dépassé s'il était devant ou à égalité et se retrouve derrière, et seulement si le rang du joueur s'améliore.
- Un handler peut observer les événements des autres joueurs (`others`, Lien du destin), être utilisé explicitement (`act`, route ci-dessous) ou transformer un tirage de roue en choix (`wheelChoice`).
- Les clés de progression commençant par `_` sont réservées au serveur et jamais publiées (copie exacte d'Âme liée). Une progression qui change réellement est poussée en direct.

Aucun handler ne modifie un solde SQL ni la RAM : l'argent passe par `TransactionService` (`PASSIVE_REWARD`, métadonnées `passiveId`, `eventId`, `reason`), les tickets par `ShopService.grantTicket` (ticket gratuit d'une roue active du bon ton), les Pokémon par `PokemonService` (confirmation hors combat obligatoire).

### Récompenses

Une récompense est enregistrée une fois par `(événement, passif, destinataire)` :

```text
PENDING (jeu absent, pas de Run, joueur occupé : sans compter de tentative)
  → APPLYING (une seule tentative à la fois) → CONFIRMED | FAILED (5 tentatives refusées) | REVIEW (résultat inconnu)
```

Une `REVIEW` n'est jamais rejouée : l'admin la résout dans Gestion → Opérations à vérifier (`commandResolved`), comme les autres écritures. Une récompense `PENDING` est retentée à chaque observation du jeu et à chaque changement de Run.

## GAME_EVENT et outbox locale

Message séparé de `GAME_STATE`, sans adresse mémoire :

```json
{"type":"GAME_EVENT","protocolVersion":1,"eventVersion":1,"eventId":"uuid","kind":"TRAINER_VICTORY",
 "observedAt":"2026-10-05T10:00:00.000Z","data":{"moneyBefore":12500,"moneyAfter":13700,"baseReward":1200}}
```

| `kind` | Capability exigée | `data` |
|---|---|---|
| `TRAINER_VICTORY` | `events.trainer_victory` | `moneyBefore`, `moneyAfter`, `baseReward` |
| `POKEMON_FAINTED` | `events.pokemon_fainted` | `slot`, `speciesId` |
| `BATTLE_ENDED` | `events.battle_ended` | `outcome` (`WIN`, `LOSS`, `FLEE`, `OTHER`), `conscious` |
| `STEPS_CHANGED` | `steps.read` | `absolute` (compteur du jeu) |

Le serveur répond `GAME_EVENT_ACK {eventId, ok}`. Si l'adaptateur n'annonce pas la capability, la réponse est `ok:false` / `capability_missing` (refus définitif). Sinon l'événement est publié dans le moteur (`game:<eventId>`, dédupliqué) puis acquitté. Pour `STEPS_CHANGED`, le serveur calcule le delta depuis le compteur absolu ; une valeur plus basse (nouvelle Run) est une nouvelle base, jamais un delta négatif, et le total couvre toute la course. Un client ne doit pas envoyer un événement par pas : il envoie un compteur périodique.

Le client C# garde les événements non acquittés dans `<configuration>.game-events.json`, à côté de la configuration (ex. `client.game-events.json`) (écriture atomique, 200 au plus), et renvoie **le même `eventId`** à chaque connexion jusqu'à l'ACK.

**Sources mémoire (Émeraude FR BPEF v0, validées dans BizHawk)** : l'adaptateur Gen III suit chaque combat entre deux observations (drapeau « en combat » de `gMain`, `gBattleTypeFlags`, `gBattleOutcome`, argent, PV de l'équipe suivis par personnalité). Un membre qui tombe à 0 PV pendant le combat → `POKEMON_FAINTED` ; la sortie du combat → `BATTLE_ENDED` ; un combat de dresseur gagné → aussi `TRAINER_VICTORY` avec l'argent avant/après. Les pas viennent de `GAME_STAT_STEPS` (`SaveBlock1+0x159C`, chiffré par la clé de `SaveBlock2`), envoyés tous les 100 pas. Ces capabilities sont annoncées seulement avec la section `events` du profil, même sans écritures.

Les passifs qui modifient un Pokémon (PV, nature, IV, attaque, nouveau Pokémon) passent par la copie exacte de l'équipe (`game.pokemon.replace` / `insert`, hors combat, `expectedRaw`) ; les objets par `game.item.add`. Si la partie est occupée (une récompense en cours…), le soin, l'éclosion ou la résurrection attendent l'observation suivante ; la mise en boîte attend aussi la Résurrection.

## Roues

| Gage | Paramètres | Effet |
|---|---|---|
| `PASSIVE_GRANT_RANDOM` | `rarities` (1 à 4) | Passif actif, compatible, non possédé, parmi ces raretés |
| `PASSIVE_GRANT_RARITY` | `rarity` | Idem pour une seule rareté (ex. « Gagne un passif Légendaire ») |
| `PASSIVE_STEAL` | — | Cible et passif choisis après le tirage ; transfert atomique avec sa progression |

Sans candidat, le gage échoue avec `NO_PASSIVE_AVAILABLE` et reste en attente (pas de faux succès). Le vol refuse un passif déjà possédé par le voleur, un passif à usage unique déjà consommé et le vol de soi-même ; il notifie le voleur et la victime et met à jour les badges en direct.

Tirages à choix (Sixième sens, Maître du chaos) : le serveur tire plusieurs gages différents selon leurs poids, la résolution reste `AWAITING_CHOICE` avec `options` et `chooserId`, et ne peut pas être appliquée avant `POST /wheel-resolutions/:id/choose {gageId}` (le joueur concerné ou un admin).

## Interface

- **Course** : une ligne de badges sous les 6 Pokémon de chaque joueur (`.passive-badge.common|uncommon|rare|legendary`), « +N » au-delà de trois, détail au clic.
- **Tiroir joueur** : rareté, règle, source, progression, état disponible/consommé, actions.
- **Page Passifs** (`#/passifs`, tous) : mes passifs, ceux de chaque joueur, catalogue par rareté avec disponibilité.
- **Gestion → Passifs** (admin) : lancement, état de sélection, nouvelle offre, annulation de choix, démarrage, attribution/retrait, poids, catalogue actif/inactif avec capabilities, récompenses en attente.
- **Actions** (titulaire, ou admin pour lui) : copier (Usurpateur), se lier (Lien du destin), choisir (Couronne), annuler (Paradoxe), lier / réinjecter (Âme liée). Choix du gage dans l'overlay de roue.

## API

| Route | Qui |
|---|---|
| `GET /api/lobbies/:id/passives` | membre (offre privée du lecteur ; récompenses pour les admins) |
| `POST …/passives/choose {passiveId}` | le joueur, pour lui-même |
| `POST …/passives/:passiveId/act {action, …}` | titulaire, ou admin avec `accountId` |
| `POST …/passives/selection/start`, `…/race/start {force}` | admin |
| `POST …/passives/offers/reset {accountId}`, `…/offers/cancel-choice {accountId}` | admin, avant le départ |
| `PATCH …/passives/settings {weights?, disabled?}` | admin |
| `POST …/passives/grant`, `…/passives/revoke {accountId, passiveId}` | admin |

Sujet temps réel `passives` (snapshot filtré par viewer), catégorie d'audit `PASSIVE`, type de ledger `PASSIVE_REWARD`.

## Base de données

Migration 13 : `passive_settings`, `passive_offers` (générations, `OFFERED`/`CHOSEN`/`REJECTED`/`CANCELLED`), `race_passives`, `passive_progress`, `passive_events`, `passive_rewards` ; reconstruction de `audit_logs` et `money_transactions` (aucune table ne les référence) pour élargir leurs listes `CHECK`. Migration 14 : `wheel_resolutions.options_json` et `chooser_account_id`.

## Ajouter un passif

1. Une entrée dans `passiveCatalog` (id, rareté, handler, paramètres, capabilities).
2. Un handler dans `passiveHandlers` (`on`, `others`, `observe`, `act`, `filterHostileGages` ou `wheelChoice`).
3. Ses tests (API, et Web si sa progression s'affiche : `progressLines`).

## Tests

- API : `passives`, `passive-selection`, `passive-engine`, `passive-catalog-effects`, `passive-wheels`, `passive-legendaries`, `game-events`.
- Client C# : `GameEventTests` (outbox persistée, renvoi du même `eventId`, ACK).
- Web : `test/passives.test.ts` ; Playwright `e2e/passives.spec.ts` (sélection et effet en direct, légendaire gagné par roue, vol de passif).
- Test utilisateur réel (6 octobre 2026, BizHawk 2.11.1 Linux, 2 clients, ROM BPEF v0) : sélection, Deuxième souffle payé dans le jeu, Contre-sort sur 8 tirages réels, roues passif aléatoire et vol par l'interface, Cartographe en marchant jusqu'à la Route 101, redémarrages client et serveur sans double récompense.
