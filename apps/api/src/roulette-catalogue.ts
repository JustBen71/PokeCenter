import type {Gag} from '@pokerace/shared';
export const catalogue:Gag[]=[
  {
    "id": "chaos-01",
    "name": "Le Casse Du Siècle",
    "description": "Le joueur A choisit un joueur et lui vole 50 % de son argent. Le joueur volé ne reçoit rien en échange.",
    "category": "Gros jackpots",
    "weight": 1,
    "enabled": false,
    "action": "money.transfer",
    "blocks": {
      "direction": "steal",
      "percent": 50,
      "playerB": {
        "mode": "choice"
      }
    }
  },
  {
    "id": "chaos-02",
    "name": "Le Magicarpe De La Honte",
    "description": "Un Magicarpe niveau 5 rejoint l'équipe du joueur A. Il doit le garder et commencer son prochain combat de dresseur avec lui.",
    "category": "Malus personnels",
    "weight": 1,
    "enabled": false,
    "action": "pokemon.grant",
    "blocks": {
      "speciesMode": "fixed",
      "speciesId": 129,
      "level": 5,
      "first": "yes",
      "nextTrainerLead": "yes",
      "temu": "no"
    }
  },
  {
    "id": "chaos-03",
    "name": "Le Vol Parfait",
    "description": "Le joueur A choisit un Pokémon vivant dans l'équipe d'un autre joueur et le récupère définitivement. Sa victime reçoit un Pokémon complètement aléatoire en échange.",
    "category": "Chaos et échanges",
    "weight": 1,
    "enabled": false,
    "action": "pokemon.steal",
    "blocks": {
      "playerB": {
        "mode": "choice"
      },
      "pokemonB": {
        "mode": "choice"
      },
      "risk": "replace"
    }
  },
  {
    "id": "chaos-04",
    "name": "Le Conseil Des Traîtres",
    "description": "Les autres joueurs votent pour choisir un Pokémon dans l'équipe du joueur A. Ce Pokémon est échangé contre un Pokémon aléatoire de la box d'un des votants.",
    "category": "Chaos et échanges",
    "weight": 1,
    "enabled": false,
    "action": "gag.pending",
    "blocks": {
      "reason": "Échange avec une boîte PC."
    }
  },
  {
    "id": "chaos-05",
    "name": "Le Dilemme Du Con",
    "description": "Le joueur A choisit entre deux enveloppes :\nA — Reçois un Pokémon légendaire aléatoire, mais perds immédiatement un Pokémon de ton équipe tiré au sort.\nB — Vole le meilleur Pokémon d'un joueur de ton choix, mais ce joueur choisit un Pokémon de ton équipe à récupérer en échange.",
    "category": "Chaos et échanges",
    "weight": 1,
    "enabled": false,
    "action": "pokemon.dilemma",
    "blocks": {}
  },
  {
    "id": "chaos-06",
    "name": "Le Syndicat Des Pokémon",
    "description": "Le Pokémon du joueur A au niveau le plus élevé se met en grève : il reste dans la box jusqu'à ce que Le joueur A batte son prochain champion.",
    "category": "Malus personnels",
    "weight": 1,
    "enabled": false,
    "action": "gag.pending",
    "blocks": {
      "reason": "Retrait temporaire en box et restitution au prochain badge."
    }
  },
  {
    "id": "chaos-07",
    "name": "La Résurrection Interdite",
    "description": "Le joueur A peut ressusciter un Pokémon mort, mais les autres joueurs choisissent lequel parmi ses morts. Il peut refuser et garder cette récompense pour plus tard.",
    "category": "Gros jackpots",
    "weight": 1,
    "enabled": false,
    "action": "gag.pending",
    "blocks": {
      "reason": "Récompense conservable et sélection parmi les morts en box."
    }
  },
  {
    "id": "chaos-08",
    "name": "Le Contrôle Fiscal",
    "description": "L'argent du joueur A est remis à zéro et redistribué équitablement entre les autres joueurs.",
    "category": "Catastrophes",
    "weight": 1,
    "enabled": false,
    "action": "money.transfer",
    "blocks": {
      "direction": "redistribute",
      "percent": 100,
      "playerB": {
        "mode": "random"
      }
    }
  },
  {
    "id": "chaos-09",
    "name": "Le Pacte Avec Le Diable",
    "description": "Le joueur A reçoit un Pokémon légendaire aléatoire à un niveau adapté. En échange, il ne peut capturer aucun Pokémon sur les deux prochaines routes.",
    "category": "Événements légendaires",
    "weight": 1,
    "enabled": false,
    "action": "pokemon.grant",
    "blocks": {
      "speciesMode": "legendary",
      "level": 0,
      "first": "no",
      "temu": "no",
      "restrictRoutes": 2
    }
  },
  {
    "id": "chaos-10",
    "name": "Le Dernier De La Classe",
    "description": "Le joueur A doit garder son Pokémon le plus faible dans son équipe jusqu'au prochain badge. S'il meurt, les autres joueurs choisissent son surnom Discord pendant 24 heures.",
    "category": "Malus personnels",
    "weight": 1,
    "enabled": false,
    "action": "rule.keep",
    "blocks": {
      "pokemonA": {
        "mode": "lowest"
      },
      "discord": "yes"
    }
  },
  {
    "id": "chaos-11",
    "name": "Le Braquage Raté",
    "description": "Le joueur A tente de voler le Pokémon de son choix à un autre joueur. Une deuxième roulette décide : 50 % de réussite ; 50 % de chance que la victime vole à la place un Pokémon aléatoire au joueur A.",
    "category": "Chaos et échanges",
    "weight": 1,
    "enabled": false,
    "action": "pokemon.steal",
    "blocks": {
      "playerB": {
        "mode": "choice"
      },
      "pokemonB": {
        "mode": "choice"
      },
      "risk": "coin"
    }
  },
  {
    "id": "chaos-12",
    "name": "Le Pokémon Temu",
    "description": "Le joueur A choisit une espèce et reçoit ce Pokémon, mais ses IV, sa nature, son talent et ses quatre attaques sont complètement randomisés.",
    "category": "Gros jackpots",
    "weight": 1,
    "enabled": false,
    "action": "pokemon.grant",
    "blocks": {
      "speciesMode": "choice",
      "temu": "yes",
      "level": 0,
      "first": "no"
    }
  },
  {
    "id": "chaos-13",
    "name": "L'Arnaqueur Arnaqué",
    "description": "Le joueur A désigne un autre joueur. Chacun place dans une Poké Ball virtuelle un Pokémon aléatoire de sa box. Les deux Pokémon sont échangés sans révéler leur identité au préalable.",
    "category": "Chaos et échanges",
    "weight": 1,
    "enabled": false,
    "action": "gag.pending",
    "blocks": {
      "reason": "Échange de Pokémon des boîtes PC."
    }
  },
  {
    "id": "chaos-14",
    "name": "Le Dieu Des Pauvres",
    "description": "Le joueur A récupère gratuitement un Pokémon de son choix appartenant au joueur actuellement dernier, mais doit lui donner son Pokémon au niveau le plus élevé.",
    "category": "Chaos et échanges",
    "weight": 1,
    "enabled": false,
    "action": "pokemon.swap",
    "blocks": {
      "playerB": {
        "mode": "last"
      },
      "pokemonA": {
        "mode": "highest"
      },
      "pokemonB": {
        "mode": "choice"
      }
    }
  },
  {
    "id": "chaos-15",
    "name": "La Banane Mario Kart",
    "description": "Le joueur A reçoit une carte lui permettant de forcer un autre joueur à relancer sa prochaine roulette et à subir le deuxième résultat. La carte expire au prochain badge.",
    "category": "Malus personnels",
    "weight": 1,
    "enabled": false,
    "action": "card.grant",
    "blocks": {
      "kind": "reroll"
    }
  },
  {
    "id": "chaos-16",
    "name": "La Roue Dans La Roue",
    "description": "Le joueur A relance deux fois la roulette et subit les deux résultats. Si l'un accorde une immunité, elle ne protège pas contre l'autre.",
    "category": "Chaos et échanges",
    "weight": 1,
    "enabled": false,
    "action": "roulette.repeat",
    "blocks": {
      "count": 2
    }
  },
  {
    "id": "chaos-17",
    "name": "Le Pokémon Du Peuple",
    "description": "Les autres joueurs proposent trois Pokémon absurdes. Le joueur A en reçoit un au hasard, à un niveau adapté à sa progression, et doit le garder jusqu'au prochain champion.",
    "category": "Gros jackpots",
    "weight": 1,
    "enabled": false,
    "action": "pokemon.people",
    "blocks": {}
  },
  {
    "id": "chaos-18",
    "name": "L'Héritage",
    "description": "Le joueur A désigne un autre joueur comme héritier. Si l'un de ses Pokémon meurt avant son prochain badge, l'héritier reçoit 50 % de son argent. Si aucun ne meurt, Le joueur A vole 25 % de l'argent de son héritier.",
    "category": "Catastrophes",
    "weight": 1,
    "enabled": false,
    "action": "rule.inheritance",
    "blocks": {
      "playerB": {
        "mode": "choice"
      },
      "deathPercent": 50,
      "badgePercent": 25
    }
  },
  {
    "id": "chaos-19",
    "name": "Le Double Ou Rien",
    "description": "Le joueur A choisit l'un de ses Pokémon vivants. Pile : il obtient un deuxième Pokémon de la même espèce et au même niveau. Face : son Pokémon choisi est envoyé dans la box jusqu'au prochain badge.",
    "category": "Chaos et échanges",
    "weight": 1,
    "enabled": false,
    "action": "gag.pending",
    "blocks": {
      "reason": "Clonage ou retrait temporaire en box."
    }
  },
  {
    "id": "chaos-20",
    "name": "Le Joker Absolu",
    "description": "Le joueur A gagne un joker utilisable avant son prochain badge : il peut soit refuser une future roulette, soit forcer un joueur de son choix à lui donner un Pokémon aléatoire de sa box.",
    "category": "Gros jackpots",
    "weight": 1,
    "enabled": false,
    "action": "gag.pending",
    "blocks": {
      "reason": "Joker conservable, expiration et vol en box."
    }
  }
];
