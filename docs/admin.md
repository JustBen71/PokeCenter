# Administration (Sprint 10)

La section **ADMIN** du menu n'apparaît qu'aux administrateurs. L'API revérifie le rôle à chaque route : masquer un bouton n'est jamais une protection.

| Page | Contenu |
|---|---|
| **Gestion** | Vue d'ensemble (joueurs en jeu, jackpot, enchère, roues en attente, gages à finir), puis des panneaux indépendants |
| **Bibliothèque** | Copies et modèles, créateur automatique ou manuel, ajout et remplacement dans une équipe |
| **Roues** | Types de roue et gages, lancement manuel, suivi des tirages |
| **Logs** | Journal d'audit filtrable (Sprint 11) |

Panneaux de **Gestion** (`apps/web/src/admin/*Panel.tsx`, un fichier chacun) :

- **Roues en attente** : la file des tickets achetés, lancés un par un dans l'ordre de réception ;
- **Opérations à vérifier** : commandes de jeu au résultat inconnu, à déclarer appliquées ou non ;
- **Runs** : Run courante de chaque participant et actions suivantes (démarrer, perdue, terminée, nouvelle) ;
- **Lobby** : nom, statut (`OPEN`, `RUNNING`, `FINISHED`, `ARCHIVED`), code d'invitation, participants ;
- **Paramètres financiers** : taxe de dépôt, contributions au jackpot (boutique, enchères, roues), prix de la protection ;
- **Protections** : protections actives par joueur et historique ;
- **Objectifs et récompenses** : ordre, montant, activation.

Les enchères (génération, clôture, annulation) se pilotent depuis leur page ; le jackpot s'ajuste depuis la page Jackpot.

Pour ajouter un réglage :
1. ajouter le champ à `lobbySettingsSchema` (partagé) ;
2. ajouter une migration de colonne dans `lobby_settings` ;
3. faire la correspondance dans `LobbyRepository.settings/updateSettings` ;
4. ajouter une ligne au tableau `fields` de `SettingsPanel`.
