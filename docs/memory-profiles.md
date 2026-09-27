# Ajouter un profil mémoire

Un profil n’est recevable qu’après ces étapes : identifier la révision par SHA-256 ; documenter les sources de chaque adresse/pointeur ; fournir des captures mémoire minimales et anonymisées ; tester l’alphabet propre à la langue, les cartes, les six slots et les sous-structures Pokémon chiffrées/permutées ; tester les transitions, écrans de chargement et valeurs invalides ; comparer le résultat à plusieurs sauvegardes réelles.

La validation initiale doit rester en lecture seule. Toute valeur hors plage invalide l’échantillon complet. L’identifiant national reste la clé des sprites et le nom affiché provient de la table localisée du profil. Les commandes administrateur d'insertion constituent une fonctionnalité distincte, à vérifier séparément avec sauvegarde/rechargement sur une copie de test.

Le fichier `extractor.lua` exige la configuration générée par le client après identification SHA-256. Une ROM absente du registre validé reçoit uniquement un diagnostic : aucun appel de lecture ou d'écriture RAM n'est effectué. Les profils JSON FR/EN sont candidats ; les tests simulés dans `tests/test_player.py` ne suffisent pas à les promouvoir. Consigner des comparaisons sur de vraies sauvegardes avant d'inscrire `validated: true` dans le registre. Voir [le client et les limites actuelles](player-client.md).
