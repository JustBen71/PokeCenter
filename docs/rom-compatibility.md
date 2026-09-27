# Compatibilité ROM

Le registre reconnaît désormais l’empreinte exacte de la ROM française BPEF v0 testée. Les autres empreintes restent inconnues, sans accès RAM. Le profil anglais reste candidat.

## Validation du 26 septembre 2026

Le lecteur Lua du projet a été exécuté, sans aucune écriture autorisée, sur la mémoire réelle extraite de l’état mGBA `.ss1` fourni localement. La section PNG `gbAs` décompressée contient l’IWRAM à 0x19000 et l’EWRAM à 0x21000, conformément au format officiel mGBA. Le CRC32 de la ROM correspond à celui de cet état.

Résultat : dresseur et temps de jeu cohérents, Bourg-en-Vol (0:9), un Poussifeu (espèce nationale 255), niveau 5, 20/20 PV ; checksum Pokémon validé par le lecteur. Les adresses du profil français ont ainsi été vérifiées sur une partie réelle. Aucun fichier ROM, sauvegarde ou état mémoire personnel n’est ajouté au dépôt.

Cette validation couvre la lecture de cet état précis ; elle ne constitue pas une validation exhaustive des cartes, combats, transitions ou équipes multiples. Les tests synthétiques couvrent les permutations de blocs et le décodage FR/EN. L’insertion est désormais activée à la demande de l’utilisateur via `allowWrites: true`. Le lecteur et le code d’insertion Lua ont été exécutés sur une copie en mémoire de l’état réel : ajout d’un Pikachu au slot 2, checksum relu, compteur passé à 2, Poussifeu intact et modifications limitées aux 100 octets du slot ajouté et au compteur. Le fichier source est resté inchangé. Les tests synthétiques d’insertion des 386 espèces passent également. Ce contrôle hors émulateur ne valide pas encore le comportement en jeu ni la persistance après sauvegarde/rechargement dans mGBA. La validation anglaise reste à faire, faute de ROM fournie.

Source du format : https://github.com/mgba-emu/mgba/blob/master/include/mgba/internal/gba/serialize.h
