import {z} from 'zod';
import {gameCapabilitySchema} from './game.js';
import {eventCapabilitySchema} from './native-client.js';

/**
 * Race passives: permanent bonuses owned by a player for a whole lobby (LOBBY + ACCOUNT), never by a Run.
 * The catalogue is data; each entry names a handler implemented and tested on the server.
 */
export const passiveRarities=['COMMON','UNCOMMON','RARE','LEGENDARY'] as const;
export const passiveRaritySchema=z.enum(passiveRarities);
export type PassiveRarity=z.infer<typeof passiveRaritySchema>;
export const passiveRarityLabels:Record<PassiveRarity,string>={COMMON:'Commun',UNCOMMON:'Peu commun',RARE:'Rare',LEGENDARY:'Légendaire'};
export const defaultRarityWeights:Record<PassiveRarity,number>={COMMON:55,UNCOMMON:30,RARE:12,LEGENDARY:3};

// Capabilities a passive may need: game capabilities and game events, both announced by a validated adapter.
export const passiveCapabilitySchema=z.enum([...gameCapabilitySchema.options,...eventCapabilitySchema.options]);
export type PassiveCapability=z.infer<typeof passiveCapabilitySchema>;

export const passiveSources=['INITIAL_CHOICE','ADMIN','WHEEL','JACKPOT','SHOP','EVENT'] as const;
export const passiveSourceSchema=z.enum(passiveSources);
export type PassiveSource=z.infer<typeof passiveSourceSchema>;
export const passiveSourceLabels:Record<PassiveSource,string>={INITIAL_CHOICE:'Choix initial',ADMIN:'Administration',WHEEL:'Roue',JACKPOT:'Jackpot',SHOP:'Boutique',EVENT:'Événement'};

export type PassiveDefinition={
 id:string;name:string;rarity:PassiveRarity;family:string;description:string;
 handler:string;params:Record<string,number>;requires:PassiveCapability[];
};

const def=(id:string,name:string,rarity:PassiveRarity,family:string,handler:string,description:string,requires:PassiveCapability[]=[],params:Record<string,number>={}):PassiveDefinition=>
 ({id,name,rarity,family,description,handler,params,requires});

