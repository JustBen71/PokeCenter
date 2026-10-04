# Banque et jackpot (Sprints 5 et 9)

Trois valeurs bien distinctes :

| Valeur | Où | Source de vérité |
|---|---|---|
| Argent en jeu | La partie | GameAdapter (lu, modifié par commande vérifiée) |
| Banque | `bank_accounts` (lobby + compte) | Ledger, **indépendante des Runs** |
| Jackpot | `jackpots` (lobby) | Ledger |

## Dépôt et retrait

- **Dépôt de X ₽** : jeu −X → banque +(X − taxe) et jackpot +taxe. La taxe vaut `floor(X × bankDepositTaxPercent / 100)` (10 % par défaut).
- **Retrait de X ₽** : banque −X → jeu +X, sans taxe.

Ordre suivi par le moteur (`TransactionService`) : verrou du joueur → contexte de jeu frais (`money.write`, Run en cours) → contrôle des soldes → lignes de ledger `PENDING → APPLYING` → commande `game.money.add/remove` avec `expectedMoney` → `CONFIRMED` (banque et jackpot bougent dans la même transaction SQLite) / `FAILED` / `REVIEW`.

Un retrait au résultat incertain ne débite pas la banque tant qu'un admin n'a pas confirmé qu'il a été appliqué. Chaque clic du navigateur porte un `requestId` (UUID) : renvoyer la même requête rend le résultat enregistré, sans seconde commande.

Routes :
- `GET /api/lobbies/:id/bank` (le compte courant uniquement) ;
- `POST …/bank/deposit` et `POST …/bank/withdraw` : `{amount, requestId}`.

## Paramètres du lobby

`GET/PATCH /api/lobbies/:id/settings` (modification réservée aux admins) : `bankDepositTaxPercent`, `shopJackpotPercent`, `auctionJackpotPercent`, `wheelJackpotPercent`. Chaque fonctionnalité lit ces valeurs au lieu de pourcentages codés en dur. Interface : **Gestion → Paramètres financiers**.

## Temps réel

Sujets poussés sur `/dashboard` : `bank` (propre à chaque compte), `jackpot` et `settings` (communs au lobby). Ils sont rafraîchis après chaque opération d'argent, récompense d'objectif ou enchère.

Statut : `FAKE_GAME_VERIFIED` (`bank.test.ts`).

## Jackpot complet (Sprint 9)

- **Contributions automatiques**, toutes enregistrées en `JACKPOT_CONTRIBUTION` avec leur origine (`metadata.reason`) : taxe des dépôts (`bank_deposit_tax`), boutique (`shop`, `shopJackpotPercent`), enchères (`auction`, `auctionJackpotPercent`) et part des pertes infligées par les roues (`wheel`, `wheelJackpotPercent`). Les pourcentages viennent tous de `LobbySettings`.
- **`JackpotService`** (`apps/api/src/money/jackpot-service.ts`) : `pay` (montant fixe plafonné au solde), `payPercent`, `payAll`, `share` (parts égales, clé d'idempotence par joueur) et `adjust` (correction admin `ADMIN_ADJUSTMENT`, motif obligatoire). Chaque paiement passe par le moteur d'argent avec le **verrou du jackpot** (`jackpot:<lobby>`) : deux paiements simultanés ne peuvent pas dépenser le même solde, et le second reçoit `PLAYER_BUSY`.
- **Gages compatibles** : `JACKPOT_FIXED`, `JACKPOT_PERCENT`, `JACKPOT_SHARE`, `JACKPOT_EMPTY`.
- **Page Jackpot** (tous les membres) : montant actuel, totaux reçus et redistribués, sources principales (somme des contributions confirmées par origine), 30 derniers mouvements. Les admins y ajustent le pot.

Routes :
- `GET /api/lobbies/:id/jackpot` (sujet `jackpot`) ;
- `POST /api/lobbies/:id/jackpot/adjust` (admin) : `{operation: add|remove, amount, reason}`.

Statut : `FAKE_GAME_VERIFIED` (`jackpot.test.ts`).
