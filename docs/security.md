# Sécurité d’exploitation

Le serveur n’expose que Caddy et SQLite reste dans son volume. Sur le poste Windows, le diagnostic/extracteur écoute uniquement sur `127.0.0.1`. La ROM et la sauvegarde restent sous le contrôle de mGBA local et ne sont jamais envoyées au serveur.

Créer un jeton distinct par joueur avec `node scripts/manage-client.mjs joueur-01`, transmettre ce jeton par un canal privé puis redémarrer l’API. Révoquer un joueur en supprimant son entrée et en redémarrant. Ne jamais copier le token administrateur vers un PC joueur.

En production, utiliser un domaine HTTPS dans Caddy, mettre `CORS_ORIGIN` à cette origine exacte, filtrer 80/443 au pare-feu et sauvegarder régulièrement le volume SQLite. Les logs n’écrivent ni jeton ni SHA complet.
