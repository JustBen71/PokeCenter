# Pokérace Tracker

Dashboard temps réel auto-hébergé pour une course Pokémon Émeraude. Un agent individuel reçoit les observations d’un extracteur associé à mGBA, les transmet par WebSocket et le serveur conserve le dernier état dans SQLite. Le dashboard montre les connexions, la version du jeu, le dresseur, la zone et les six Pokémon.

Le cahier des charges source est conservé dans [README_Pokerace.md](README_Pokerace.md). Cette implémentation suit sa règle la plus importante : **aucun hash, profil mémoire ou résultat d’extraction n’est inventé**.

## État réel du projet

Le serveur, le dashboard, les contrats JSON, l'authentification par joueur, la persistance, les diagnostics de ROM, le rendu des sprites hors ligne et le créateur de Pokémon sont implémentés. Le serveur fonctionne sous Docker ; le poste joueur utilise mGBA et l'agent Python directement sous Windows. La ROM française locale BPEF v0 actuellement configurée dispose d'un extracteur mémoire testé avec l'instance mGBA du joueur.

mGBA s'ouvre comme une application Windows normale, ce qui conserve le son, les manettes et la fenêtre native. Le script Lua lit l'état en direct et accepte les commandes d'insertion provenant de l'agent local, uniquement sur `127.0.0.1`.

## Créateur de Pokémon

Le bouton **Créer un Pokémon** du dashboard ouvre le formulaire d'administration. Il permet de choisir le slot de l'équipe, l'espèce, le niveau et l'expérience, les statistiques, les attaques et PP, le talent, la nature, l'objet, l'identité du dresseur, les IV, les EV et le statut chromatique. Le préréglage **Magicarpe super nul** remplit un exemple de niveau 1 avec des IV et EV à zéro.

Copier la valeur `ADMIN_TOKEN` de `deploy/server/.env` dans le champ **Clé administrateur**, choisir un joueur en ligne, puis envoyer. La commande remplace immédiatement le slot choisi dans la mémoire du jeu. Elle ne modifie pas le fichier `.gba` : il faut sauvegarder normalement dans le jeu pour conserver le Pokémon dans le fichier de sauvegarde.

## Démarrage du serveur

Prérequis : Node.js 22 uniquement pour générer les secrets/clients, puis Docker Engine et Docker Compose v2 pour l’exécution.

```bash
node scripts/init-server.mjs
node scripts/manage-client.mjs joueur-01
cd deploy/server
docker compose up -d --build
docker compose ps
```

Copier le jeton affiché par `manage-client.mjs` dans la configuration du joueur. Après chaque ajout ou révocation, redémarrer l’API :

```bash
docker compose restart api
```

En local, ouvrir `http://localhost:8080`. Pour Internet, modifier `deploy/server/.env` :

```dotenv
PUBLIC_DOMAIN=race.example.com
CORS_ORIGIN=https://race.example.com
```

Caddy obtient alors automatiquement le certificat si le DNS et les ports 80/443 sont correctement configurés. Ne pas publier le port 3000 de l’API.

## Démarrage d’un joueur sous Windows

Prérequis : mGBA installé sous Windows et Python 3.12 avec le lanceur `py`. Créer d’abord le jeton du joueur côté serveur, puis ouvrir PowerShell dans le projet :

```powershell
.\scripts\setup-player-windows.ps1
# renseigner deploy\player\player.env
.\scripts\start-player-windows.ps1
```

`MGBA_PATH` permet au script de lancer mGBA et d’ouvrir automatiquement `ROM_PATH`. Si ce chemin n’est pas renseigné ou invalide, le script laisse mGBA ouvert manuellement. L’agent et le diagnostic communiquent uniquement sur `127.0.0.1:8765`. La ROM et les sauvegardes restent gérées localement par mGBA sous Windows.

Avec le manifeste actuel, le dashboard affiche « ROM non reconnue » et les métadonnées d’en-tête. C’est le comportement attendu jusqu’à validation d’un profil. La ROM et la sauvegarde ne quittent jamais le PC joueur ; seul l’état JSON validé et, pour le diagnostic agent→serveur, l’empreinte sont transmis. Le dashboard public ne reçoit jamais l’empreinte complète.

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

L’API demande `PLAYER_TOKENS_FILE`, `ADMIN_TOKEN`, `DATABASE_PATH` et `CORS_ORIGIN`. Le frontend Vite proxifie `/api` et Socket.IO vers `localhost:3000` en développement.

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
- Le script d’administration modifie un fichier local puis exige un redémarrage API ; aucune interface web d’administration n’expose les secrets.
- Le dashboard est public derrière Caddy. Ajouter une authentification au proxy si la course doit rester privée.
