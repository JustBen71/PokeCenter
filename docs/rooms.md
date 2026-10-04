# Salons de course

> Mise à jour du 4 octobre 2026 : le client natif prend désormais en charge les achats aux enchères, même seul, et la copie exacte vers la bibliothèque. Les mentions de lecture seule ci-dessous concernent l’ancien périmètre ; réinjection, suppression et gages restent sur l’agent historique. Voir le README principal pour l’état actuel.

Après sélection du compte, le portail affiche les salons. Un compte administrateur peut en créer un en choisissant son nom. Le serveur génère un code ; le créateur rejoint automatiquement le salon.

Les joueurs choisissent le salon et saisissent le code partagé par l’administrateur. Une fois membres, ils peuvent le rouvrir sans ressaisir le code. Le bandeau du salon indique son nom, son code, l’adresse du serveur et le nom du compte à utiliser dans le client. « Changer de salon » ferme la connexion du tableau de bord courant ; cela ne déplace pas une partie déjà ouverte dans un émulateur.

À chaque lancement interactif, le client demande le code du salon ; Entrée conserve le précédent. Le serveur, le pseudo et l’identifiant du joueur restent enregistrés. Lancer `pokerace.cmd --configure` pour renseigner l’adresse **HTTP ou HTTPS**, le pseudo et le code affiché. Rejoindre d’abord le salon sur le portail. Le client natif et l’agent Python résolvent le code vers la connexion du bon salon. Avec HTTP, les échanges ne sont pas chiffrés ; HTTPS reste disponible.

## Isolation et conservation

Chaque salon possède ses équipes, progressions, enchères, gages, effets, bibliothèque et connexions. Les actions ciblent uniquement les clients de ce salon. Les comptes sont communs au portail, mais seuls les membres accèdent aux données d’un salon. Un administrateur peut rejoindre un salon depuis la liste.

Le registre des salons (désormais des **lobbies**, tables `lobbies`, `lobby_members` et `lobby_settings`) est conservé dans la base principale `DATABASE_PATH`. Il est migré automatiquement depuis l'ancienne table `rooms`, sans changer les identifiants : voir [base de données](architecture/database.md). Une base voisine `DATABASE_PATH.<identifiant-salon>.sqlite` conserve chaque nouvelle course. Sauvegarder toutes ces bases, avec la même précaution SQLite/WAL que pour la base historique ; sous Docker elles restent dans le volume `pokerace_data`.

Si `ROOM_CODE` est défini à la première mise à jour, un **Salon historique** conserve ce code et les données existantes. Les anciens comptes en sont membres. Les nouvelles courses ne dépendent plus de cette variable ; elle est facultative pour une nouvelle installation. Les anciens clients peuvent continuer à utiliser le transport historique. Le modèle de comptes déclaratifs entre amis existant est conservé.

Un administrateur peut créer et annuler les enchères avec les équipes BizHawk connectées. Le niveau du lot prend en compte leurs Pokémon, sans compter deux fois un compte connecté avec les deux clients.

Le client natif mis à jour permet les achats, y compris seul, et les copies bibliothèque. Les autres écritures métier nécessitent encore l’agent historique.

## Appliquer la mise à jour

Reconstruire le portail et l’API, y compris le proxy qui dirige désormais `/rooms/*` vers l’API :

```powershell
cd deploy/server
docker compose up -d --build
```

Reconstruire le client local si nécessaire :

```powershell
./native/Pokerace.Client/tools/build-launcher.ps1
./pokerace.cmd --configure
```

Les tests couvrent la création réservée aux administrateurs, le code d’entrée, le refus d’accès hors salon, la séparation REST/WebSocket, la persistance des membres et des enchères après redémarrage, ainsi que la résolution du salon par le client natif.
