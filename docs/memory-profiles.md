# Ajouter un profil mémoire

Un profil n’est recevable qu’après ces étapes : identifier la révision par SHA-256 ; documenter les sources de chaque adresse/pointeur ; fournir des captures mémoire minimales et anonymisées ; tester l’alphabet propre à la langue, les cartes, les six slots et les sous-structures Pokémon chiffrées/permutées ; tester les transitions, écrans de chargement et valeurs invalides ; comparer le résultat à plusieurs sauvegardes réelles.

Le profil doit rester en lecture seule. L’extracteur ne doit appeler que les méthodes `read8`, `read16`, `read32` et `readRange` de l’API mGBA. Toute valeur hors plage invalide l’échantillon complet. L’identifiant national reste la clé des sprites et le nom affiché provient de la table localisée du profil.

Le fichier `extractor.lua` est actuellement un garde-fou sans lecture RAM. Il doit être remplacé par un extracteur testé avant de passer une entrée du manifeste à `validated: true`. Cette absence est intentionnelle et empêche une fausse compatibilité.
