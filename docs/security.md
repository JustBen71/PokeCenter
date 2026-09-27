# Sécurité d’exploitation

Le serveur n’expose que Caddy et SQLite reste dans son volume. Sur le poste Windows, le diagnostic/extracteur écoute uniquement sur `127.0.0.1`. La ROM et la sauvegarde restent sous le contrôle de mGBA local et ne sont jamais envoyées au serveur.

Les joueurs rejoignent le serveur avec un pseudo et le code de salon commun défini par `ROOM_CODE`. Le client conserve automatiquement un identifiant local stable. Ce mode convient à un groupe d'amis qui se font confiance ; le code de salon ne fournit pas d'identité personnelle vérifiée. La clé administrateur reste distincte du code de salon. Pour changer le code, modifier `.env` et recréer le service API avec `docker compose up -d`. L'ancien mode par jetons reste disponible pour les installations manuelles qui configurent `PLAYER_TOKENS_FILE`.

En production, utiliser un domaine HTTPS dans Caddy, mettre `CORS_ORIGIN` à cette origine exacte, filtrer 80/443 au pare-feu et sauvegarder régulièrement le volume SQLite. Les logs n’écrivent ni jeton ni SHA complet.
