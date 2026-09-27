# Comptes entre amis

Le portail demande de sélectionner un compte et de cliquer sur **Connexion**, ou d’en créer un avec un nom, un sprite et la case **Administrateur**. Cliquer sur son nom dans l’en-tête permet de modifier le profil. Déconnexion permet de changer de joueur. Le compte actif est propre à l’onglet ; le dernier choix est mémorisé, mais un rechargement présente à nouveau l’écran de connexion.

Ce sont des identités déclaratives, sans mot de passe ni secret : chacun peut sélectionner un compte ou cocher administrateur dans son propre profil. La séparation des rôles organise les actions entre amis, elle n’authentifie pas une personne. Les noms sont uniques en ignorant la casse, les espaces extérieurs et les accents.

## Client mGBA

Créer le compte sur le portail puis renseigner `deploy/player/player.env` :

```dotenv
ACCOUNT_NAME=Ben
```

Le code du salon et l’adresse du serveur continuent à identifier votre serveur. `PLAYER_ID` reste un identifiant d’installation technique ; il ne faut pas le modifier pour changer de compte. Le serveur rattache la télémétrie au compte via `ACCOUNT_NAME`. `PLAYER_NAME` reste un alias de compatibilité, mais `ACCOUNT_NAME` est prioritaire. Un compte inconnu est refusé avec un message explicite. Un seul client de jeu peut être connecté par compte. Après changement du nom d’un compte, mettre également à jour le nom dans le client.

Les anciennes équipes gardent leurs identifiants : une migration crée leurs profils sans effacer les états, bibliothèques ou historiques. Le sélecteur propose les dresseurs et les 386 Pokémon des trois premières générations, avec recherche par nom français ou numéro. Les sprites choisis apparaissent sur la carte, dans les équipes et autour des enchères. Les profils créés sans client de jeu sont disponibles à la connexion ; leur équipe apparaît lorsque leur client transmet son premier état.

## Actions

- Tous les comptes consultent équipes, progression, bibliothèque, roue et enchères.
- Un joueur mise uniquement pour son compte et tourne la roulette pour lui-même. Il peut gérer sa propre équipe et utiliser la bibliothèque partagée.
- Un administrateur crée/clôture les enchères, règle leur incertitude et crée/modifie/active/supprime les gages. Il peut désigner le joueur qui tourne et intervenir sur les équipes.
- Les règles sont vérifiées par l’API, pas seulement par les boutons. Les comptes et rôles sont stockés en SQLite. L’API web utilise l’identifiant public `x-account-id` ; ce n’est pas un jeton secret.

## Fourchettes des enchères

Avant « Nouveau Pokémon », régler l’incertitude entre 0 et 100 % (25 % par défaut). À 0 %, IV, EV et statistiques sont affichés exactement. Sinon chaque borne est tirée indépendamment autour de la vraie valeur, dans une marge maximale de `ceil(valeur × pourcentage / 100)`, avec un minimum d’un point. Les bornes respectent les limites du jeu (IV 0–31, EV 0–255, statistiques 1–999). La vraie valeur reste dans l’intervalle mais n’est pas systématiquement son milieu. L’arrondi peut donc dépasser le pourcentage théorique d’une fraction de point pour les petites valeurs.

Les fourchettes sont stockées avec le lot ; tous les joueurs voient les mêmes, même après rechargement ou redémarrage. Modifier le curseur concerne le prochain lot. Les attaques et la nature restent cachées. « Attaque » représente la statistique, pas les dégâts d’un coup, qui dépendent de l’adversaire et du combat. Les anciens lots sans fourchettes restent masqués jusqu’au prochain tirage.

Les sprites sont issus des [graphismes de dresseurs de pokeemerald](https://github.com/pret/pokeemerald/tree/master/graphics/trainers/front_pics), rendus en SVG pixel par pixel avec fond transparent. Les graphismes Pokémon appartiennent à leurs ayants droit.