// Version of the catalogue below; bump it when an entry changes meaning.
export const PASSIVE_CATALOG_VERSION=2;
// Each entry is a distinct mechanic: never stronger copies of the same bonus.
export const passiveCatalog:readonly PassiveDefinition[]=[
 def('trainer-payday','Prime de dresseur','COMMON','Combat / argent','TRAINER_MONEY_MULTIPLIER','+5 % de la récompense native après chaque victoire contre un dresseur.',['events.trainer_victory','money.write'],{percent:5}),
 def('cartographer','Cartographe','COMMON','Exploration','MAP_EXPLORER','Chaque nouveau lieu visité est enregistré pour toute la course. Tous les 5 nouveaux lieux : +1 ticket de roue bienveillante.',['location.read'],{every:5}),
 def('loyal-companion','Compagnon fidèle','COMMON','Fidélité Pokémon','LOYAL_COMPANION','Ton compagnon est le premier Pokémon de ton équipe. Après 3 objectifs atteints sans qu’il quitte l’équipe : toute l’équipe est soignée (PV et statut) dès que tu es hors combat.',['party.read','pokemon.replace'],{objectives:3}),
 def('last-standing','Dernier debout','COMMON','Survie','LAST_STANDING','Une fois par Run, si un combat se termine avec un seul Pokémon conscient : ton équipe remonte à au moins 50 % de ses PV.',['events.battle_ended','pokemon.replace']),
 def('bargain-hunter','Brocanteur','COMMON','Enchères / information','BARGAIN_HUNTER','Après 3 enchères perdues, une vraie statistique du prochain lot auquel tu participes t’est révélée.',[],{losses:3}),
 def('scout','Éclaireur','COMMON','Progression','SCOUT','Après chaque objectif atteint, le prochain objectif et sa récompense te sont révélés.',['progression.read']),
 def('collector','Collectionneur','COMMON','Diversité Pokémon','COLLECTOR','Tous les 10 Pokémon d’espèces différentes passés dans ton équipe : +1 ticket de roue bienveillante.',['party.read'],{every:10}),
 def('second-wind','Deuxième souffle','UNCOMMON','Nouvelle Run','SECOND_WIND','Après une Run perdue, la nouvelle Run commence avec +1 500 ₽ (3 fois maximum).',['money.write'],{amount:1500,max:3}),
 def('counterspell','Contre-sort','UNCOMMON','Roues / anti-répétition','COUNTERSPELL','Une roue hostile ne peut pas t’infliger le même gage que la précédente roue hostile subie.'),
 def('rivalry','Rivalité','UNCOMMON','Classement / attaque','RIVALRY','Quand tu dépasses un adversaire au classement, le premier joueur dépassé reçoit une roue hostile aléatoire.',['progression.read']),
 def('alchemist','Alchimiste','UNCOMMON','Nature Pokémon','ALCHEMIST','Une fois par Run : choisis un Pokémon et une nouvelle nature parmi 3.',['pokemon.replace']),
 def('treasure-hunter','Chasseur de trésors','UNCOMMON','Combats / objets','TREASURE_HUNTER','Tous les 10 combats de dresseurs gagnés : un objet aléatoire dans ton sac.',['events.trainer_victory','items.write'],{every:10}),
 def('sixth-man','Le sixième homme','UNCOMMON','Badges / équipe','SIXTH_MAN','À chaque nouveau badge obtenu avec 6 Pokémon dans l’équipe : +1 roue bienveillante aléatoire.',['progression.read','party.read']),
 def('marathoner','Marathonien','RARE','Pas','MARATHONER','Tous les 25 000 pas cumulés sur la course : +10 000 ₽.',['steps.read','money.write'],{every:25000,amount:10000}),
 def('unstable-dna','ADN instable','RARE','Amélioration IV','UNSTABLE_DNA','Tous les 2 objectifs : une IV aléatoire d’un Pokémon choisi gagne +2 (max 31).',['pokemon.replace'],{objectives:2,gain:2}),
 def('type-master','Maître des types','RARE','Team building','TYPE_MASTER','Objectif atteint avec 6 Pokémon couvrant au moins 10 types : une CT aléatoire dans ton sac.',['party.read','items.write'],{types:10}),
 def('resurrection','Résurrection','RARE','K.O.','RESURRECTION','Une fois par Run, un Pokémon K.O. revient à 1 PV après le combat au lieu de partir dans la boîte.',['events.pokemon_fainted','events.battle_ended','pokemon.replace']),
 def('mutagen','Mutagène','RARE','Attaques','MUTAGEN','Une fois par Run : choisis un Pokémon, 3 attaques qu’il peut apprendre te sont proposées, l’une remplace une de ses attaques.',['pokemon.replace']),
 def('risk-bonus','Prime de risque','RARE','Combat dangereux','RISK_BONUS','Victoire contre un dresseur avec moins de 35 % de PV moyens : +1 ticket de roue bienveillante (une fois par badge).',['events.trainer_victory','party.read'],{percent:35}),
 def('legend-heir','Héritier des légendes','LEGENDARY','Œuf / pas','LEGEND_EGG','Œuf légendaire virtuel : à 50 000 pas cumulés sur la course, un Pokémon légendaire niveau 5 rejoint ton équipe.',['steps.read','pokemon.insert'],{steps:50000}),
 def('bound-soul','Âme liée','LEGENDARY','Pokémon persistant','BOUND_SOUL','Lie un Pokémon : si la Run est perdue, il peut être réinjecté dans la suivante.',['party.read','pokemon.insert']),
 def('usurper','Usurpateur','LEGENDARY','Passifs / copie','USURPER','Une fois pendant la course : copie un passif non légendaire d’un adversaire.'),
 def('chaos-master','Maître du chaos','LEGENDARY','Roues','CHAOS_MASTER','Une fois pendant la course, face à une roue lancée contre toi : 3 gages tirés, tu choisis celui qui s’applique.'),
 def('paradox','Paradoxe','LEGENDARY','Annulation','PARADOX','Une fois pendant la course : annule la dernière action Pokérace négative réversible.'),
 def('champion-crown','Couronne du champion','LEGENDARY','Classement / passifs','CHAMPION_CROWN','Tant que tu es #1 : chaque objectif donne une charge ; 3 charges = un passif Commun ou Peu commun à choisir parmi 3.',['progression.read'],{charges:3}),
 def('sixth-sense','Sixième sens','LEGENDARY','Récompenses aléatoires','SIXTH_SENSE','Quand une récompense positive aléatoire est générée pour toi : 2 résultats, tu choisis.'),
 def('fate-link','Lien du destin','LEGENDARY','Duo social','FATE_LINK','Lie-toi à un joueur : chaque fois que l’un de vous cumule 3 nouveaux objectifs, l’autre reçoit un ticket bienveillant.',['progression.read'],{objectives:3})
];
export const passiveById=new Map(passiveCatalog.map(p=>[p.id,p]));

