import {z} from 'zod';
import {passiveRaritySchema} from './passives.js';

export const wheelToneSchema=z.enum(['GOOD','BAD','NEUTRAL']);
export type WheelTone=z.infer<typeof wheelToneSchema>;
export const wheelToneLabels:Record<WheelTone,string>={GOOD:'Bienveillante',BAD:'Hostile',NEUTRAL:'Neutre'};

// Ten local ticket icons: five green (kind) and five purple (hostile).
export const ticketIcons=['green-1','green-2','green-3','green-4','green-5','purple-1','purple-2','purple-3','purple-4','purple-5'] as const;
export const ticketIconSchema=z.enum(ticketIcons);

/**
 * A gage only names a handler implemented and tested on the server, plus validated parameters.
 * The configuration never becomes a programming language.
 */
export const gageHandlers=['NOTICE','GIVE_MONEY','TAKE_MONEY','STEAL_MONEY','REMOVE_POKEMON','GIVE_LIBRARY_POKEMON','JACKPOT_FIXED','JACKPOT_PERCENT','JACKPOT_SHARE','JACKPOT_EMPTY',
 'PASSIVE_GRANT_RANDOM','PASSIVE_GRANT_RARITY','PASSIVE_STEAL'] as const;
export const gageHandlerSchema=z.enum(gageHandlers);
export type GageHandler=z.infer<typeof gageHandlerSchema>;
const amount=z.number().int().min(1).max(999999);
export const gageParamsSchemas={
 NOTICE:z.object({}).strict(),
 GIVE_MONEY:z.object({amount}).strict(),
 TAKE_MONEY:z.object({amount}).strict(),
 STEAL_MONEY:z.object({amount}).strict(),
 REMOVE_POKEMON:z.object({selector:z.enum(['random','highest','lowest','choice'])}).strict(),
 GIVE_LIBRARY_POKEMON:z.object({artifactId:z.string().min(1).max(64)}).strict(),
 JACKPOT_FIXED:z.object({amount}).strict(),
 JACKPOT_PERCENT:z.object({percent:z.number().int().min(1).max(100)}).strict(),
 JACKPOT_SHARE:z.object({}).strict(),
 JACKPOT_EMPTY:z.object({}).strict(),
 PASSIVE_GRANT_RANDOM:z.object({rarities:z.array(passiveRaritySchema).min(1).max(4).refine(v=>new Set(v).size===v.length)}).strict(),
 PASSIVE_GRANT_RARITY:z.object({rarity:passiveRaritySchema}).strict(),
 PASSIVE_STEAL:z.object({}).strict()
} satisfies Record<GageHandler,z.ZodTypeAny>;
export const gageHandlerInfo:Record<GageHandler,{label:string;target:'none'|'required';help:string}>={
 NOTICE:{label:'Gage à réaliser',target:'none',help:'Aucun effet en jeu : le gage est annoncé à tous.'},
 GIVE_MONEY:{label:'Gain de Pokédollars',target:'none',help:'Le bénéficiaire reçoit le montant dans son jeu.'},
 TAKE_MONEY:{label:'Perte de Pokédollars',target:'required',help:'La cible perd le montant (une part peut aller au jackpot).'},
 STEAL_MONEY:{label:'Braquage',target:'required',help:'Le montant passe de la cible au bénéficiaire.'},
 REMOVE_POKEMON:{label:'Retrait d’un Pokémon',target:'required',help:'La cible perd un Pokémon (jamais le dernier).'},
 GIVE_LIBRARY_POKEMON:{label:'Pokémon offert',target:'none',help:'Le bénéficiaire reçoit un Pokémon de la bibliothèque.'},
 JACKPOT_FIXED:{label:'Jackpot : montant fixe',target:'none',help:'Le bénéficiaire reçoit un montant pris dans le jackpot.'},
 JACKPOT_PERCENT:{label:'Jackpot : pourcentage',target:'none',help:'Le bénéficiaire reçoit une part du jackpot.'},
 JACKPOT_SHARE:{label:'Jackpot partagé',target:'none',help:'Le jackpot est réparti entre tous les joueurs en jeu.'},
 JACKPOT_EMPTY:{label:'Jackpot vidé',target:'none',help:'Le bénéficiaire remporte tout le jackpot.'},
 PASSIVE_GRANT_RANDOM:{label:'Passif aléatoire',target:'none',help:'Le bénéficiaire gagne un passif compatible qu’il ne possède pas, parmi les raretés choisies.'},
 PASSIVE_GRANT_RARITY:{label:'Passif d’une rareté',target:'none',help:'Le bénéficiaire gagne un passif compatible de cette rareté.'},
 PASSIVE_STEAL:{label:'Vol de passif',target:'required',help:'Choisis une cible puis l’un de ses passifs : il passe au bénéficiaire avec sa progression.'}
};

export const gageInputSchema=z.object({
 id:z.string().min(1).max(64).optional(),
 name:z.string().trim().min(1).max(80),description:z.string().trim().max(500).default(''),
 handler:gageHandlerSchema,params:z.record(z.unknown()).default({}),weight:z.number().int().min(1).max(100).default(1)
}).strict().superRefine((g,ctx)=>{const r=gageParamsSchemas[g.handler].safeParse(g.params);if(!r.success)ctx.addIssue({code:'custom',path:['params'],message:`Paramètres invalides pour ${g.handler}`});});
export const wheelInputSchema=z.object({
 name:z.string().trim().min(1).max(60),description:z.string().trim().max(300).default(''),price:z.number().int().min(0).max(999999),
 icon:ticketIconSchema,tone:wheelToneSchema,enabled:z.boolean().default(true),gages:z.array(gageInputSchema).min(1).max(40)
}).strict();
export type WheelInput=z.infer<typeof wheelInputSchema>;

export type Gage={id:string;name:string;description:string;handler:GageHandler;params:Record<string,unknown>;weight:number;requiresTarget:boolean};
export type WheelType={id:string;name:string;description:string;price:number;icon:typeof ticketIcons[number];tone:WheelTone;enabled:boolean;gages:Gage[]};

export const resolutionStatusSchema=z.enum(['DRAWN','AWAITING_CHOICE','APPLYING','SUCCESS','FAILED','REVIEW','BLOCKED']);
export type ResolutionStatus=z.infer<typeof resolutionStatusSchema>;
export type WheelResolution={
 id:string;wheelId:string;wheelName:string;tone:WheelTone;gage:Gage;ownerId:string;targetId:string|null;ticketId:string|null;
 status:ResolutionStatus;strip:string[];result:string|null;createdAt:string;appliedAt:string|null;
 // A passive lets a player pick the gage among these (null once chosen or for an ordinary draw).
 options:Gage[]|null;chooserId:string|null;
};
export const chooseGageSchema=z.object({gageId:z.string().min(1).max(64)}).strict();
export type WheelsSnapshot={wheels:WheelType[];resolutions:WheelResolution[]};

export const spinSchema=z.object({ownerId:z.string().min(1).max(64),targetId:z.string().min(1).max(64).optional()}).strict();
export const applySchema=z.object({targetId:z.string().min(1).max(64).optional(),slot:z.number().int().min(1).max(6).optional(),confirmOutOfBattle:z.boolean().optional(),passiveId:z.string().min(1).max(40).optional()}).strict();
export type LobbyNotification={kind:'success'|'error'|'warning'|'info';message:string};
