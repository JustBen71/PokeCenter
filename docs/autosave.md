# Sauvegardes automatiques du client

Le client effectue une sauvegarde d’état mGBA toutes les 300 secondes réelles, à partir du démarrage de l’agent. Cela fonctionne indépendamment de la connexion au portail. Le Lua doit être connecté et mGBA doit avancer pour traiter la demande ; pendant une pause, une sauvegarde peut être retardée ou échouer, avec un message dans le client. Le mode accéléré ne raccourcit pas l’intervalle.

Les états sont stockés localement dans `.player-runtime/backups/<SHA-256 de la ROM>/`. Chaque ROM possède ses trois sauvegardes automatiques les plus récentes. Le client affiche le chemin et la confirmation après chaque sauvegarde. Il ne modifie ni la ROM, ni les sauvegardes manuelles `.sav`/`.ss1` placées à côté du jeu.

Le Lua utilise [saveStateFile de mGBA](https://mgba.io/docs/scripting.html) avec les options de sauvegarde complètes (31), vers un fichier temporaire propre à la session. Après confirmation, le client vérifie l’intégrité des chunks PNG, la présence de la mémoire GBA et le CRC de la ROM, puis renomme atomiquement le fichier. Il supprime ensuite uniquement les anciens fichiers `autosave-*.ss1` de ce dossier pour conserver les trois plus récents. Une écriture incomplète ou une confirmation manquante ne déclenche aucune rotation.

Au prochain lancement, après le choix de la ROM, le client affiche les sauvegardes automatiques valides avec leurs dates et chemins. Entrée ou `0` démarre normalement ; `1`, `2` ou `3` charge l’état choisi via `--savestate`. Aucun menu ni clic automatique sur l’écran n’est utilisé.

La première sauvegarde arrive après cinq minutes : ce mécanisme n’ajoute pas de sauvegarde à la fermeture. Sauvegarder normalement dans le jeu avant de quitter reste possible.

Validation : tests de minuterie, confirmation Lua, rotation de cinq états vers trois, échecs, CRC incompatible, fichier tronqué et sélection de reprise. Le format a été vérifié sur un état mGBA réel existant. Aucun cycle de cinq minutes n’a été imposé à la partie active pendant le développement.
