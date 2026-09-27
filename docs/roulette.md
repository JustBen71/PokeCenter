# Roulette, catalogue et effets différés

Le joueur sélectionné dans « Qui tourne la roue ? » est toujours A. Le tirage est manuel, pondéré et enregistré côté serveur. Les admins ajoutent des gages depuis le catalogue, les retirent de la roue sans les supprimer, modifient les poids et créent des variantes avec des blocs. Les catégories sont libres et recherchables. Un poids 2 donne deux fois les chances d’un poids 1 ; les pourcentages par catégorie du fichier sont des suggestions, pas des quotas appliqués automatiquement.

Le fichier racine `gages_roulette_pokerace.txt` est importé une seule fois (20 entrées désactivées initialement). Les modifications et suppressions persistent. Les règles originales figurent dans les cartes. Les gages incomplets ne peuvent pas être activés. L’import initial ne remplace pas les anciens gages personnels.

## Blocs disponibles

- Joueur précis, au hasard, classé premier/dernier/avant-dernier, ou choisi après le tirage.
- Pokémon vivant précis, au hasard, le plus haut/bas niveau, choisi par A, par B ou par vote des autres. La résurrection sélectionne les K.O.
- Échange exact, copie, vol avec remplacement aléatoire, vol à pile ou face.
- Don, vol ou redistribution d’un pourcentage des vrais Pokédollars.
- Ajout d’une espèce précise, choisie par le joueur, aléatoire ou légendaire ; niveau fixe ou moyenne de son équipe. IV, EV et nature générés ; attaques normales adaptées à Émeraude, ou attaques aléatoires pour le mode Temu.
- Deux enveloppes ; trois propositions d’espèces par votes puis tirage au hasard.
- Cartes de relance et de résurrection ; garde d’un Pokémon ; contrat d’héritage ; série de 2 à 5 tirages.

Les votes sont persistés. Tous les votants désignés répondent une fois ; une égalité se tranche au hasard. Un choix devenu incompatible avec la partie fait échouer le gage. Après les choix, le résultat est appliqué automatiquement si cette option était cochée au tirage ; sinon son propriétaire clique sur Appliquer. Les sous-tirages d’une série s’appliquent automatiquement après les choix.

## État du catalogue fourni

Les numéros **1, 2, 3, 5, 8, 9, 10, 11, 12, 14, 15, 16, 17 et 18** ont leurs effets implémentés. Les numéros **4, 6, 7, 13, 19 et 20** sont conservés mais désactivés en attendant le choix et l’implémentation du stockage en box. Le bloc de résurrection actuel fonctionne sur les Pokémon K.O. de l’équipe ; il ne lit pas les morts des boîtes PC.

Les effets monétaires et Pokémon sont écrits dans le jeu après vérification de la cible. Les obligations de conduite sont suivies, pas toutes forcées par le moteur du jeu :

- Magicarpe est ajouté en tête et le prochain départ de combat de dresseur est détecté. Un départ incorrect est signalé.
- La garde jusqu’au badge bloque les suppressions/remplacements depuis le portail. Un déplacement depuis mGBA est signalé, sans créer de copie pour le compenser.
- Le pacte compte les deux prochaines routes distinctes atteintes après l’activation ; la restriction finit en quittant la deuxième. Les captures sont comptées et signalées ; les Poké Balls ne sont pas désactivées.
- Le surnom Discord et l’interdiction générale des soins pendant les combats restent des règles entre amis. Aucune commande Discord n’est envoyée.

La carte de relance peut cibler un autre joueur ; son prochain tirage rejette le premier résultat et conserve le second. Elle expire au prochain badge de son détenteur. La résurrection conservée n’expire pas. L’héritage réagit à un K.O. observé d’un Pokémon précédemment vivant, ou au prochain badge, puis utilise le même exécuteur transactionnel que les autres gages. Les événements survenus pendant une déconnexion complète ne peuvent pas tous être reconstitués.

Une série de tirages exclut les autres séries pour rester finie. Chaque résultat garde ses propres choix et effets ; le suivant attend la fin du précédent et un état de jeu actualisé. Une confirmation incertaine bloque la suite.

## Client et vérifications

Relancer `player.cmd` pour charger `game-bundle-v1` et les compteurs d’événements. Les transactions équipe/argent comparent les octets et le solde attendus, puis appliquent la modification dans un même callback Lua. Une erreur locale restaure la mémoire sauvegardée. Entre deux clients, les écritures confirmées sont compensées si possible ; une confirmation perdue exige une vérification, sans nouvel essai automatique. Les copies avant modification sont dans la bibliothèque.

Cartes, obligations, tirages et votes sont stockés en SQLite. Un redémarrage interrompt les préparations et place les écritures incertaines en vérification. Les cartes et séries ne sont pas recréées à chaque connexion.

Les compteurs lus sont ceux du [SaveBlock1](https://github.com/pret/pokeemerald/blob/master/include/global.h), avec les [indices officiels du désassemblage](https://github.com/pret/pokeemerald/blob/master/include/constants/game_stat.h) et le [déchiffrement du jeu](https://github.com/pret/pokeemerald/blob/master/src/overworld.c). Le compteur de dresseurs est incrémenté au [départ du combat](https://github.com/pret/pokeemerald/blob/master/src/battle_setup.c). Lecture contrôlée sur la copie de sauvegarde FR disponible ; changements de compteurs et écritures vérifiés sur mémoire simulée.

`roulette-engine.ts` centralise schémas, champs et planification des blocs. `roulette-choices.ts` résout les interactions, `roulette-effects.ts` suit les obligations et `roulette-routes.ts` gère l’exécution durable. Ajouter un nouveau domaine mémoire demande un nouvel adaptateur ; les admins composent les blocs existants sans écrire de code.

## Indisponibilité temporaire

Le bloc « Pokémon · indisponibilité temporaire » place un Pokémon vivant de A en réserve sur le portail pendant 1 à 1440 minutes (10 par défaut). Le bouton « Indisponibilité de 10 min » prépare un gage modifiable. La sélection peut être aléatoire, par niveau, emplacement, choix ou vote. Il faut garder au moins un Pokémon vivant dans l’équipe.

Le délai commence à la confirmation du retrait et suit l’horloge réelle, même déconnecté ou serveur arrêté. Les 100 octets du Pokémon sont conservés dans la base : aucun soin ni recalcul de statistiques au retour. Un compte à rebours figure dans les effets. Le retour automatique attend une connexion, une télémétrie récente et une place libre ; il ne remplace jamais un équipier. Une confirmation perdue bloque la restitution pour vérification, sans nouvel essai automatique. Les copies de bibliothèque ne peuvent pas réintroduire ce Pokémon via le portail pendant sa suspension. Cette réserve ne modifie pas les boîtes PC natives.
