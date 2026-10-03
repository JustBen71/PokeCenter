# Pokérace Tracker

## Lancer BizHawk et le nouveau client en un clic

Sous Windows, double-cliquer sur **`pokerace.cmd`** à la racine du projet. Au premier lancement, il prépare l'exécutable autonome ; les téléchargements sont vérifiés. Le lanceur demande l'adresse HTTPS du serveur existant, le pseudo du compte et le code du salon, puis ouvre le sélecteur de ROM. Il installe sa propre copie portable de BizHawk et démarre le bridge et le client automatiquement. Il ne démarre pas de serveur local.

La distribution CI **`pokerace-launcher-win-x64`** contient aussi un seul **`Pokerace.Client.exe`** : le double-clic suffit, sans Node, Python, SDK .NET ni Docker. Une connexion Internet est nécessaire au premier lancement pour télécharger BizHawk. La ROM reste à fournir par l'utilisateur.

Fermer BizHawk ou appuyer sur Entrée dans la console arrête la session. `pokerace.cmd --configure` modifie les réglages ; `pokerace.cmd --rom "C:\Jeux\ma ROM.gba"` choisit directement un fichier. Voir [le guide du lanceur](docs/bizhawk-launcher.md). Le site affiche désormais le client natif et son état de jeu : l’adaptateur Émeraude lit les ROM exactement reconnues par le manifeste local. Voir [le fonctionnement et les limites](docs/native-game-state.md). Les actions métier restent sur l’agent historique.

Dashboard temps réel auto-hébergé pour une course Pokémon Émeraude. Un agent individuel reçoit les observations d’un extracteur associé à mGBA, les transmet par WebSocket et le serveur conserve le dernier état dans SQLite. Le dashboard montre les connexions, la version du jeu, le dresseur, la zone et les six Pokémon.

Le cahier des charges source est conservé dans [README_Pokerace.md](README_Pokerace.md). Cette implémentation suit sa règle la plus importante : **aucun hash, profil mémoire ou résultat d’extraction n’est inventé**.

## État réel du projet

Le serveur, le dashboard, les contrats JSON, l'authentification par joueur, la persistance, les diagnostics de ROM, le rendu des sprites hors ligne et le créateur de Pokémon sont implémentés. Le serveur fonctionne sous Docker ; le poste joueur utilise mGBA et l'agent Python directement sous Windows. Le manifeste contient une ROM Émeraude FR BPEF v0 validée en lecture ; le profil anglais reste candidat. Le nouveau client natif porte la lecture en C# et publie un état normalisé. Une ROM inconnue ne déclenche aucune lecture de l’adaptateur.

Le nouveau [client CMD Windows](docs/player-client.md) recherche les ROM dans les dossiers Users, affiche leurs chemins et lance la sélection dans mGBA avec chargement de Lua. Le chargement passe directement par `--script`, sans automatisation des menus. Si mGBA ne propose pas cette option, `scripts/setup-mgba-windows.ps1` installe une copie portable officielle de développement adaptée.

mGBA s'ouvre comme une application Windows normale, ce qui conserve le son, les manettes et la fenêtre native. Le script Lua lit l'état en direct et accepte les commandes d'insertion provenant de l'agent local, uniquement sur `127.0.0.1`.

## Créateur de Pokémon

Le bouton **Créer un Pokémon** du dashboard ouvre le formulaire d'administration. Il permet de choisir le slot de l'équipe, l'espèce, le niveau et l'expérience, les statistiques, les attaques et PP, le talent, la nature, l'objet, l'identité du dresseur, les IV, les EV et le statut chromatique. Le préréglage **Magicarpe super nul** remplit un exemple de niveau 1 avec des IV et EV à zéro.

Copier la valeur `ADMIN_TOKEN` de `deploy/server/.env` dans le champ **Clé administrateur**, choisir un joueur en ligne, puis envoyer. La commande remplace immédiatement le slot choisi dans la mémoire du jeu. Elle ne modifie pas le fichier `.gba` : il faut sauvegarder normalement dans le jeu pour conserver le Pokémon dans le fichier de sauvegarde.

## Démarrage du serveur

Prérequis : Node.js 22 uniquement pour générer les secrets/clients, puis Docker Engine et Docker Compose v2 pour l’exécution.

```bash
node scripts/init-server.mjs
cd deploy/server
docker compose up -d --build
docker compose ps
```

Le code de salon initial est `123`. Partagez-le avec les joueurs : aucun jeton individuel ni inscription côté serveur n'est nécessaire. Pour le changer, modifiez `ROOM_CODE` dans `deploy/server/.env`, puis relancez `docker compose up -d` depuis `deploy/server` pour appliquer la nouvelle configuration.

En local, ouvrir `http://localhost:8080`. Pour Internet, modifier `deploy/server/.env` :

```dotenv
PUBLIC_DOMAIN=race.example.com
CORS_ORIGIN=https://race.example.com
```

Caddy obtient alors automatiquement le certificat si le DNS et les ports 80/443 sont correctement configurés. Ne pas publier le port 3000 de l’API.

## Démarrage d’un joueur sous Windows

