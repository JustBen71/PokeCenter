# Validation du bridge

## Résultat local — 1 octobre 2026

- SDK : .NET 8.0.425 installé dans le dossier de travail ignoré `.work/dotnet`.
- BizHawk ciblé : 2.11.1 Windows x64, archive officielle vérifiée.
- SHA-256 : `dd7cbd5e205b09c5bce6afabc4f8aa525acc0bbeb9753b198a8db3fe6a5e5717`.
- `dotnet restore bridges/bizhawk/Pokerace.BizHawkBridge.sln` : succès.
- `dotnet build bridges/bizhawk/Pokerace.BizHawkBridge.sln --configuration Release --no-restore -p:BizHawkDir=<dossier-de-travail>/.work/bridge/runtime` : succès, **0 avertissement, 0 erreur**, DLL réelle incluse.
- `dotnet test bridges/bizhawk/Pokerace.BizHawkBridge.sln --configuration Release --no-build --logger "trx;LogFileName=bridge-tests.trx" --results-directory bridges/bizhawk/artifacts/tests` : **45 réussis, 0 échoué, 0 ignoré**.
- TCP réel `127.0.0.1` : réussi, avec faux hôte.
- FakeMemoryDomain : écriture, relecture, blocs multiples et restauration réussis ; erreurs silencieuses, partielles et post-écriture détectées.
- Cycle aucun jeu / chargé / fermé / nouveau jeu et nouveaux domaines : réussi.
- CLI doctor : testé sur serveur TCP factice, avec/sans écriture ; restauration confirmée ; écriture défectueuse et restauration impossible signalées ; absence de bridge correctement signalée.
- Statut local : **UNIT_VERIFIED**.

## Validation réelle

- GitHub Actions unit/integration : en attente d'exécution du nouveau workflow.
- GitHub Actions E2E : en attente d'exécution du nouveau workflow.
- ROM : fixture NES original, sources `e2e/test-rom/src/main.asm`, assembleur Python sans dépendance externe, licence MIT.
- Construction du fixture exécutée : 24 592 octets, SHA-256 `9eb9b1df31eb3c3f7d37e83a616eef022743292240051006adff8180274902d7`.
- Lecture/écriture/relecture/restauration dans un vrai BizHawk : pas encore vérifiée.
- Chargement réel : **NOT_YET_VERIFIED** tant qu'un run E2E complet n'a pas réussi.
- Smoke-test humain initial : non effectué ; **MANUAL_VERIFIED non revendiqué**.

Ne pas transformer un workflow ajouté, un build réussi ou une présence de DLL en preuve E2E. Mettre à jour cette section avec l'URL et le commit du run réellement réussi.