// Why a catalogue entry can or cannot be offered right now.
export const passiveAvailabilities=['AVAILABLE','DISABLED_MISSING_CAPABILITY','NOT_YET_IMPLEMENTED'] as const;
export type PassiveAvailability=typeof passiveAvailabilities[number];
export const passiveAvailabilityLabels:Record<PassiveAvailability,string>={AVAILABLE:'Disponible',DISABLED_MISSING_CAPABILITY:'Capability manquante',NOT_YET_IMPLEMENTED:'Pas encore implémenté'};

export const passivePhases=['NONE','SELECTION','DONE'] as const;
export type PassivePhase=typeof passivePhases[number];
export const passivePhaseLabels:Record<PassivePhase,string>={NONE:'Course non lancée',SELECTION:'Sélection des passifs',DONE:'Course lancée'};

export type PassiveCatalogEntry=PassiveDefinition&{enabled:boolean;availability:PassiveAvailability;missing:PassiveCapability[]};
export type OwnedPassive={
 id:string;accountId:string;passiveId:string;source:PassiveSource;acquiredAt:string;
 progress:Record<string,unknown>;metadata:Record<string,unknown>;
};
export type PassiveRewardStatus='PENDING'|'APPLYING'|'CONFIRMED'|'FAILED'|'REVIEW';
export type PassiveReward={id:string;accountId:string;passiveId:string;eventId:string;type:string;payload:Record<string,unknown>;status:PassiveRewardStatus;commandId:string|null;createdAt:string;resolvedAt:string|null};
export type PassiveSelectionState={accountId:string;status:'NO_OFFER'|'WAITING'|'CHOSEN'};
export type PassivesSnapshot={
 phase:PassivePhase;catalogVersion:number;weights:Record<PassiveRarity,number>;
 catalog:PassiveCatalogEntry[];owned:OwnedPassive[];selection:PassiveSelectionState[];
 // Private: only the viewer's own pending offer, never other players'.
 myOffer:string[]|null;
 // Admins only.
 rewards?:PassiveReward[];
};

const weight=z.number().int().min(0).max(1000);
export const passiveSettingsSchema=z.object({
 weights:z.object({COMMON:weight,UNCOMMON:weight,RARE:weight,LEGENDARY:weight}).strict().refine(w=>Object.values(w).some(v=>v>0),'Au moins une rareté doit avoir un poids').optional(),
 disabled:z.array(z.string().min(1).max(40)).max(100).optional()
}).strict().refine(v=>v.weights!==undefined||v.disabled!==undefined,'Aucune modification');
export const passiveChoiceSchema=z.object({passiveId:z.string().min(1).max(40)}).strict();
export const passiveGrantSchema=z.object({accountId:z.string().min(1).max(64),passiveId:z.string().min(1).max(40)}).strict();
export const passiveAccountSchema=z.object({accountId:z.string().min(1).max(64)}).strict();
// A player uses one of their passives (copy, link, choose, undo, bind…); an admin may act for them.
export const passiveActSchema=z.object({
 action:z.enum(['copy','link','choose','undo','bind','reinject','nature','iv','offer','mutate']),accountId:z.string().min(1).max(64).optional(),
 targetId:z.string().min(1).max(64).optional(),passiveId:z.string().min(1).max(40).optional(),slot:z.number().int().min(1).max(6).optional(),
 confirmOutOfBattle:z.boolean().optional(),
 // Alchimiste (nature), Mutagène (move slot 0–3 and the move chosen among the offer).
 nature:z.number().int().min(0).max(24).optional(),moveIndex:z.number().int().min(0).max(3).optional(),moveId:z.number().int().min(1).max(354).optional()
}).strict();
export type PassiveActInput=z.infer<typeof passiveActSchema>;
export const passiveStartSchema=z.object({force:z.boolean().default(false)}).strict();
