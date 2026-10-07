# Roues et gages (Sprints 7 et 8)

> Ce système remplace la page Roulette de l'ancien agent mGBA. Le moteur historique (`/rooms/<id>/api/roulette`, effets Lua) reste dans l'API pour compatibilité, mais le portail ne l'utilise plus et aucune nouvelle dépendance ne lui est ajoutée.

## Types de roue

Un admin crée, modifie et supprime des roues (tables `wheel_types` et `wheel_gages`). Champs : `name`, `description`, `price`, `icon` (un des dix tickets locaux), `tone` (`GOOD`, `BAD` ou `NEUTRAL`), `enabled` (utilisable), `forSale` (vendue dans la boutique ; une roue hors boutique reste lançable par l'admin, la roue automatique et les passifs) et la liste des gages. Les gages ont le même poids par défaut ; un poids de 1 à 100 permet d'ajuster leurs chances. Chaque lobby reçoit deux roues d'exemple, « Bonne étoile » et « Coup bas ».

La suppression est logique : les tirages passés gardent leur propre copie du gage, si bien que modifier ou supprimer une roue ne change jamais un résultat déjà tiré.

## Gages : données, pas code

Un gage désigne un **handler serveur testé** et lui passe des paramètres validés par un schéma propre à ce handler (`gageParamsSchemas`). Un handler inconnu ou des paramètres invalides sont refusés (`VALIDATION_FAILED`).

| Handler | Paramètres | Effet |
|---|---|---|
| `NOTICE` | — | Gage annoncé à tous, sans effet en jeu |
| `GIVE_MONEY` | `amount` | Le bénéficiaire reçoit le montant (`WHEEL_REWARD`) |
| `TAKE_MONEY` | `amount` | La cible perd le montant ; `wheelJackpotPercent` part au jackpot |
| `STEAL_MONEY` | `amount` | Débit de la cible puis crédit du bénéficiaire ; un crédit en échec passe en `REVIEW` |
| `REMOVE_POKEMON` | `selector`: random / highest / lowest / choice | La cible perd un Pokémon, jamais le dernier |
| `GIVE_LIBRARY_POKEMON` | `artifactId` | Le bénéficiaire reçoit un Pokémon de la bibliothèque |
| `JACKPOT_FIXED` / `JACKPOT_PERCENT` / `JACKPOT_EMPTY` | `amount` / `percent` / — | Paiement depuis le jackpot, sous verrou du jackpot |
| `JACKPOT_SHARE` | — | Jackpot réparti à parts égales entre les joueurs pouvant recevoir de l'argent |
| `PASSIVE_GRANT_RANDOM` / `PASSIVE_GRANT_RARITY` / `PASSIVE_STEAL` | raretés / rareté / — | Passifs ([passives.md](passives.md)) |
| `START_BATTLE` / `BOARD_BATTLE` | voir [combats commandités](battle-encounters.md) et [tableau](battle-board.md) | Vrai combat dans le jeu / équipe mise au tableau |
| `ITEM_GIVE` | `who` OWNER / TARGET, `count` 1–5 | Objets au hasard ajoutés au sac (243 objets : tous sauf objets rares, CS et Baie Énigma) ; empilés ou première place libre de la poche |
| `ITEM_TAKE` | `who` (défaut TARGET), `count` 1–5 | Une pile au hasard perd un exemplaire par objet (jamais objet rare ni CS) ; « aucun objet à perdre » si le sac est vide |
| `POKEMON_TRANSFER` | `direction` GIVE / TAKE, `selector` | GIVE : un Pokémon du bénéficiaire part chez la cible ; TAKE : un Pokémon de la cible arrive chez le bénéficiaire. Copie exacte (le jeu le voit « obtenu dans un échange »), jamais le dernier, jamais vers une équipe pleine, remis en place si l'insertion échoue |
| `POKEMON_LEVEL` | `who`, `delta` −10…+10, `selector` | Même Pokémon (personnalité, attaques, IV/EV, objet) au nouveau niveau : expérience de sa courbe et statistiques recalculées (PokéAPI), PV au prorata, pas d'évolution ni de nouvelle attaque |
| `MAGIKARP_CURSE` | `who` (défaut TARGET), `selector` | Le Pokémon devient définitivement un Magicarpe niveau 1 (Trempette, même dresseur d'origine : il obéit) |

`selector` : random (au hasard), highest / lowest (plus haut / bas niveau), choice (emplacement choisi par l'admin dans la
fenêtre de la roue). Les gages qui modifient une équipe demandent la case « Le joueur n'est pas en combat ».
`who` TARGET rend la cible obligatoire. Le sac est écrit à la mémoire validée sur BPEF v0 (profil, section `bag`).

Toutes les écritures passent par le moteur d'argent ou par `PokemonService`, avec une clé d'idempotence par tirage (`wheel:<résolution>:<étape>`).

## Résolution

```text
spin (admin) : le serveur tire le gage (poids, crypto.randomInt), enregistre wheel_resolutions avec la bande à afficher
 → événement wheel-spin : tous les tableaux de bord affichent l'overlay et font défiler la bande ≈ 3 s jusqu'au gage tiré
 → gage immédiat : appliqué automatiquement par l'admin qui l'a lancé
 → gage à choix (cible manquante, retrait choisi, confirmation « hors combat ») : formulaire, puis « Appliquer »
 → SUCCESS | REVIEW (résultat inconnu) ; refus = le gage reste en attente (nouvelle tentative ou abandon)
 → événement notification : ✔ / ✖ affiché à tout le lobby ; audit WHEEL
```

Le résultat est choisi **avant** l'animation et ne dépend pas du navigateur. Un gage n'est appliqué qu'une seule fois (passage atomique `DRAWN|AWAITING_CHOICE → APPLYING`).

Routes :
- `GET /api/lobbies/:id/wheels` (sujet temps réel `wheels`) ;
- `POST/PUT/DELETE …/wheels[/:wheelId]` (admin) ;
- `POST …/wheels/:wheelId/spin` : `{ownerId, targetId?}` ;
- `POST …/wheel-resolutions/:id/apply` : `{targetId?, slot?, confirmOutOfBattle?}` ;
- `POST …/wheel-resolutions/:id/close` : `{status: SUCCESS|FAILED, note?}`.

Statut : `FAKE_GAME_VERIFIED` (`wheels.test.ts`).

## Lancer à tous et roue automatique

- **Lancer à tous** (`POST /api/lobbies/:id/wheels/:wheelId/spin-all`, admin) : un tirage par joueur ayant une Run en cours (l'admin sans Run n'en reçoit pas). Le joueur est le bénéficiaire ; pour une roue hostile, il en est aussi la cible. Les tirages sont espacés de 7 s pour que chaque animation soit vue ; un gage immédiat est appliqué par le lanceur, un gage à choix attend dans « Derniers tirages ».
- **Roue automatique** (`PUT /api/lobbies/:id/wheels-auto` `{wheelId, everyMinutes}`, admin ; 0 = arrêtée) : toutes les N minutes, la roue choisie est lancée à tous, appliquée au nom du créateur du lobby. Le décompte part de l'enregistrement ; le serveur vérifie toutes les 30 s et note l'heure du dernier lancement (`auto_wheels`), donc un redémarrage ne relance pas deux fois la même période.
- Les attaques entre joueurs (tickets hostiles achetés en boutique) se résolvent toujours dans **Gestion → Roues en attente**, dans l'ordre de réception.

## Boutique, tickets et protections (Sprint 8)

- **Boutique** (joueurs et admins) : les roues actives à leur prix, plus la **protection** (prix réglable dans les paramètres du lobby).
- **Achat d'un ticket** : le ticket est créé en `PENDING_PAYMENT`, puis payé par le moteur d'argent (`SHOP_PURCHASE` vers `EXTERNAL`, plus `shopJackpotPercent` au jackpot). Il passe en `QUEUED` à la confirmation du jeu, `CANCELLED` en cas de refus, `PAYMENT_REVIEW` si la confirmation est perdue (l'admin tranche ensuite dans les opérations à vérifier). Le `requestId` envoyé par le navigateur sert d'identifiant : renvoyer la même requête ne paie pas deux fois.
- **Cible** : obligatoire pour une roue hostile, et différente de l'acheteur. Facultative pour une roue neutre ; une roue bienveillante profite à l'acheteur.
- **File** : chaque joueur a sa file, faite des tickets `QUEUED` dont il est le destinataire (la victime d'une roue hostile, sinon l'acheteur), triés par date de réception. Dans **Gestion → Roues en attente**, l'admin les lance un par un, dans l'ordre.
- **Protection** : achetée et payée en jeu, elle annule la prochaine roue hostile reçue, à une condition : avoir été acquise **avant** la réception de cette attaque (`acquired_at < queued_at`). Une protection achetée après la réception ne bloque pas cette roue, mais bloquera la suivante. Une protection utilisée passe en `USED` et le tirage en `BLOCKED`, sans aucun effet en jeu.

Routes :
- `GET /api/lobbies/:id/shop` (sujet `shop`, propre à chaque compte) ;
- `POST …/shop/tickets` : `{wheelId, targetId?, requestId}` ;
- `POST …/shop/protections` : `{requestId}` ;
- `POST …/shop/tickets/:ticketId/resolve` (admin).

Statut : `FAKE_GAME_VERIFIED` (`shop.test.ts`).
