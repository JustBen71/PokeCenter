# Progressions et classement

L’onglet **Progressions** affiche la carte originale du PokéNav de Hoenn, le classement et les étapes accomplies par le joueur sélectionné. Il faut relancer le client après la mise à jour du Lua pour recevoir les nouveaux événements. Une progression absente est affichée comme indisponible, sans rang ; elle n’est jamais assimilée à zéro objectif.

## Sources

- [Soluce Émeraude de Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_Emerald) : parcours principal, rival, interventions des Teams et Ligue.
- [Poképédia : Pokémon Version Émeraude](https://www.pokepedia.fr/Pok%C3%A9mon_Version_%C3%89meraude) : particularités de cette version, notamment les détours possibles avant le deuxième badge.
- [pokeemerald](https://github.com/pret/pokeemerald) : `include/global.h` (flags à SaveBlock1 + 0x1270), `include/constants/flags.h`, `include/constants/opponents.h`, `src/data/region_map/region_map_sections.json`, `region_map_layout.h` et `data/maps/map_groups.json`.

La géographie des villes et routes provient de la grille du jeu. Le fond SVG assemble les pixels des tuiles originales de `graphics/pokenav/region_map/map.png` selon `map.bin`, provenant de [pokeemerald](https://github.com/pret/pokeemerald/tree/master/graphics/pokenav/region_map). `scripts/render-hoenn.py` le régénère avec Pillow. Les éléments graphiques Pokémon appartiennent à leurs ayants droit. Le zoom et les noms de villes sont facultatifs. Les positions sont des centres de zones ; elles ne représentent pas les coordonnées exactes du personnage dans une route ou un bâtiment. Les intérieurs sont regroupés par ville/lieu lorsque leur correspondance est connue (424 identifiants de carte). Une zone inconnue n’obtient pas de position inventée. Plusieurs joueurs dans une zone ont des marqueurs décalés.

## Objectifs

31 étapes principales sont suivies jusqu’au Panthéon : premier Pokémon, combats clés du rival et de Timmy, Teams Aqua/Magma, événements du scénario, huit badges, quatre membres du Conseil 4 et victoire finale. Ce n’est pas une liste exhaustive des dresseurs croisés ni un suivi de l’après-Ligue. Les identifiants des combats variantes du rival sont regroupés ; une seule victoire applicable suffit. Cascade reçue confirme l’étape de fin de crise : capturer Rayquaza n’est pas un objectif obligatoire.

Le Lua lit les bits de drapeaux de la partie courante sans écrire. Les objectifs peuvent reculer après chargement d’un ancien état. Les drapeaux du Conseil 4 concernent la tentative courante ; le Panthéon confirme les quatre victoires une fois le jeu terminé. Aucune étape n’est validée par la seule présence d’un joueur dans une ville.

## Règle de classement

Comparaison dans l’ordre : Panthéon atteint, nombre de membres du Conseil 4 vaincus, nombre de badges, puis nombre d’étapes de scénario. Une égalité sur ces critères produit un ex æquo. La position et le niveau des Pokémon ne départagent jamais les joueurs. Ce classement de progression ne prétend pas mesurer le temps restant ni désigner le plus rapide à finir. Les dernières données des joueurs hors ligne restent visibles et sont signalées.

## Maintenance et vérification

`scripts/generate-progression.py` génère `emulator/profiles/progression.json` et `packages/shared/src/progression-data.ts`. Il utilise les sources téléchargées dans `.work/progression`, ou les récupère depuis pokeemerald si elles manquent. Vérifier les changements des sources avant de régénérer pour une autre révision.

Tests : lecture des bits, variantes du rival, validation de Ligue, classement, égalités, reprise d’un ancien état, intérieurs et zones inconnues. Vérification visuelle avec des joueurs fictifs dans un navigateur invisible, sans modifier le serveur réel. La lecture a été contrôlée sur l’état réel français fourni (premier Pokémon reçu, zéro badge). Les étapes tardives sont vérifiées par les sources et les tests synthétiques ; aucune partie avancée réelle n’a été fournie pour les contrôler en jeu.