Prérequis : mGBA installé sous Windows et Python 3.12 avec le lanceur `py`. Double-cliquer sur `player.cmd` ou ouvrir PowerShell dans le projet :

```powershell
.\player.cmd
```

Au premier lancement, le client demande l’adresse du serveur, ton pseudo et le code du salon. Il enregistre ces informations et gère automatiquement l’identifiant du joueur. `player.cmd --configure` permet de les modifier.

`MGBA_PATH` indique l'exécutable mGBA. La ROM est choisie dans le client, ou passée avec `player.cmd --rom "chemin.gba"`. Lua et l'agent communiquent sur un port dynamique de `127.0.0.1`, avec vérification de l'identifiant de session. La ROM et les sauvegardes restent gérées localement par mGBA sous Windows.

Le manifeste reconnaît la ROM française BPEF v0 testée en lecture sur un état mGBA réel (voir `docs/rom-compatibility.md`). L’insertion est activée pour ce profil ; le test sur copie mémoire et ses limites sont documentés dans `docs/rom-compatibility.md`. Les autres empreintes affichent « ROM non reconnue » et les métadonnées d’en-tête. La ROM et la sauvegarde ne quittent jamais le PC joueur ; seul l’état JSON validé et, pour le diagnostic agent→serveur, l’empreinte sont transmis. Le dashboard public ne reçoit jamais l’empreinte complète.

## Développement

```bash
npm ci
npm run build
npm test
npm run typecheck
```

Pour lancer les services sans Docker :

```bash
npm run dev:api
npm run dev:web
```

L’API demande `ROOM_CODE`, `ADMIN_TOKEN`, `DATABASE_PATH` et `CORS_ORIGIN`. Le frontend Vite proxifie `/api` et Socket.IO vers `localhost:3000` en développement.

Les 386 sprites normaux et chromatiques sont copiés localement avec :

```bash
node scripts/fetch-sprites.mjs
```

Ils proviennent de [PokeAPI Sprites](https://github.com/PokeAPI/sprites). Pokémon et les images associées appartiennent à leurs ayants droit. Le projet est non officiel et ne fournit aucune ROM, BIOS ou sauvegarde.

## Tests et vérifications

- `packages/shared/test` : schéma de télémétrie, valeurs impossibles, retrait du SHA public.
- `apps/api/test` : rejet d’un mauvais jeton, identité liée au socket, persistance SQLite et projection publique.
- `apps/agent/tests` : validation Pydantic de valeurs mémoire impossibles.
- `emulator/profiles/rom-manifest.schema.json` : forme stricte du registre ; `validated` doit être vrai pour toute entrée.

Une fois le serveur lancé, vérifier la santé et la persistance :

```bash
curl http://localhost:8080/api/players
docker compose restart api
curl http://localhost:8080/api/players
```

Le statut devient hors ligne après `OFFLINE_AFTER_MS` mais le dernier état reste affiché avec « Dernière donnée reçue ».

## Sauvegarde SQLite

SQLite utilise le mode WAL. Effectuer la sauvegarde cohérente via l’API SQLite dans le conteneur ou arrêter brièvement l’API avant de copier le volume. Exemple simple avec arrêt :

```bash
cd deploy/server
docker compose stop api
docker compose run --rm --entrypoint sh api -c 'cp /data/pokerace.sqlite /data/pokerace.backup.sqlite'
docker compose start api
```

Copier ensuite le fichier hors du volume avec `docker compose cp`. Pour restaurer, arrêter l’API, conserver une copie de l’état courant, remplacer le fichier, supprimer les éventuels fichiers `-wal`/`-shm` correspondants puis relancer.

## Documentation

- [Protocole temps réel](docs/protocol.md)
- [Compatibilité des ROM](docs/rom-compatibility.md)
- [Validation des profils mémoire](docs/memory-profiles.md)
- [Sécurité d’exploitation](docs/security.md)

## Limites vérifiées

- Aucun profil FR/EN validé : l’extraction du dresseur, des cartes et des Pokémon n’est donc pas annoncée fonctionnelle.
- Le lanceur joueur fourni cible Windows et Python 3.12. Il ne configure pas automatiquement les contrôles, le son ou l’emplacement des sauvegardes de mGBA.
- Le code de salon est commun aux participants ; la clé administrateur reste séparée et ne doit pas être partagée avec les joueurs.
- Le dashboard est public derrière Caddy. Ajouter une authentification au proxy si la course doit rester privée.

### Enchères

La page `/#/encheres` propose un Pokémon aléatoire, calculé à partir des niveaux des équipes connectées, puis permet de miser les Pokédollars du jeu. Le bouton Accepter débite le gagnant et ajoute le lot uniquement si son équipe a une place libre. Relancer les clients après mise à jour. Voir [le fonctionnement et les validations](docs/auctions.md).

### Comptes et avatars

Sélectionner ou créer un compte sur le portail, puis renseigner `ACCOUNT_NAME=Ben` dans le client. La case Administrateur organise la gestion des enchères et des gages. Les enchères affichent des fourchettes réglables pour les IV/EV/statistiques. Voir [comptes, rôles et incertitude](docs/accounts.md).
