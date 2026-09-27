# Protocole agent ↔ serveur

Version courante : `1`. Transport : Socket.IO sur l’espace `/agent`, WebSocket privilégié. L’authentification est envoyée dans `auth.playerId`, `auth.playerName` et `auth.roomCode`, jamais dans l’URL. Le code de salon n’est jamais inclus dans les états publics. Le serveur fixe le pseudo depuis la connexion authentifiée, indépendamment du nom du dresseur dans le jeu. Le serveur lie le socket à cet identifiant et rejette toute enveloppe portant un autre `playerId`.

Deux enveloppes existent : `state` avec l’état complet validé par `packages/shared`, et `heartbeat` pour prolonger le statut en ligne sans répéter un état inchangé. Taille maximale : 32 Kio. Six Pokémon maximum, emplacements uniques 1–6, espèce 1–386, niveau 1–100, PV cohérents. Le serveur ajoute `receivedAt` et utilise `lastSeenAt` pour le statut en ligne.

Le dashboard public reçoit `/dashboard` et `GET /api/players`. Le SHA-256 complet de la ROM est retiré de cette projection. Les données inconnues sont nulles ou explicitement libellées ; elles ne sont jamais inventées.
