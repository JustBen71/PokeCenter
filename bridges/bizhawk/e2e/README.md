# E2E réel sur environnement jetable

Le workflow `.github/workflows/bizhawk-bridge.yml` s'exécute automatiquement sur PR modifiant le bridge ou le client, sur `master`/`main`, `pokerace-client`, la branche de développement du bridge et sur les tags `bizhawk-bridge-*`. Son job E2E dépend du succès des tests. Un lancement manuel reste disponible.

`run-e2e.ps1` refuse par défaut de lancer l'émulateur hors d'un runner GitHub-hosted. Pour une VM Windows jetable indépendante du PC du mainteneur, installer .NET SDK 8, PowerShell 7, Python 3.12 et les prérequis Windows officiels de BizHawk, puis exécuter :

```powershell
./bridges/bizhawk/e2e/run-e2e.ps1 -DisposableCi
```

Il télécharge BizHawk **2.11.1** depuis sa [release officielle](https://github.com/TASEmulators/BizHawk/releases/tag/2.11.1), contrôle le SHA-256 épinglé dans `bizhawk-version.json`, compile la solution et installe ses deux DLL dans `ExternalTools`. Les binaires téléchargés ne sont pas committés. Le hash attendu de l'archive Windows est :

```text
dd7cbd5e205b09c5bce6afabc4f8aa525acc0bbeb9753b198a8db3fe6a5e5717
```

La ROM originale MIT `test-rom/src/main.asm` est assemblée par `test-rom/build.py`, sans dépendance Python externe. Elle utilise un mapper NES NROM, écrit `11 22 33 44` dans la RAM `$0300..$0303`, désactive les interruptions et boucle sans modifier la sentinelle. Le fixture ne contient aucune ressource Nintendo ni aucun BIOS. L'image est générée pendant le test et son empreinte est conservée.

Le harness utilise les véritables options `--config` et `--open-ext-tool-dll` de BizHawk 2.11.1. Il crée un fichier de configuration temporaire avec rendu GDI+, son désactivé et sortie audio `Dummy`. Désactiver seulement `SoundEnabled` ne suffit pas : BizHawk initialise quand même le périphérique audio et bloque sur une boîte de dialogue si le runner n'en possède pas. `SkipSuperuserPrivsCheck` et `SkipOutdatedOsCheck` évitent les avertissements interactifs de privilèges et de version Windows sur les runners. Ces réglages concernent uniquement la configuration jetable. `TrustedExtTools` n'autorise que le chemin et le SHA-512 de la DLL qui vient d'être compilée, conformément à `ExternalToolManager` officiel ; aucune confirmation de confiance n'est supprimée sur une installation personnelle.

La séquence vérifie le handshake, ping, état, système `NES`, métadonnées, domaines réels et sentinelle. Le CLI `doctor --write-test` écrit `deadbeef`, relit, compare, restaure `11223344` et vérifie à nouveau. Avec `-ClientE2E` (activé dans GitHub Actions), le serveur de test `native/Pokerace.Client/tools/e2e-server.mjs` (namespace `/client` de production, `POST /api/rooms/resolve`, `/health`, port libre choisi par l'OS puis transmis tel quel au client) commande ensuite le vrai processus client .NET pour une lecture, écriture, relecture et restauration sur le même bridge et la même ROM. Le succès exige aussi la fermeture propre du processus BizHawk. Un timeout/échec produit un exit code non nul, jamais un succès de substitution.

Les artefacts `artifacts/e2e` comprennent le résultat et l'étape en échec, stdout/stderr BizHawk, le journal du bridge, les résultats doctor, les domaines/métadonnées détectés, la version épinglée et l'empreinte ROM. Le token aléatoire est transmis par environnement, masqué dans GitHub Actions et exclu des artefacts. Le dossier runtime complet ne doit pas être publié.

### Correctif « Client readiness timeout » (octobre 2026)

Depuis l'ajout de la découverte de salon, le client envoie `POST /api/rooms/resolve` avant d'ouvrir le WebSocket. L'ancien serveur de test était un `http.createServer()` sans gestionnaire : Socket.IO ne répond qu'à `/socket.io/`, la requête restait donc sans réponse, le client abandonnait au bout de 10 s (`server_timeout`, « Pas de réponse de http://127.0.0.1:<port> ») et le test finissait sur `Client readiness timeout`. Le bridge n'était pas en cause. Le serveur de test répond désormais à toutes les requêtes HTTP. Non-régression, exécutée sur les quatre OS par le workflow client : `ServerAddressTests` (le vrai client rejoint `e2e-server.mjs` sur le port choisi ; un resolve sans réponse est bien diagnostiqué `server_timeout` ; mauvais code → `server_rejected`). Le script `e2e-client.mjs` affiche `E2E_CLIENT_JOINED <url>` puis distingue « aucun client n'a rejoint » de « client rejoint mais bridge/adaptateur pas prêts ».

Si un runner Windows hébergé ne peut pas lancer BizHawk, le job reste rouge. Diagnostiquer ses logs avant de déplacer ce même harness vers une VM CI jetable ; ne pas contourner l'E2E avec un faux adaptateur ou un runner sur le PC personnel.
