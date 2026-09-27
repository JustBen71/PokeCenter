# Bibliothèque Pokémon

Ouvrir **Bibliothèque Pokémon** sur le portail. Le portail est partagé entre amis : aucune clé administrateur n’est demandée pour consulter, enregistrer, supprimer ou réinjecter des Pokémon. Toute personne ayant accès au site peut utiliser ces fonctions.

Les enregistrements sont présentés en cartes, cinq par ligne sur grand écran, puis trois, deux ou une sur les écrans plus étroits. Chaque carte affiche le sprite, le niveau, les statistiques principales et les attaques avec leurs PP. Cliquer sur une carte ouvre ses détails et les actions de réinjection. Le sélecteur du créateur permet de rechercher un Pokémon par nom français ou numéro, sans distinction d’accents ou de casse ; les flèches et Entrée permettent de choisir au clavier.

Sur une équipe, **Enregistrer** ouvre la fenêtre avec une copie figée des dernières données reçues. L’heure de ces données et le joueur source sont affichés : une équipe hors ligne fournit sa dernière observation, pas une lecture en direct. Donner un nom à l’entrée puis enregistrer. Une ancienne version du client sans copie complète demande un redémarrage et ne permet pas un enregistrement partiel.

La fenêtre permet de consulter les statistiques, les attaques et PP restants, les IV/EV, la nature, le talent, l’objet et le DO. Les noms d’attaques sont chargés depuis PokéAPI ; en cas d’indisponibilité, leurs identifiants restent consultables. Les valeurs sauvegardées ne sont jamais recalculées à partir de cette API.

Sélectionner une entrée, un joueur connecté et un emplacement, puis réinjecter. Un emplacement occupé est remplacé ; pour ajouter un Pokémon, choisir le premier emplacement vide. La réussite n’est affichée qu’après confirmation du lecteur Lua. Sauvegarder ensuite dans le jeu pour rendre le changement durable.

Le créateur manuel/automatique se trouve dans cette même fenêtre et enregistre des **modèles** réutilisables. Le préréglage Magicarpe a été supprimé. Les modèles construisent un nouveau Pokémon ; les **copies exactes** restituent celui enregistré.

## Conservation exacte

Le Lua transmet les 100 octets de la structure Pokémon d’équipe de génération III, encodés en hexadécimal. Cela conserve le PID, le DO, les noms et leur langue, la permutation et le chiffrement, les statistiques, IV/EV, attaques et PP/PP Plus, objet, expérience, bonheur, origine, rubans et statut. Les PV/PP restent ceux de la capture, même s’ils ne sont pas pleins. Aucune ROM ni sauvegarde complète n’est envoyée.

Les entrées sont persistées dans `pokemon_library` dans la base SQLite du serveur. Le serveur vérifie le format, le checksum et les bornes principales. Le Lua revérifie la copie et la disponibilité de l’équipe avant l’écriture, relit les 100 octets après l’écriture et rétablit l’ancien emplacement en cas d’échec détecté. Les profils non reconnus ou interdits en écriture restent bloqués. Seules les parties Émeraude reconnues sont concernées.

Validation : 24 permutations chiffrées, persistance SQLite, accès administrateur, acheminement agent/Lua, refus d’une copie corrompue et restauration exacte dans une copie mémoire de l’état réel de Poussifeu. Aucun Pokémon n’a été ajouté à la partie active pendant ces tests.

Les icônes de disquette ouvrent l’enregistrement ; les corbeilles suppriment une entrée de bibliothèque ou un Pokémon de l’équipe. La suppression en équipe est confirmée par le Lua, compacte les emplacements suivants et refuse une copie devenue différente ou la suppression du dernier Pokémon. Relancer le client après cette mise à jour.
