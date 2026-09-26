# Protocole agent ↔ serveur

Version courante : `1`. Transport : Socket.IO sur l’espace `/agent`, WebSocket privilégié. L’authentification est envoyée dans `auth.playerId` et `auth.token`, jamais dans l’URL. Le serveur lie le socket à cet identifiant et rejette toute enveloppe portant un autre `playerId`.

Deux enveloppes existent : `state` avec l’état complet validé par `packages/shared`, et `heartbeat` pour prolonger le statut en ligne sans répéter un état inchangé. Taille maximale : 32 Kio. Six Pokémon maximum, emplacements uniques 1–6, espèce 1–386, niveau 1–100, PV cohérents. Le serveur ajoute `receivedAt` et utilise `lastSeenAt` pour le statut en ligne.

Le dashboard public reçoit `/dashboard` et `GET /api/players`. Le SHA-256 complet de la ROM est retiré de cette projection. Les données inconnues sont nulles ou explicitement libellées ; elles ne sont jamais inventées.
