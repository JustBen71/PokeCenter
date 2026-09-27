import {z} from 'zod';
export const playerSelectorSchema=z.object({mode:z.enum(['fixed','random','first','last','penultimate','rank','choice']),playerId:z.string().max(64).optional(),rank:z.number().int().min(1).max(100).optional()}).superRefine((v,c)=>{if(v.mode==='fixed'&&!v.playerId)c.addIssue({code:'custom',message:'Choisissez un joueur'});if(v.mode==='rank'&&!v.rank)c.addIssue({code:'custom',message:'Choisissez un rang'});});
export const pokemonSelectorSchema=z.object({mode:z.enum(['random','highest','lowest','slot','choice']),by:z.enum(['spinner','target','vote']).optional(),slot:z.number().int().min(1).max(6).optional()}).superRefine((v,c)=>{if(v.mode==='slot'&&!v.slot)c.addIssue({code:'custom',message:'Choisissez un emplacement'});});
export const gagSchema=z.object({name:z.string().trim().min(1).max(80),description:z.string().max(2000).default(''),category:z.string().max(60).default('Personnalisé'),weight:z.number().int().min(1).max(1000),enabled:z.boolean(),action:z.string().min(1).max(40),blocks:z.record(z.unknown())});
export type Gag=Omit<z.infer<typeof gagSchema>,'description'|'category'>&{id:string;description?:string;category?:string};
export type PlayerSelector=z.infer<typeof playerSelectorSchema>;
export type PokemonSelector=z.infer<typeof pokemonSelectorSchema>;
export type BlockField={key:string;label:string;type:'player'|'pokemon'|'text'|'spinner'|'number'|'select';default?:unknown;options?:{value:string;label:string}[];min?:number;max?:number};
export type ActionDescription={id:string;label:string;description:string;fields:BlockField[]};
export type GameBundle={money:number;party:string[]};
export type RouletteOperation={playerId:string;slot:number;before:string;after:string;label:string;bundleBefore?:GameBundle;bundleAfter?:GameBundle};
export type RouletteChoice={key:string;label:string;actors:string[];options:{value:string;label:string}[];votes:Record<string,string>};
export type RouletteRun={returnEffectId?:string;autoApply?:boolean;effects?:RouletteEffectDraft[];completedAt?:string;parentId?:string;sequence?:number;gag?:Gag;choices?:Record<string,string>;pending?:RouletteChoice;spinnerId?:string;spinnerName?:string;id:string;gagId:string;name:string;createdAt:string;status:'queued'|'preparing'|'drawn'|'executing'|'completed'|'cancelled'|'failed'|'review';summary:string;operations:RouletteOperation[];log:string[];odds:{id:string;weight:number}[];drawKey:string};

export type RouletteEffectDraft={kind:'reroll'|'revive'|'inheritance'|'keep'|'lead'|'noCapture'|'suspend';targetId?:string;identity?:string;deathPercent?:number;badgePercent?:number;discord?:boolean;routeCount?:number;minutes?:number;raw?:string;speciesId?:number;pokemonName?:string};
export type RouletteEffect=RouletteEffectDraft&{id:string;runId:string;ownerId:string;name:string;status:'active'|'armed'|'used'|'expired'|'triggered'|'review';badges:string[];living:string[];note:string;createdAt:string;triggerRunId?:string;trainerBattles?:number;captures?:number;routes?:string[];lastMap?:string;violations?:number;releaseAt?:string};
