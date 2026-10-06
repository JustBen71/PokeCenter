# Nettoyage du 4 octobre 2026

589 fichiers temporaires supprimés, représentant 342 716 869 octets (environ 343 Mo). Six dossiers de caches ont été retirés.

Éléments supprimés : captures de vérification, scripts ponctuels et sorties de diagnostic dans `.work`, archive du SDK déjà extrait, cache npm de travail, environnement de test UI et caches Python. Les chemins ont été vérifiés avant suppression pour rester dans le projet.

Éléments conservés : sources, tests, ressources du site, anciens cahiers des charges `README_*` (retirés depuis, lors du sprint de conformité du 6 octobre 2026), agent historique encore nécessaire aux fonctions non portées, SDK installé, dépendances, runtime BizHawk et client compilé. Les ROM, sauvegardes, bases SQLite, configurations et données locales ont été préservées. Les données de référence utilisées par les générateurs restent disponibles.

La présence d’un fichier ancien ou ignoré par Git ne suffit pas à le rendre inutile. `.dockerignore` exclut désormais les caches, runtimes locaux et sorties natives du contexte de construction Docker.

Le [README principal](../README.md) décrit l’architecture actuelle et les limites connues. Les anciens cahiers des charges restent des références historiques, pas une preuve de fonctionnalités terminées.
