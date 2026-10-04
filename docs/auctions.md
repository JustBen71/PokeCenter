# Enchères (Sprint 6)

> Les enchères sont maintenant gérées par le portail : tables `lobby_auctions` et `auction_bids` de la base centrale, paiement par le moteur d'argent. L'ancien système (documents JSON par salon, achat Lua via `/agent`) reste disponible dans l'API sous `/rooms/<id>/api/auctions` pour compatibilité, mais la page Enchères n'utilise plus que le nouveau. Ses lots passés ne sont pas importés.

## Génération (admin)

« Générer un lot » tire une espèce parmi les 386 de génération III. Le niveau est la moyenne arrondie des niveaux des Pokémon des **membres actifs** : client prêt, jeu lu, signe de vie récent. Les IV (0–31), les EV (budget de 0 à 510, au plus 255 par stat) et la nature sont aléatoires. Les statistiques, l'expérience et les attaques viennent du calcul Émeraude existant (PokéAPI). Une seule enchère peut être en cours par lobby, ce que la base garantit par un index unique partiel.

**Information cachée.** Le navigateur reçoit seulement des fourchettes (statistiques, IV, EV), réglées par le pourcentage d'incertitude choisi par l'admin. Le Pokémon exact (`template_json`) reste côté serveur et n'est révélé qu'une fois l'enchère `SOLD` ou `CANCELLED`.

## Mises

- L'enchère démarre réellement à la première mise valide (1 ₽ minimum).
- Chaque compte mise pour lui-même : le miseur est le compte de la session, jamais un champ envoyé par le navigateur.
- Une mise doit dépasser la meilleure offre et rester payable tout de suite : jeu connecté, capabilities `money.write` et `pokemon.insert`, Run en cours, solde en jeu suffisant, emplacement libre.
- La vérification et l'insertion se font dans une seule transaction SQLite, et l'unicité `(enchère, montant)` départage deux mises identiques simultanées.

## Clôture (admin)

```text
OPEN → SETTLING (meilleure offre figée) → commande pokemon.purchase (débit + insertion dans une seule écriture vérifiée)
     → SOLD    : ledger AUCTION_PAYMENT (GAME → EXTERNAL) + JACKPOT_CONTRIBUTION (GAME → JACKPOT, auctionJackpotPercent)
     → OPEN    : refus explicite (solde ou équipe changés…), rien n'a été débité, l'admin peut réessayer ou annuler
     → REVIEW  : confirmation perdue ; aucun nouvel essai, résolution dans Gestion → Opérations à vérifier
```

La résolution d'une enchère en `REVIEW` la passe en `SOLD` (appliquée) ou la rouvre (non appliquée). La clé d'idempotence `auction:<id>` garantit qu'un lot n'est jamais payé deux fois.

Après la fin, un admin peut **copier le lot dans la bibliothèque** (format `gen3-template-v1`) sans le retirer au gagnant.

## Routes

- `GET /api/lobbies/:id/auctions` : les 30 dernières enchères et l'état de génération (sujet temps réel `auctions`)
- `POST /api/lobbies/:id/auctions` (admin) : `{uncertainty}`
- `POST …/:auctionId/bid` : `{amount}`
- `POST …/:auctionId/close`, `…/cancel`, `…/library` (admin)

Statut de vérification : `FAKE_GAME_VERIFIED` (`lobby-auctions.test.ts`). La commande `pokemon.purchase` est testée sur mémoire synthétique côté client. **`NOT_YET_VERIFIED` sur une vraie partie.**

## Sources

- [pokeemerald global.h](https://github.com/pret/pokeemerald/blob/master/include/global.h) : argent à SaveBlock1 + `0x490`, clé à SaveBlock2 + `0xAC`.
- [pokeemerald money.c](https://github.com/pret/pokeemerald/blob/master/src/money.c) : chiffrement XOR du solde, plafond 999999.
- [PokéAPI](https://pokeapi.co/docs/v2) : espèces, statistiques, croissance et attaques.
