# Validation de Pokerace.Client

Branche locale : `pokerace-client`, construite sur la branche contenant le bridge. Aucun changement n'a été fusionné dans `master`.

## Résultats réellement obtenus

| Vérification | Résultat |
|---|---|
| Build Release, SDK .NET 8.0.425 | Succès, 0 erreur, 0 avertissement |
| Tests xUnit du client | **29 réussis, 0 échoué, 0 ignoré** |
| Tests API, y compris ancien client et nouveau namespace | **31 réussis, 0 échoué, 0 ignoré** |
| Vérification TypeScript de l'API | Succès après compilation du package partagé |
| Faux bridge : vrai TCP sur `127.0.0.1` | Succès |
| Lecture, écriture, relecture mémoire | Succès sur mémoire factice |
| Écriture désactivée par défaut, y compris sous le routeur | Succès, aucun octet écrit |
| Doublons simultanés, contenu différent sous le même UUID | Succès, aucune double écriture |
| Écriture partielle en erreur puis retransmission | Succès, pas de nouvelle tentative |
| Cache saturé | Refus des nouvelles commandes, identifiants précédents conservés |
| Reconnexion au serveur puis retransmission de commande | Succès, résultat précédent renvoyé |
| Arrêt/redémarrage du bridge sur le même port | Succès, états déconnecté/connecté transmis |
| Fermeture/rechargement du jeu | Succès, nouveau système transmis |
| Doctor avec écritures activées dans la configuration | Succès, **aucune écriture effectuée** |
| Doctor sans bridge | Échec explicite, code de retour 1 |
| Socket.IO 4.8.1 réel + module `/client` de production | Succès, authentification, HELLO et ping/pong Engine.IO |
| Publication autonome `win-x64` | Succès ; binaire `--help` exécuté sous Windows |
| Publication autonome `linux-x64` | Succès, compilation depuis Windows |
| Publication autonome `osx-x64` | Succès, compilation depuis Windows |
| Publication autonome `osx-arm64` | Succès, compilation depuis Windows |

Les tests C# utilisent un faux hôte derrière le **vrai cœur de transport/protocole du bridge**. Le client produit ne référence pas ce cœur : il parle seulement TCP. Le serveur factice WebSocket et le test Node avec Socket.IO réel couvrent les deux côtés du transport.

## Commandes exécutées

Le SDK local a été appelé via `.work/dotnet/dotnet.exe`. Les commandes équivalentes avec un SDK installé sont :

```text
dotnet restore native/Pokerace.Client/Pokerace.Client.sln
dotnet build native/Pokerace.Client/Pokerace.Client.sln --configuration Release --no-restore
dotnet test native/Pokerace.Client/Pokerace.Client.sln --configuration Release --logger "trx;LogFileName=client-tests.trx" --results-directory native/Pokerace.Client/artifacts/tests
npm run build -w @pokerace/shared
npm run typecheck -w @pokerace/api
npm run test -w @pokerace/api
dotnet publish native/Pokerace.Client/src/Pokerace.Client/Pokerace.Client.csproj --configuration Release --runtime <RID> --self-contained true -o native/Pokerace.Client/artifacts/<RID>
```

La dernière commande a été exécutée pour les **quatre** RID : `win-x64`, `linux-x64`, `osx-x64`, `osx-arm64`. Le rapport TRX local se trouve dans `artifacts/tests/client-tests.trx`. Les binaires et rapports sont ignorés par Git.

## Statuts

- **UNIT_VERIFIED** : validé localement sous Windows.
- **INTEGRATION_VERIFIED** : validé sur TCP/WebSocket réels avec mémoire factice et Socket.IO réel ; ce statut ne désigne pas un vrai émulateur.
- **CROSS_PLATFORM_BUILD_VERIFIED** : les quatre publications autonomes ont réussi depuis Windows. L'exécution des tests sur Linux/macOS reste à confirmer par la CI.
- **E2E_BIZHAWK_CLIENT_VERIFIED** : **NOT_YET_VERIFIED**. Aucun vrai processus BizHawk n'a exécuté ce client durant cette validation.
- CI Windows/Linux/macOS : workflow ajouté, **aucun run GitHub Actions de cette branche encore confirmé**. La publication de la branche nécessite l'accord explicite du propriétaire.

## Limites connues

- Le cache d'idempotence vit en mémoire jusqu'à la fin du processus, maximum 4 096 identifiants. Un redémarrage du client supprime ce cache ; le serveur doit réconcilier les écritures incertaines avant retransmission.
- Les tests de transport utilisent WS local avec autorisation explicite dans la configuration du fixture. En production, HTTPS/WSS est obligatoire et la validation des certificats .NET est conservée. Aucun serveur public réel n'a été utilisé pour ces tests.
- La version de BizHawk n'est pas disponible dans le protocole actuel du bridge et n'est donc pas annoncée par le client.
- Le nouveau namespace `/client` doit être présent sur le serveur. Un ancien serveur sans ce namespace est refusé explicitement ; aucun basculement silencieux vers `/agent`.
- Aucune équipe Pokémon, enchère ou roulette n'est implémentée ici. Le dashboard existant n'est pas alimenté en données de jeu par ce client générique.
- La compatibilité de l'émulateur/bridge sur Linux ou macOS est distincte de la portabilité du client.
- Aucune ROM, sauvegarde, donnée mémoire privée ou installation personnelle de BizHawk n'a été utilisée.
