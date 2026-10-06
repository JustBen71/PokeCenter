import {z} from 'zod';
import {characters} from './pokemon-characters.js';
import {speciesInternal} from './species-internal.js';

/**
 * Battle encounters ("combat commandité"): the portal asks a player's client to start, in their own game, a real
 * trainer battle against a party fully decided by the portal. The client only executes the final spec.
 */

// Gen III internal species index → national Pokédex number (copies of a party store the internal one).
export const nationalSpecies=new Map(Object.entries(speciesInternal).map(([national,internal])=>[internal,Number(national)]));

// Trainer sprites a Gen III adapter can show for a custom trainer (secret-base trainer classes of Emerald).
export const battleSpriteIds=['youngster','bug_catcher','rich_boy','camper','cooltrainer_m','lass','school_kid_f','lady','picnicker','cooltrainer_f'] as const;
export const battleSpriteSchema=z.enum(battleSpriteIds);
export type BattleSpriteId=z.infer<typeof battleSpriteSchema>;
export const battleSpriteLabels:Record<BattleSpriteId,string>={youngster:'Gamin',bug_catcher:'Scout',rich_boy:'Richard',camper:'Campeur',cooltrainer_m:'Topdresseur',
 lass:'Fillette',school_kid_f:'Écolière',lady:'Mademoiselle',picnicker:'Pique-niqueuse',cooltrainer_f:'Topdresseuse'};

// Gen III names: 7 characters of the game's own table (accents included), never raw bytes from the Web.
const encodable=new Set(Object.values(characters));
export const BATTLE_TRAINER_NAME_MAX=7;
export const battleTrainerNameSchema=z.string().transform(s=>s.normalize('NFC').trim()).pipe(z.string().min(1).max(BATTLE_TRAINER_NAME_MAX)
 .refine(name=>[...name].every(c=>encodable.has(c)),'Caractère absent de la table du jeu'));
export const battleTrainerSchema=z.object({name:battleTrainerNameSchema,spriteId:battleSpriteSchema}).strict();
export type BattleTrainerSpec=z.infer<typeof battleTrainerSchema>;

/**
 * One opponent Pokémon. The game computes the final stats itself from level, nature and EVs (IVs are fixed at 15 by the
 * Gen III mechanism used). `personality` keeps an exact copy's nature, gender and ability; otherwise it is derived from
 * `nature`. HP and PP start full, without status.
 */
export const battlePokemonSchema=z.object({
 speciesId:z.number().int().min(1).max(386),
 level:z.number().int().min(1).max(100),
 moves:z.array(z.number().int().min(1).max(354)).min(1).max(4).refine(m=>new Set(m).size===m.length,'Attaque en double'),
 heldItem:z.number().int().min(0).max(376).default(0),
 nature:z.number().int().min(0).max(24),
 ev:z.number().int().min(0).max(255).default(0),
 personality:z.number().int().min(0).max(0xFFFFFFFF).optional()
}).strict().refine(p=>p.personality===undefined||p.personality%25===p.nature,'La personnalité ne correspond pas à la nature');
export type BattlePokemonSpec=z.infer<typeof battlePokemonSchema>;

export const battleEncounterSpecSchema=z.object({
 encounterId:z.string().uuid(),
 trainer:battleTrainerSchema,
 party:z.array(battlePokemonSchema).min(1).max(6),
 options:z.object({rewardMode:z.literal('GAME_DEFAULT').default('GAME_DEFAULT')}).strict().default({rewardMode:'GAME_DEFAULT'})
}).strict();
export type BattleEncounterSpec=z.infer<typeof battleEncounterSpecSchema>;

export const battleScalingModes=['COPY_EXACT','DELTA_LEVEL','MATCH_PLAYER_AVERAGE','MATCH_PLAYER_HIGHEST','CUSTOM_LEVELS'] as const;
export const battleScalingSchema=z.object({
 mode:z.enum(battleScalingModes),
 // DELTA_LEVEL: added to every level; MATCH_*: added to the player's reference level.
 delta:z.number().int().min(-99).max(99).default(0),
 levels:z.array(z.number().int().min(1).max(100)).min(1).max(6).optional()
}).strict().refine(s=>s.mode!=='CUSTOM_LEVELS'||!!s.levels,'Indiquez les niveaux');
export type BattleScalingSpec=z.infer<typeof battleScalingSchema>;
export const battleScalingLabels:Record<BattleScalingSpec['mode'],string>={COPY_EXACT:'Copie exacte',DELTA_LEVEL:'± N niveaux',MATCH_PLAYER_AVERAGE:'Moyenne du joueur ± N',
 MATCH_PLAYER_HIGHEST:'Plus haut niveau du joueur ± N',CUSTOM_LEVELS:'Niveaux choisis'};

