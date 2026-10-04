# Ledger d'argent

Chaque mouvement d'argent côté serveur correspond à une ligne `money_transactions`. Aucun solde n'est modifié sans ligne de ledger.

## Comptes de valeur

| Côté | Signification | Solde tenu par le serveur |
|---|---|---|
| `GAME` | Pokédollars dans la partie | Non : changé uniquement par une commande de jeu |
| `BANK` | Banque du joueur (lobby + compte, indépendante des Runs) | `bank_accounts` |
| `JACKPOT` | Pot du lobby | `jackpots` |
| `EXTERNAL` | Argent créé ou détruit par les règles (récompense, achat, correction) | Non |

Une ligne va de `source` vers `destination`, avec un montant strictement positif. Une opération composée, comme un dépôt taxé, produit plusieurs lignes dans une même transaction SQLite : par exemple `GAME → BANK 9 000` et `GAME → JACKPOT 1 000`.

## États

```text
PENDING ──► APPLYING ──► CONFIRMED
   │            ├──────► FAILED
   │            └──────► REVIEW ──► CONFIRMED | FAILED   (résolution explicite)
   ├──► CONFIRMED  (mouvement purement serveur)
   ├──► FAILED
   └──► CANCELLED
```

- Les soldes `BANK` et `JACKPOT` ne changent **qu'au passage à `CONFIRMED`**, dans la même transaction que le changement d'état. Confirmer deux fois ne crédite qu'une fois.
- Un débit qui rendrait un solde négatif lève `INSUFFICIENT_FUNDS` et annule toute la transaction SQLite en cours.
- `REVIEW` ne mène qu'à `CONFIRMED` ou `FAILED`, sur décision explicite. Aucun chemin ne revient à `PENDING` ou `APPLYING` : une écriture au résultat incertain n'est jamais rejouée automatiquement.

## Idempotence

`idempotency_key` est unique. Rejouer la même clé avec le même mouvement (lobby, compte, Run, type, montant, source, destination) renvoie la ligne existante. Une clé réutilisée pour un autre mouvement lève `IDEMPOTENCY_CONFLICT`. `command_id` relie les lignes à la commande de jeu (UUID) qui les applique.

## API du service

`apps/api/src/money/ledger-service.ts` :

- `create(input)` : ligne `PENDING`, avec idempotence ;
- `transition(id, status, {commandId, metadata})` : changement d'état, application des soldes à `CONFIRMED` ;
- `record(input)` : mouvement purement serveur, créé et confirmé d'un coup (refusé si `GAME` est impliqué) ;
- `atomic(fn)` : regroupe plusieurs opérations dans une seule transaction SQLite ;
- `bankBalance`, `jackpotBalance`, `list`, `byCommand`.

## Ordre attendu pour une opération qui touche au jeu (Sprints 5+)

```text
CurrentGameService.require(...)  →  verrou joueur  →  ledger.create (PENDING)
→ APPLYING + commande de jeu (commandId)  →  ACK ok : CONFIRMED (soldes appliqués) + audit
                                          →  refus explicite : FAILED + audit
                                          →  timeout / déconnexion : REVIEW + audit
```

Le verrou joueur et `GameCommandService` arrivent avec les premières écritures (Sprints 3 et 5).
