# Connexion, comptes et lobbies (Sprint 1)

## Parcours

1. **Qui es-tu ?** : choix du compte dans la liste (le dernier utilisé est présélectionné), puis « Entrer ». Ou « Créer un compte » : nom, avatar (dresseur ou Pokémon des sprites locaux), administrateur oui/non.
2. **Lobbies** : un joueur voit les lobbies dont il est membre et rejoint les autres **par code**. La casse et les espaces du code sont ignorés. Un administrateur voit tous les lobbies avec leur code et peut en créer.
3. **Portail** : le header affiche le nom du lobby, les Pokédollars en jeu du compte (`—` si aucun jeu, valeur en pointillés si c'est la dernière valeur connue) et le menu profil : changer de nom, changer d'avatar, changer de lobby, changer de compte.

## Session navigateur

- `sessionStorage` garde le compte et le lobby de l'onglet : un rechargement les restaure, et deux onglets peuvent utiliser deux comptes.
- `localStorage` mémorise la dernière session pour un nouvel onglet ou après un redémarrage du navigateur.
- Au chargement, le compte est revalidé avec `GET /api/me` et le lobby avec `GET /api/lobbies/:id` (il faut être encore membre). Sinon, on revient à l'écran précédent.
- « Changer de compte » efface la session mémorisée et garde seulement la présélection.

## API

| Route | Accès | Rôle |
|---|---|---|
| `GET /api/accounts` | libre | Liste pour l'écran de connexion |
| `POST /api/accounts` | libre | Création (nom unique normalisé, avatar validé, rôle déclaré) |
| `PATCH /api/accounts/:id` | soi-même ou admin | Modification partielle `{name?, sprite?, admin?}` |
| `GET /api/me` | compte | Compte courant |
| `GET /api/lobbies` | compte | Mes lobbies (admin : tous) |
| `POST /api/lobbies` | admin | Création ; le créateur devient membre |
| `POST /api/lobbies/join` | compte | `{code}` ; idempotent ; refusé si le lobby est archivé |
| `GET /api/lobbies/:id` | membre ou admin | Détail, participants et code |
| `PATCH /api/lobbies/:id` | admin | `{name?, status?}` |

Le compte est transmis par l'en-tête `x-account-id` et le rôle est **toujours relu en base**. Masquer un bouton côté navigateur ne suffit jamais.

Règles de rôle :
- un non-admin ne peut pas se promouvoir ni modifier un autre compte (`ADMIN_REQUIRED`, `FORBIDDEN`) ;
- un admin peut promouvoir ou rétrograder ;
- le dernier administrateur ne peut pas être rétrogradé (`LAST_ADMIN`).

Le rôle est déclaré à la création, ce qui reste volontairement simple pour un réseau privé entre amis.

Les erreurs suivent le format stable `{ok:false,error:{code,message}}` et le front les affiche en notifications (toasts). Les créations, adhésions, modifications et changements de rôle sont tracés dans `audit_logs` (catégories `ACCOUNT`, `ADMIN`, `LOBBY`).

Les anciennes routes `/api/rooms` restent disponibles pour la compatibilité, et `/api/rooms/resolve` est toujours utilisé par les clients de jeu.
