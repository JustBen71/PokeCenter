# Enchères entre joueurs

Onglet **Enchères** : « Nouveau Pokémon » tire uniformément une des 386 espèces de génération III. Le niveau est la moyenne arithmétique arrondie des niveaux de tous les Pokémon des équipes connectées et reconnues à cet instant (un Pokémon = une voix). Les équipes hors ligne ne participent pas au calcul. Les niveaux et participants restent figés pour ce lot.

Chaque IV est tiré entre 0 et 31. Le budget d’EV est tiré entre 0 et 510 puis réparti aléatoirement sans dépasser 255 par statistique. La nature est aléatoire ; les statistiques, l’expérience et les attaques/PP proviennent du calcul Émeraude existant avec PokéAPI. L’aptitude est la première, aucun objet n’est donné, et la chance de chromatique est 1/8192. Le navigateur reçoit l’espèce, le nom, le niveau, le résumé et les fourchettes choisies par l’administrateur : le modèle d’insertion et les attaques restent privés. Voir [Comptes et incertitude](accounts.md). Le serveur conserve le lot exact en SQLite, sans le régénérer lors d’une mise ou d’un redémarrage.

Les cartes joueurs entourent le lot. Chaque compte connecté saisit sa mise sur sa propre carte. Le serveur refuse une mise au nom d’un autre compte. Toute mise doit dépasser la précédente, rester dans le solde disponible et laisser une place dans l’équipe. Le site se synchronise toutes les deux secondes. Les mises ne débitent pas l’argent et ne le réservent pas dans le jeu.

Après votre accord, un administrateur clique sur « Accepter », qui attribue le lot au meilleur enchérisseur et débite sa mise. Une nouvelle mise arrivée entre l’affichage et l’acceptation annule la tentative d’acceptation : il faut lire le nouveau prix. Le serveur revérifie le gagnant, son solde et son équipe. Le client doit être relancé après mise à jour pour annoncer `auction-purchase-v1`.

Le Lua traite l’achat dans un seul callback : comparaison du solde et du nombre de Pokémon, insertion au premier emplacement libre, débit chiffré, vérification. Une erreur tente de restaurer l’emplacement, le compteur et l’argent d’origine. Les autres commandes visant le gagnant sont verrouillées pendant l’achat. Un achat terminé ne peut pas être réexécuté. Si la confirmation est perdue ou si le serveur redémarre pendant l’achat, l’enchère passe en vérification et aucune répétition automatique n’est envoyée. Vérifier le solde et l’équipe dans mGBA, puis enregistrer le constat dans le portail pour lever le verrou. L’achat est une modification de la partie courante ; sauvegarder dans le jeu ou conserver l’état automatique pour le retrouver après fermeture. Effectuer les attributions hors combat et hors échange link, comme les autres insertions.

## Sources et vérification

- [pokeemerald global.h](https://github.com/pret/pokeemerald/blob/master/include/global.h) : argent à SaveBlock1 + `0x490`, clé à SaveBlock2 + `0xAC`.
- [pokeemerald money.c](https://github.com/pret/pokeemerald/blob/master/src/money.c) : chiffrement XOR du solde, plafond 999999.
- [PokéAPI](https://pokeapi.co/docs/v2) : espèces, statistiques historiques, croissance et attaques par niveau.

La lecture du solde a été contrôlée sur la copie de sauvegarde FR déjà fournie. Paiement, équipe pleine, solde changé, échec du débit et annulation locale sont testés en mémoire Lua simulée FR/EN ; les enchères et confirmations perdues sont testées avec une base SQLite isolée. Aucune enchère n’est appliquée sur une partie réelle par ces tests. L’anglais conserve les limites de validation ROM du projet.
