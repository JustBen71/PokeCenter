# Créateur de Pokémon

Dans le portail, ouvrir « Créer un Pokémon » puis choisir le mode de création.

- **Manuel** : statistiques, expérience, identifiants d’attaques et PP sont libres.
- **Automatique** : choisir le Pokémon et le niveau. Le portail calcule les statistiques avec les IV, EV et la nature indiqués, remplit les PV et utilise l’expérience minimale du niveau. Il propose les quatre dernières attaques apprises par niveau dans Émeraude, ou moins si le Pokémon n’en connaît pas quatre. Les listes permettent de choisir d’autres attaques apprises avant ce niveau, sans doublons. Un changement de Pokémon, niveau, nature, IV ou EV régénère la proposition, y compris les attaques. Passer en manuel conserve la proposition pour la personnaliser.

Le surnom, le joueur, l’emplacement, le DO, l’objet, le talent et le caractère chromatique restent à régler dans le formulaire. Le mode automatique n’est pas un contrôle complet de légalité : il ne vérifie notamment pas le niveau minimal d’évolution ni le talent choisi. Les CT, tuteurs, attaques héritées d’une pré-évolution et attaques par reproduction ne font pas partie de la proposition automatique.

## Données et calcul

Source : [PokéAPI v2](https://pokeapi.co/docs/v2). Les requêtes publiques partent du navigateur, sans clé ni envoi de sauvegarde ou de jeton administrateur. Les résultats sont mis en cache pendant la session. En cas d’échec, l’insertion automatique est bloquée jusqu’à une nouvelle tentative réussie ; le mode manuel reste utilisable.

Endpoints : `pokemon` (statistiques historiques et attaques du groupe `emerald`), `pokemon-species` et `growth-rate` (expérience), `move` (nom français et PP historiques). Le catalogue français local provient des données déjà présentes dans `emulator/profiles/game-data.json`.

Les statistiques utilisent les arrondis entiers de génération III, les IV, `floor(EV/4)` et les modificateurs de nature. Munja a toujours 1 PV. Les changements de statistiques postérieurs à la génération III sont annulés, y compris les entrées historiques partielles. Les PP sont restaurés à leur valeur Émeraude, sans PP Plus.

Référence des calculs : [pokeemerald, pokemon.c](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c).

## Vérification

`npm test` inclut les tests du calcul, des données historiques, des filtres d’attaques, de l’expérience et du cache. Vérification réseau effectuée avec Poussifeu, Pikachu et Munja niveau 5. Aucune insertion dans une partie réelle n’a été déclenchée pour tester ce formulaire.
