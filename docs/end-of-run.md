# Fin de Run décidée par le jeu

Règle de la course : **toute défaite en jeu termine la Run**, et **tout Pokémon K.O. est envoyé dans la boîte PC**
(il est considéré comme mort). Le jeu redémarre automatiquement sans sauvegarde ; la partie perdue est archivée
sur l'ordinateur du joueur (les 3 dernières).

## Ce qui se passe

| Moment | Jeu (client) | Portail (serveur) |
|---|---|---|
| Un Pokémon tombe à 0 PV, l'équipe tient encore | — | Dès que le joueur est libre sur la carte, commande `game.party.box_fainted` : le Pokémon passe dans la première place libre du PC. Journal + notification « 🪦 … est tombé ». |
| Défaite (blackout, combat commandité perdu) | `PLAYER_DEFEATED` envoyé une fois (outbox GAME_EVENT) | Run en cours → **Perdue** ; Run suivante **lancée** ; passifs « Run perdue » / « Deuxième souffle » ; notification « 💀 ». |
| ~4 s après | `game.reset` : savestate + copie de la sauvegarde archivés, sauvegarde effacée, cœur redémarré | Journal « 🔄 Jeu redémarré sans sauvegarde (archive …) ». Échec → « ✖ nouvelle partie à lancer à la main ». |

Le **journal de Run** (tiroir du joueur, page Course) liste défaites, Pokémon tombés et redémarrages ; les Runs
restent dans l'historique. Une défaite hors Run en cours est seulement journalisée (audit `run.defeat_ignored`).

## Détection (Émeraude FR BPEF v0, profil `defeat`, validé sur le vrai jeu)

- Tout blackout passe par `CB2_WhiteOut` (combat, poison hors combat, Centre Spatial) : 120 frames, puis l'équipe
  est soignée et téléportée. Le client lit l'état toutes les ~750 ms et le voit plusieurs fois.
- Filet de sécurité : sortie de combat avec `gBattleOutcome = 2` (blackout tombé entre deux lectures) ;
  équipe entière à 0 PV sur la carte (combat commandité perdu : le jeu ne fait pas de blackout, les K.O. restent).
- Un seul `PLAYER_DEFEATED` par défaite ; renvoyé tel quel tant que le serveur n'a pas accusé réception, et le
  serveur ignore un `eventId` déjà traité (une défaite renvoyée ne termine jamais la nouvelle Run).

Limites connues : un client arrêté pendant toute la durée d'un blackout ne le voit pas (l'équipe est déjà soignée) ;
un Pokémon K.O. puis ranimé pendant le même combat n'est pas compté (seul l'état sur la carte compte).

## Boîte PC

Comme un dépôt au PC : les 80 premiers octets du Pokémon (chiffrés, somme de contrôle intacte) sont copiés dans
la première place vide (`hasSpecies = 0`) des 14 boîtes, l'équipe est compactée. Un seul `compareWrite` gardé :
pointeurs de sauvegarde, pointeur `gPokemonStoragePtr` (il bouge à chaque changement de carte), joueur toujours
sur la carte, équipe et nombre de Pokémon observés par le serveur. 4 Pokémon au plus par commande (limite de 12
modifications du pont) ; jamais toute l'équipe (c'est une défaite). Rejouer la commande ne déplace rien deux fois.

## Archives des parties perdues

Commande de pont `resetGame` (voir [le README du pont](../bridges/bizhawk/README.md)) : dossier
`POKERACE_LOST_GAMES_DIR/<horodatage UTC>/` (par défaut `PokeraceLostGames` dans le dossier de BizHawk) avec
`game.State` et `game.SaveRAM` ; seules les 3 plus récentes sont gardées. L'horloge temps réel (16 octets ajoutés
par mGBA) est conservée : l'effacer fait afficher « La pile interne est épuisée ».

Reprendre une partie archivée : BizHawk fermé, copier `game.SaveRAM` sur `GBA/SaveRAM/<nom de la ROM>.SaveRAM`
(écran titre : « Continuer ») ou charger `game.State` (Fichier → Charger l'état). Un admin corrige alors les Runs
depuis le tiroir du joueur.

## Activation

Capacités `events.player_defeated`, `party.box_fainted`, `game.reset` : annoncées seulement avec un profil dont la
section `defeat` est `write-validated`, un pont à jour et les écritures autorisées localement
(`allowPokemonPurchases`). Sans elles, rien n'est automatique (fin de Run manuelle par un admin).
