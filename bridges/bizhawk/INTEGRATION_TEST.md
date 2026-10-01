# Smoke-test humain initial

Ce contrôle ponctuel confirme que le montage E2E correspond au comportement attendu. Il ne remplace pas les deux jobs CI. Aucune assistance distante ni donnée privée n'est nécessaire.

1. Compiler en Release et installer les deux DLL selon le README.
2. Générer la ROM originale : `python bridges/bizhawk/e2e/test-rom/build.py bridges/bizhawk/artifacts/pokerace-test.nes`.
3. Définir un token aléatoire avec la commande du README, lancer BizHawk 2.11.1, puis charger ce fichier `.nes` et l'External Tool Pokérace.
4. Vérifier que sa fenêtre indique `127.0.0.1:43821` (ou le port choisi).
5. Exécuter `doctor` avec le même environnement : connexion, handshake, ping, état, système et domaines doivent afficher `[OK]`. La lecture et l'écriture sans plage restent `[SKIP]`.
6. Vérifier `system` : `NES`. Vérifier `domains` : domaine `RAM`, taille et indicateur d'écriture issus du core.
7. Exécuter `doctor --domain RAM --address 0x300 --length 4 --expect 11223344` : la lecture doit afficher `11223344`, l'écriture `[SKIP]`.
8. Sur cette ROM uniquement, exécuter `doctor --write-test --domain RAM --address 0x300 --data deadbeef --expect 11223344` : écriture vérifiée, lecture `deadbeef`, restauration et lecture `11223344`, exit code 0.
9. Fermer le jeu, interroger `status` : `gameLoaded: false`, `systemId: null`. Une lecture doit échouer avec `no_game`. Recharger le fixture et refaire la lecture sans redémarrer le bridge.
10. Fermer l'External Tool puis lancer `doctor` : `[FAIL] Bridge non joignable...`, exit code non nul.

`unauthorized` indique un mauvais token ; `protocol_mismatch` une version incorrecte ; `unknown_domain` un nom de domaine absent du core ; `invalid_range` une adresse/longueur incorrecte ; `verification_failed` une relecture différente ; `write_failed` une écriture/relecture interrompue. Une erreur de restauration doit être conservée comme échec, même si l'écriture précédente avait réussi.

Consigner date, version, core, étapes et résultat dans `VALIDATION.md` pour établir `MANUAL_VERIFIED`. Tant qu'un humain n'a pas réellement effectué ce contrôle, conserver « non effectué ». Après le premier contrôle, les régressions sont couvertes par l'E2E automatique.