export const battleSourceTypes=['CURRENT_PLAYER_PARTY','OTHER_PLAYER_CURRENT_PARTY','LEADER_PARTY','CUSTOM_PARTY'] as const;
export type BattleSourceType=typeof battleSourceTypes[number];
export const battleSourceLabels:Record<BattleSourceType,string>={CURRENT_PLAYER_PARTY:'Miroir',OTHER_PLAYER_CURRENT_PARTY:'Équipe d’un joueur',LEADER_PARTY:'Équipe du #1',CUSTOM_PARTY:'Équipe personnalisée'};

// What builds the opponent party. Sources are snapshotted when the encounter is created.
export const battleBuilderSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('MIRROR')}).strict(),
 z.object({type:z.literal('OTHER_PLAYER'),opponentId:z.string().min(1).max(64)}).strict(),
 z.object({type:z.literal('LEADER')}).strict(),
 z.object({type:z.literal('CUSTOM'),party:z.array(battlePokemonSchema).min(1).max(6)}).strict()
]);
export type BattleBuilder=z.infer<typeof battleBuilderSchema>;
export const battleCreateSchema=z.object({
 accountId:z.string().min(1).max(64),builder:battleBuilderSchema,
 scaling:battleScalingSchema.default({mode:'COPY_EXACT',delta:0}),
 trainer:z.object({name:battleTrainerNameSchema.optional(),spriteId:battleSpriteSchema.optional()}).strict().default({})
}).strict();
export type BattleCreateInput=z.infer<typeof battleCreateSchema>;

export const battleStatuses=['CREATED','WAITING_SAFE_STATE','SENDING','STARTING','RUNNING','WON','LOST','CANCELLED','FAILED','REVIEW'] as const;
export type BattleStatus=typeof battleStatuses[number];
export const battleStatusLabels:Record<BattleStatus,string>={CREATED:'Créé',WAITING_SAFE_STATE:'En attente d’un moment sûr',SENDING:'Envoi au jeu',STARTING:'Démarrage',
 RUNNING:'Combat en cours',WON:'Victoire',LOST:'Défaite',CANCELLED:'Annulé',FAILED:'Échec',REVIEW:'À vérifier'};
// Terminal statuses never change again; REVIEW is left only by a reconciliation or an admin.
export const battleTransitions:Record<BattleStatus,readonly BattleStatus[]>={
 CREATED:['WAITING_SAFE_STATE','CANCELLED'],
 WAITING_SAFE_STATE:['SENDING','CANCELLED','FAILED'],
 SENDING:['STARTING','RUNNING','WAITING_SAFE_STATE','FAILED','REVIEW'],
 STARTING:['RUNNING','WON','LOST','REVIEW','FAILED'],
 RUNNING:['WON','LOST','REVIEW'],
 REVIEW:['RUNNING','WON','LOST','FAILED','CANCELLED'],
 WON:[],LOST:[],CANCELLED:[],FAILED:[]
};
export const battleResults=['WIN','LOSS','DRAW','ABORTED','UNKNOWN'] as const;
export type BattleResult=typeof battleResults[number];

export type BattleEncounter={
 id:string;lobbyId:string;accountId:string;runId:string|null;
 sourceType:BattleSourceType;sourceRefId:string|null;sourceLabel:string;
 status:BattleStatus;trainer:BattleTrainerSpec;party:BattlePokemonSpec[];scaling:BattleScalingSpec;
 commandId:string|null;createdBy:string|null;createdAt:string;startedAt:string|null;endedAt:string|null;
 result:{outcome:BattleResult;observedAt:string}|null;errorCode:string|null;
};
export type BattlePreview={spec:BattleEncounterSpec;sourceType:BattleSourceType;sourceRefId:string|null;sourceLabel:string;scaling:BattleScalingSpec;
 playerLevels:{average:number;highest:number}|null;sourceLevels:number[]};
export type BattlesSnapshot={encounters:BattleEncounter[]};

// Battle state reported by a client whose adapter announces battle.trainer.start (reconciliation after a reconnection).
export const battleStateSchema=z.object({
 safe:z.boolean(),inBattle:z.boolean(),
 activeEncounterId:z.string().uuid().nullable(),
 last:z.object({encounterId:z.string().uuid(),outcome:z.enum(battleResults)}).strict().nullable()
}).strict();
export type BattleState=z.infer<typeof battleStateSchema>;
