# Compatibilité ROM

Le registre reconnaît désormais l’empreinte exacte de la ROM française BPEF v0 testée. Le profil anglais reste candidat.

## ROM randomisées (0.2.1, lecture seule depuis 0.2.7)

`Gen3ProfileRegistry.Resolve` renvoie le profil avec l’un de ces deux modes de reconnaissance (`Gen3MemoryProfile.Match`) :

| Cas | Statut | Capabilities |
|---|---|---|
| SHA-256 exact listé dans `rom-manifest.json` (`validated: true`) | `ready`, `EXACT_HASH` | toutes celles du profil (lecture, argent, équipe, objets, combats commandités, reset…) |
| SHA-256 inconnu, mais en-tête GBA (code + version, ex. `BPEF v0`) d’une révision validée : ROM randomisée | `ready`, `REVISION_FALLBACK` | lecture seule (`trainer/money/party/location/progression.read` et événements de combat) |
| En-tête inconnu ou révision non validée | `unknown_rom` / `profile_not_validated` | aucune |
| ROM chargée dans BizHawk différente de la ROM sélectionnée | `rom_identity_unavailable` | aucune |

Avec `REVISION_FALLBACK`, le profil est rendu avec `AllowWrites = false` : le client n’annonce aucune capability d’écriture. Le client refuse aussi toute écriture avec `rom_not_validated`, même si un serveur l’envoie quand même : argent, `game.pokemon.*`, `pokemon.purchase`, objets, combat commandité, boîte, reset (`reset_unavailable`), `bridge.writeMemory`. Seul `game.party.snapshot` (lecture) reste permis. Une ROM randomisée retrouve les écritures quand son empreinte exacte est validée et ajoutée au manifeste (voir « ROM randomisées validées »). Les adresses viennent de la révision, aucune n’est inventée. Tests : `GameWriteTests.ExactHashKeepsWritesButARevisionFallbackIsReadOnly`, `GameAdapterTests`.

## ROM randomisées validées

| Fichier | SHA-256 | Révision | Validée |
|---|---|---|---|
| `PokeraceEmeraud.gba` | `0a326524d8ac012af5a5978ca1b447453d338452e56b86364093a7466942aca5` | BPEF v0 | 9 octobre 2026 (client 0.2.8) |

`PokeraceEmeraud.gba` diffère de la ROM officielle sur 12 657 octets : tables de données (zones 0x310000, 0x550000, 0xE40000), starters, et quelques petits patches de code en place (0x030B0C, 0x031924, 0x045C70, 0x161869). Aucun code n'est déplacé, donc les adresses RAM du profil `emerald-fr-bpef-v0` restent valables. Cela a été vérifié sur le vrai jeu :

- BizHawk 2.11.1 (mGBA) sous Linux, partie réelle chargée par « Continuer » ;
- client 0.2.7 publié : `REVISION_FALLBACK`, 9 capabilities, lecture correcte (Poussifeu N.5 20/20, Bourg-en-Vol, 3000 ₽) ;
- client avec l’empreinte ajoutée (code de la 0.2.8, numéro de version encore 0.2.7 pendant le test) : `EXACT_HASH`, 19 capabilities, `battle.safe = true` sur la carte ;
- écritures COMPLETED et relues : renommage « Aléatoire », ajout d'un Pikachu N.5, +1234 ₽ (3000 → 4234), retrait du Pikachu ;
- le jeu lui-même affiche l'équipe modifiée (menu POKéMON) ;
- menu Start ouvert : renommage refusé (`SAFE_STATE_REQUIRED`) ;
- sauvegarde en jeu, fermeture de BizHawk, relance et « Continuer » : « Aléatoire », Pikachu et 4234 ₽ relus à l'identique.

Non vérifié sur cette ROM : combat commandité, défaite puis reset, objets, boîte, achat aux enchères. Ces fonctions utilisent les mêmes adresses de profil que la ROM officielle, où elles ont été testées. Aucun fichier ROM n'est ajouté au dépôt.

## Validation du 26 septembre 2026

Le lecteur Lua du projet a été exécuté, sans aucune écriture autorisée, sur la mémoire réelle extraite de l’état mGBA `.ss1` fourni localement. La section PNG `gbAs` décompressée contient l’IWRAM à 0x19000 et l’EWRAM à 0x21000, conformément au format officiel mGBA. Le CRC32 de la ROM correspond à celui de cet état.

Résultat : dresseur et temps de jeu cohérents, Bourg-en-Vol (0:9), un Poussifeu (espèce nationale 255), niveau 5, 20/20 PV ; checksum Pokémon validé par le lecteur. Les adresses du profil français ont ainsi été vérifiées sur une partie réelle. Aucun fichier ROM, sauvegarde ou état mémoire personnel n’est ajouté au dépôt.

Cette validation couvre la lecture de cet état précis ; elle ne constitue pas une validation exhaustive des cartes, combats, transitions ou équipes multiples. Les tests synthétiques couvrent les permutations de blocs et le décodage FR/EN. L’insertion est désormais activée à la demande de l’utilisateur via `allowWrites: true`. Le lecteur et le code d’insertion Lua ont été exécutés sur une copie en mémoire de l’état réel : ajout d’un Pikachu au slot 2, checksum relu, compteur passé à 2, Poussifeu intact et modifications limitées aux 100 octets du slot ajouté et au compteur. Le fichier source est resté inchangé. Les tests synthétiques d’insertion des 386 espèces passent également. Ce contrôle hors émulateur ne valide pas encore le comportement en jeu ni la persistance après sauvegarde/rechargement dans mGBA. La validation anglaise reste à faire, faute de ROM fournie.

Source du format : https://github.com/mgba-emu/mgba/blob/master/include/mgba/internal/gba/serialize.h
