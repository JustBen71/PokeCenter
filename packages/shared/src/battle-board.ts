import {z} from 'zod';
import {battleSpriteSchema,battleTrainerNameSchema,type BattlePokemonSpec,type BattleTrainerSpec} from './battles.js';

/**
 * Tableau des combats: teams prepared by an admin (or drawn by a wheel), visible to every player. The first player
 * who accepts reserves the team and fights it in their game; a win pays the reward, a loss is a normal defeat
 * (end of Run) and puts the team back on the board.
 */
export const legendarySpecies:readonly number[]=[144,145,146,150,151,243,244,245,249,250,251,377,378,379,380,381,382,383,384,385,386];
export const isLegendary=(speciesId:number)=>legendarySpecies.includes(speciesId);

// Held items a drawn opponent may carry (not only consumables), with what each adds to the reward.
export const boardHeldItems:readonly (readonly [number,number])[]=[
 [139,100],[133,150],[134,150],[135,150],[136,150],[137,150],[138,150],[140,200],[141,200],[142,400],[143,300],[144,300],[145,300],[146,300],[147,300],
 [168,600],[169,600],[170,600],[171,600],[172,600],[173,800],[174,800],
 [196,500],[198,500],[203,500],[204,500],[205,500],[206,500],[207,500],[208,500],[209,500],[210,500],[211,500],[212,500],[213,500],[214,500],[215,500],[216,500],[217,500],
 [180,700],[185,700],[179,800],[183,1000],[184,300],[219,1200],[200,1500],[186,2000]];
export const boardItemValue=(id:number)=>boardHeldItems.find(([item])=>item===id)?.[1]??0;
// Suggested reward: 40 ₽ per level, +10 % per Pokémon beyond the first, +2 000 ₽ per legendary, + the held items' value,
// ×1.5 for a blind battle; rounded to 100 ₽.
export const boardRewardRules={perLevel:40,perExtraPokemon:0.1,perLegendary:2000,blind:1.5,round:100} as const;
export function boardReward(party:readonly (Pick<BattlePokemonSpec,'speciesId'|'level'>&{heldItem?:number})[],blind=false){
 const r=boardRewardRules;
 const levels=party.reduce((sum,p)=>sum+p.level*r.perLevel,0);
 const total=levels*(1+r.perExtraPokemon*Math.max(0,party.length-1))+party.filter(p=>isLegendary(p.speciesId)).length*r.perLegendary
  +party.reduce((sum,p)=>sum+boardItemValue(p.heldItem??0),0);
 return Math.min(999999,Math.round(total*(blind?r.blind:1)/r.round)*r.round);
}
export const boardAverageLevel=(party:readonly Pick<BattlePokemonSpec,'level'>[])=>party.length?Math.round(party.reduce((s,p)=>s+p.level,0)/party.length):0;

export const boardLegendaryModes=['NO','ALLOWED','ONLY'] as const;
export const boardLegendaryLabels:Record<typeof boardLegendaryModes[number],string>={NO:'Sans légendaire',ALLOWED:'Légendaire possible',ONLY:'Légendaire uniquement'};
// One place of a team: a chosen Pokémon (moves optional: the last four learnt at its level), or a draw.
export const boardSlotSchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('FIXED'),speciesId:z.number().int().min(1).max(386),level:z.number().int().min(1).max(100),
  moves:z.array(z.number().int().min(1).max(354)).max(4).default([]),heldItem:z.number().int().min(0).max(376).default(0),
  nature:z.number().int().min(0).max(24).optional(),ev:z.number().int().min(0).max(255).default(0)}).strict(),
 z.object({mode:z.literal('RANDOM'),minLevel:z.number().int().min(1).max(100),maxLevel:z.number().int().min(1).max(100),
  legendary:z.enum(boardLegendaryModes).default('NO')}).strict()
]).refine(s=>s.mode!=='RANDOM'||s.minLevel<=s.maxLevel,'Niveau minimum supérieur au maximum');
export type BoardSlot=z.infer<typeof boardSlotSchema>;
export const boardTeamCreateSchema=z.object({
 trainer:z.object({name:battleTrainerNameSchema.optional(),spriteId:battleSpriteSchema.optional()}).strict().default({}),
 slots:z.array(boardSlotSchema).min(1).max(6),
 // Empty: the suggested reward.
 reward:z.number().int().min(0).max(999999).optional(),
 // Players only see the team's average level.
 blind:z.boolean().default(false)
}).strict();
// Many teams at once: each team's first Pokémon is drawn between minLevel and maxLevel, the others within ± spread of it.
export const boardBatchSchema=z.object({
 count:z.number().int().min(1).max(50),
 minLevel:z.number().int().min(1).max(100),maxLevel:z.number().int().min(1).max(100),
 spread:z.number().int().min(0).max(30).default(3),
 minSize:z.number().int().min(1).max(6).default(3),maxSize:z.number().int().min(1).max(6).default(6),
 legendary:z.enum(boardLegendaryModes).default('NO'),
 // Share of the teams fought blind, 0 to 100 %.
 blindPercent:z.number().int().min(0).max(100).default(0)
}).strict().refine(b=>b.minLevel<=b.maxLevel,'Niveau minimum supérieur au maximum').refine(b=>b.minSize<=b.maxSize,'Taille minimum supérieure au maximum');
export type BoardBatchInput=z.infer<typeof boardBatchSchema>;
export type BoardTeamCreateInput=z.infer<typeof boardTeamCreateSchema>;
export const boardRewardSchema=z.object({reward:z.number().int().min(0).max(999999)}).strict();

export const boardTeamStatuses=['OPEN','CHALLENGED','WON','WITHDRAWN'] as const;
export type BoardTeamStatus=typeof boardTeamStatuses[number];
export const boardTeamStatusLabels:Record<BoardTeamStatus,string>={OPEN:'Disponible',CHALLENGED:'Combat en cours',WON:'Remportée',WITHDRAWN:'Retirée'};
export type BoardRewardStatus='NONE'|'PENDING'|'PAID'|'REVIEW';
export type BoardTeam={
 id:string;lobbyId:string;trainer:BattleTrainerSpec;party:BattlePokemonSpec[];slots:BoardSlot[];
 reward:number;suggestedReward:number;legendaries:number;status:BoardTeamStatus;origin:'ADMIN'|'WHEEL';
 // Blind: until it is won, players get no party (empty), only its size-free average level. Moves are never sent to players.
 blind:boolean;averageLevel:number;
 createdBy:string|null;createdAt:string;
 // The player who reserved it (CHALLENGED), then the winner (WON).
 challengerId:string|null;encounterId:string|null;winnerId:string|null;wonAt:string|null;rewardStatus:BoardRewardStatus;
 attempts:number;
};
export type BoardSnapshot={teams:BoardTeam[]};

// Wheel gage BOARD_BATTLE: a new team drawn around the beneficiary's average level.
export const boardGageParamsSchema=z.object({
 count:z.number().int().min(1).max(6).default(3),
 spread:z.number().int().min(0).max(20).default(3),
 legendary:z.enum(boardLegendaryModes).default('NO')
}).strict();
