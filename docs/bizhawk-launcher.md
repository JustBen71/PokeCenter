# Lanceur Windows et Linux : BizHawk et client

> Mise à jour du 4 octobre 2026 : le client natif prend désormais en charge les achats aux enchères, même seul, et la copie exacte vers la bibliothèque. Les mentions de lecture seule ci-dessous concernent l’ancien périmètre ; réinjection, suppression et gages restent sur l’agent historique. Voir le README principal pour l’état actuel.

## Utilisation

Les lanceurs prêts à l'emploi (Windows et Linux) sont attachés à chaque **release GitHub** (`Pokerace-vX.Y.Z-windows-x64.exe`, `Pokerace-vX.Y.Z-linux-x64`). Une release se publie en poussant un tag `vX.Y.Z` avec ses notes dans `docs/releases/vX.Y.Z.md` (workflow `release.yml`).

1. **Windows** : double-cliquer sur `pokerace.cmd` (ou sur **Pokerace.Client.exe** de l'artefact **pokerace-launcher-win-x64**). **Linux** : lancer `./pokerace.sh` dans un terminal (Mono requis par BizHawk : `sudo apt install mono-complete`, le lanceur indique la commande sinon). macOS n'est pas pris en charge (pas de BizHawk).
2. Un formulaire s'affiche dans la console : **Serveur**, **Port**, **Pseudo**, **Code du salon** et **ROM**. Au premier lancement chaque champ est demandé ; ensuite les valeurs précédentes sont reprises. Flèches pour choisir une ligne, Entrée pour la modifier. Une saisie invalide est redemandée avec son explication : pas besoin de relancer le programme. Formats d'adresse acceptés : `88.184.14.248`, `localhost`, `http://…` ou `https://…` ; un port tapé avec l'adresse (`hôte:3000`) remplit le champ Port.
3. La ROM se choisit dans une fenêtre de sélection (Windows, ou zenity/kdialog sous Linux) ; sinon, taper ou glisser le chemin du fichier. Le formulaire indique si la ROM est reconnue.
4. **Se connecter et lancer le jeu** vérifie d'abord le serveur et le code du salon (10 s maximum). En cas d'échec, un encadré rouge donne la cause (adresse introuvable, connexion refusée, pas de réponse, salon refusé) et le curseur se place sur le champ à corriger.
5. BizHawk s'ouvre avec la ROM ; le bridge et le client démarrent seuls. La console affiche ensuite l'état en direct : serveur, BizHawk et partie lue (dresseur, argent, lieu, équipe). Si BizHawk n'a pas chargé la ROM en 90 s, il est arrêté et le formulaire revient.
6. Sauvegarder normalement dans le jeu, puis fermer BizHawk : le formulaire revient pour relancer ou quitter. Sous Windows, **Q** ou **Échap** demandent aussi la fermeture de BizHawk ; sous Linux, fermer la fenêtre BizHawk (la sauvegarde du jeu est écrite à sa fermeture).

Le téléchargement officiel de BizHawk 2.11.1 est contrôlé par SHA-256. Les deux DLL du bridge sont intégrées dans l'exécutable distribué ; aucune manipulation de `ExternalTools` ni création manuelle d'un token n'est nécessaire. Une nouvelle clé de session et un port local sont choisis à chaque lancement. Aucun serveur local n'est démarré.

Le client autonome ne nécessite pas de SDK, Node, Python ou Docker. Windows x64 avec .NET Framework 4.8, ou Linux x64 avec Mono, est nécessaire à BizHawk. La première préparation depuis les **sources** peut télécharger un SDK .NET portable vérifié dans `.work`, puis compiler ; les lancements suivants utilisent le binaire déjà préparé. Si le code a été mis à jour, reconstruire avec la commande ci-dessous.

Les ROM, BIOS éventuellement requis par un système et sauvegardes ne sont pas fournis. Le lanceur n'explore pas les dossiers personnels et n'envoie pas la ROM au serveur. Les sauvegardes et réglages de BizHawk restent dans sa copie portable et ne sont pas supprimés au lancement suivant. Si aucun périphérique audio n'est disponible, la sortie sans périphérique est utilisée ; le son reste disponible sur un poste équipé.

## Réglages et commandes

Les réglages joueur restent dans `%LOCALAPPDATA%\Pokerace\client.json` (Linux : `~/.config/Pokerace/client.json`). Le runtime BizHawk, ses réglages, son archive vérifiée, le journal de session (`session.log`) et celui du bridge se trouvent dans le dossier `launcher` à côté. Avec `--config`, le dossier du lanceur est créé à côté du fichier de configuration indiqué. Un verrou empêche deux sessions simultanées dans ce même dossier.

```bat
pokerace.cmd 3000
pokerace.cmd --rom "C:\Mes jeux\ma ROM.gba"
./pokerace.sh --port 3000
```

Avec le seul exécutable : `Pokerace.Client play [--rom <fichier>] [--port <port>] [--config <fichier>]` ; sans argument, le même lanceur démarre. La modification des réglages conserve l'identifiant du joueur. Avec une entrée standard redirigée (CI, scripts), pas de formulaire : la configuration existante et `--rom` sont utilisés, une ligne sur l'entrée standard termine la session.

Les écritures mémoire génériques sont désactivées par défaut (allowMemoryWrites). Les achats vérifiés sont autorisés séparément par allowPokemonPurchases, activé par défaut. La copie bibliothèque est disponible ; les gages et autres modifications d’équipe restent sur l’agent historique.

## Construire

```powershell
./native/Pokerace.Client/tools/build-launcher.ps1   # Windows
./native/Pokerace.Client/tools/build-launcher.sh    # Linux (SDK .NET 8)
```

Le résultat unique est `native/Pokerace.Client/artifacts/launcher-win-x64/Pokerace.Client.exe` (Linux : `launcher-linux-x64/Pokerace.Client`). Le build intègre les DLL du bridge compilées contre la version officielle vérifiée. Le workflow BizHawk teste ce binaire en lançant un véritable émulateur et la ROM homebrew, puis un serveur Socket.IO contrôle lecture/écriture/relecture/restauration et arrêt du lanceur.
