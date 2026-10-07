import {z} from 'zod';
import {battleSpriteSchema,battleTrainerNameSchema,type BattlePokemonSpec,type BattleTrainerSpec} from './battles.js';

/**
 * Tableau des combats: teams prepared by an admin (or drawn by a wheel), visible to every player. The first player
 * who accepts reserves the team and fights it in their game; a win pays the reward, a loss is a normal defeat
 * (end of Run) and puts the team back on the board.
 */
export const legendarySpecies:readonly number[]=[144,145,146,150,151,243,244,245,249,250,251,377,378,379,380,381,382,383,384,385,386];
export const isLegendary=(speciesId:number)=>legendarySpecies.includes(speciesId);

// Suggested reward: 40 ₽ per level, +10 % per Pokémon beyond the first, +2 000 ₽ per legendary, rounded to 100 ₽.
export const boardRewardRules={perLevel:40,perExtraPokemon:0.1,perLegendary:2000,round:100} as const;
export function boardReward(party:readonly Pick<BattlePokemonSpec,'speciesId'|'level'>[]){
 const r=boardRewardRules;
 const levels=party.reduce((sum,p)=>sum+p.level*r.perLevel,0);
 const total=levels*(1+r.perExtraPokemon*Math.max(0,party.length-1))+party.filter(p=>isLegendary(p.speciesId)).length*r.perLegendary;
 return Math.min(999999,Math.round(total/r.round)*r.round);
}

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
 reward:z.number().int().min(0).max(999999).optional()
}).strict();
export type BoardTeamCreateInput=z.infer<typeof boardTeamCreateSchema>;
export const boardRewardSchema=z.object({reward:z.number().int().min(0).max(999999)}).strict();

export const boardTeamStatuses=['OPEN','CHALLENGED','WON','WITHDRAWN'] as const;
export type BoardTeamStatus=typeof boardTeamStatuses[number];
export const boardTeamStatusLabels:Record<BoardTeamStatus,string>={OPEN:'Disponible',CHALLENGED:'Combat en cours',WON:'Remportée',WITHDRAWN:'Retirée'};
export type BoardRewardStatus='NONE'|'PENDING'|'PAID'|'REVIEW';
export type BoardTeam={
 id:string;lobbyId:string;trainer:BattleTrainerSpec;party:BattlePokemonSpec[];slots:BoardSlot[];
 reward:number;suggestedReward:number;legendaries:number;status:BoardTeamStatus;origin:'ADMIN'|'WHEEL';
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
