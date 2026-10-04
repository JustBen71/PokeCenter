# Objectifs, classement et carte (Sprint 4)

## Objectifs du lobby

Chaque lobby possède une liste ordonnée d'objectifs (tables `objectives` et `objective_completions`). À sa création, elle reprend les étapes Émeraude lues par l'adaptateur, dans l'ordre du jeu et sans récompense.

Un objectif contient : `id`, `name`, `description`, `order`, `rewardMoney`, `mapPosition` (section de la carte), `gameCondition` et `enabled`. Une condition est une donnée vérifiée par du code serveur : aujourd'hui, uniquement `{type: 'progression', objectiveId}`, c'est-à-dire un flag de progression lu dans le jeu.

À chaque nouvelle observation du jeu (et à chaque changement de Run), l'API :

1. enregistre les objectifs nouvellement atteints, **une seule fois par joueur et par objectif** (clé primaire), quelle que soit la Run ;
2. verse la récompense éventuelle par le moteur d'argent (`OBJECTIVE_REWARD`, `EXTERNAL → GAME`).

États de la récompense :
- `PENDING` : conditions non réunies (pas de Run en cours, jeu hors ligne, joueur occupé), nouvelle tentative à l'observation suivante ;
- `PAID` : versée ;
- `REVIEW` : confirmation perdue, l'admin la résout dans les opérations à vérifier. Si elle n'a pas été appliquée, la récompense repasse en `PENDING`.

Chaque tentative utilise sa propre clé d'idempotence (`objective:<lobby>:<objectif>:<compte>:attempt-N`). Un même versement n'est jamais rejoué, et un refus explicite (jeu changé entre-temps) passe à la tentative suivante. Au-delà de 5 refus, l'objectif n'est plus retenté automatiquement.

Routes :
- `GET /api/lobbies/:id/objectives` (membres) ;
- `PATCH /api/lobbies/:id/objectives/:objectiveId` (admin) : `{name?, description?, rewardMoney?, order?, enabled?}`.

En temps réel, le sujet `objectives` est poussé sur `/dashboard`.

## Classement

Le même calcul sert aux pages Course et Carte (`apps/web/src/map/objective-score.ts`) : nombre d'objectifs actifs du lobby atteints dans la partie chargée, puis l'objectif atteint le plus avancé dans l'ordre du lobby. Les égalités partagent le même rang. Les joueurs dont la progression n'est pas lisible ne sont pas classés. Sans objectif de lobby, on revient à l'ancien ordre (Panthéon, Conseil 4, badges, histoire).

## Carte

La carte de Hoenn place les joueurs par zone avec **l'avatar de leur compte**, numéro de rang compris. Le panneau du joueur sélectionné liste les objectifs du lobby : atteint ou non, récompense et état du versement.

## Gestion

**Gestion → Objectifs et récompenses** : ordre (↑/↓), montant en ₽, activation.
