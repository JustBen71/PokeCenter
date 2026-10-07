# Tableau des combats

Page **Tableau des combats** (tous les joueurs). Des équipes de dresseur attendent d'être affrontées :
**premier arrivé, premier servi**.

| Étape | Ce qui se passe |
|---|---|
| Mise au tableau | Un admin crée l'équipe (page du tableau), ou une roue avec le gage « Nouveau combat au tableau ». Le hasard est tiré **à la création** : tout le monde voit exactement l'équipe affrontée. Notification « 🗡 Nouveau combat au tableau ». |
| Affronter | Le premier joueur qui accepte réserve l'équipe (les autres voient « Combat en cours »). Il faut une Run en cours et un jeu connecté capable des combats commandités, sans autre combat en attente. Le combat démarre dès qu'il est libre sur la carte. Tant qu'il n'a pas démarré, il peut **abandonner** : l'équipe revient au tableau. |
| Victoire | L'équipe est « Remportée » par le joueur, la récompense est versée dans son jeu (en attente tant que le jeu n'est pas joignable, jamais deux fois ; confirmation perdue = à vérifier par un admin dans « Opérations à vérifier »). XP et argent du dresseur restent ceux du jeu. |
| Défaite | Défaite normale : Run perdue, Run suivante, jeu redémarré (voir [fin de Run](end-of-run.md)). L'équipe revient au tableau. |

## Équipes

1 à 6 places, chacune :
- **Pokémon choisi** : espèce, niveau, attaques (vide = les 4 dernières apprises à ce niveau dans Émeraude, via PokéAPI ; si PokéAPI ne répond pas : Charge) ;
- **Au hasard** : tranche de niveaux et règle des légendaires (interdit, possible, uniquement). Espèces 1 à 386.

Apparence et nom (7 caractères, « DÉFI » par défaut) du dresseur au choix. L'admin peut, tant que l'équipe est
disponible : la **tirer à nouveau**, changer la **récompense**, la **retirer**.

## Récompense

Calculée : **40 ₽ par niveau**, **+10 % par Pokémon au-delà du premier**, **+2 000 ₽ par légendaire**, arrondie à
100 ₽ (ex. 6 Pokémon niv. 30 dont un légendaire : 12 800 ₽). L'admin peut saisir un autre montant ; une récompense
laissée à la valeur calculée suit un nouveau tirage. Paiement : transaction `BATTLE_REWARD` (historique bancaire).

## Gage de roue « Nouveau combat au tableau » (`BOARD_BATTLE`)

Paramètres : nombre de Pokémon (1–6), écart de niveaux, légendaire. Les niveaux sont tirés autour du **niveau moyen
de l'équipe du bénéficiaire** (± écart). Le gage échoue si son équipe n'est pas lisible (jeu jamais connecté).

## Technique

Une équipe acceptée devient un combat commandité de source `BOARD_TEAM` ([combats commandités](battle-encounters.md)) :
même file d'attente, même état sûr, même jeu. La réservation est atomique (`UPDATE … WHERE status='OPEN'`) ; la fin
du combat (gagné, perdu, annulé, échoué) est remontée au tableau par le moteur. Table `battle_board_teams` (migration 16).
