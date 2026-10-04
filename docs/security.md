# Sécurité d’exploitation

Le modèle de comptes est déclaratif et destiné à un groupe de confiance : il ne fournit pas une authentification personnelle forte. Le portail permet de créer un compte et de déclarer son rôle administrateur. Le code d’un salon contrôle son accès, sans prouver l’identité du joueur.

Les salons créés depuis le portail conservent leur code en SQLite. ROOM_CODE concerne le salon historique ; modifier cette variable ne constitue pas une procédure de rotation des codes des nouveaux salons. Les anciens modes ADMIN_TOKEN et PLAYER_TOKENS_FILE restent distincts.

HTTP et HTTPS sont acceptés. HTTP ne chiffre pas les échanges. Le bridge natif écoute sur 127.0.0.1 avec un token de session local ; la ROM et les sauvegardes complètes restent locales. La télémétrie et les copies des structures Pokémon sont envoyées au serveur.

Les écritures génériques natives sont désactivées par défaut. Les achats vérifiés disposent du réglage séparé allowPokemonPurchases. Une confirmation perdue impose de contrôler le jeu avant de résoudre l’achat incertain.

En production, configurer Caddy et CORS_ORIGIN pour l’origine utilisée et sauvegarder toutes les bases des salons avec une procédure compatible SQLite WAL. Voir le [README de reprise](../README.md).
