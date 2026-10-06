# Lanceur Windows : BizHawk et client

> Mise à jour du 4 octobre 2026 : le client natif prend désormais en charge les achats aux enchères, même seul, et la copie exacte vers la bibliothèque. Les mentions de lecture seule ci-dessous concernent l’ancien périmètre ; réinjection, suppression et gages restent sur l’agent historique. Voir le README principal pour l’état actuel.

## Utilisation

1. Depuis le projet, double-cliquer sur `pokerace.cmd`. Sinon, récupérer l'artefact **pokerace-launcher-win-x64** du workflow **BizHawk bridge**, extraire le ZIP et double-cliquer sur **Pokerace.Client.exe**.
2. Au premier lancement, renseigner l'adresse **HTTP ou HTTPS** du serveur existant, le pseudo du compte créé sur son portail et le code de son salon. Le serveur doit prendre en charge le namespace `/client`. Formats acceptés : `88.184.14.248`, `88.184.14.248:8080`, `localhost:3000`, `http://…` ou `https://…` (sans chemin ni paramètres). L'adresse est normalisée une seule fois en `schéma://hôte[:port]`, puis le port est demandé à chaque lancement (Entrée conserve celui affiché, `--port` le fixe). En cas d'échec, le lanceur affiche la cause en français : adresse introuvable, connexion refusée, pas de réponse (timeout), salon refusé ou configuration invalide.
3. Choisir sa ROM dans la fenêtre de sélection. Annuler cette fenêtre ne lance aucune session.
4. BizHawk s'ouvre avec la ROM, le bridge et le client démarrent automatiquement. Les connexions au serveur sont affichées dans la console.
5. Sauvegarder normalement dans le jeu. Fermer BizHawk ou appuyer sur **Entrée** dans la console pour arrêter la session. Si BizHawk attend une confirmation de sauvegarde, le lanceur ne force pas sa fermeture.

Le téléchargement officiel de BizHawk 2.11.1 est contrôlé par SHA-256. Les deux DLL du bridge sont intégrées dans l'exécutable distribué ; aucune manipulation de `ExternalTools` ni création manuelle d'un token n'est nécessaire. Une nouvelle clé de session et un port local sont choisis à chaque lancement. Aucun serveur local n'est démarré.

Le client autonome ne nécessite pas de SDK, Node, Python ou Docker. Windows x64 avec .NET Framework 4.8 est nécessaire à BizHawk. La première préparation depuis les **sources** peut télécharger un SDK .NET portable vérifié dans `.work`, puis compiler ; les lancements suivants utilisent le binaire déjà préparé. Si le code a été mis à jour, reconstruire avec la commande ci-dessous.

Les ROM, BIOS éventuellement requis par un système et sauvegardes ne sont pas fournis. Le lanceur n'explore pas les dossiers personnels et n'envoie pas la ROM au serveur. Les sauvegardes et réglages de BizHawk restent dans sa copie portable et ne sont pas supprimés au lancement suivant. Si aucun périphérique audio n'est disponible, la sortie sans périphérique est utilisée ; le son reste disponible sur un poste équipé.

## Réglages et commandes

Les réglages joueur restent dans `%LOCALAPPDATA%\Pokerace\client.json`. Le runtime BizHawk, ses réglages, son archive vérifiée et le journal du bridge se trouvent dans `%LOCALAPPDATA%\Pokerace\launcher`. Avec `--config`, le dossier du lanceur est créé à côté du fichier de configuration indiqué. Un verrou empêche deux sessions simultanées dans ce même dossier.

```bat
pokerace.cmd --configure
pokerace.cmd --rom "C:\Mes jeux\ma ROM.gba"
```

Avec le seul exécutable, utiliser `Pokerace.Client.exe play --configure` ou `Pokerace.Client.exe play --rom "C:\Mes jeux\ma ROM.gba"`. Sans argument, Windows démarre le même lanceur. La modification des réglages conserve l'identifiant du joueur.

Les écritures mémoire génériques sont désactivées par défaut (allowMemoryWrites). Les achats vérifiés sont autorisés séparément par allowPokemonPurchases, activé par défaut. La copie bibliothèque est disponible ; les gages et autres modifications d’équipe restent sur l’agent historique.

## Construire

```powershell
./native/Pokerace.Client/tools/build-launcher.ps1
```

Le résultat unique est `native/Pokerace.Client/artifacts/launcher-win-x64/Pokerace.Client.exe`. Le build intègre les DLL du bridge compilées contre la version officielle vérifiée. Le workflow BizHawk teste ce binaire en lançant un véritable émulateur et la ROM homebrew, puis un serveur Socket.IO contrôle lecture/écriture/relecture/restauration et arrêt du lanceur.
