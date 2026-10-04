import {z} from 'zod';

// Conditions are data, checked by server code. Only progression flags read by the GameAdapter exist today.
export const objectiveConditionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('progression'),objectiveId:z.string().min(1).max(40)}).strict()
]);
export type ObjectiveCondition=z.infer<typeof objectiveConditionSchema>;

export type Objective={id:string;name:string;description:string;order:number;rewardMoney:number;mapPosition:string|null;gameCondition:ObjectiveCondition;enabled:boolean};
export type ObjectiveRewardStatus='NONE'|'PENDING'|'PAID'|'REVIEW';
export type ObjectiveCompletion={objectiveId:string;accountId:string;runId:string|null;completedAt:string;rewardStatus:ObjectiveRewardStatus};
export type ObjectivesSnapshot={objectives:Objective[];completions:ObjectiveCompletion[]};

export const objectiveUpdateSchema=z.object({
 name:z.string().trim().min(1).max(80).optional(),description:z.string().trim().max(300).optional(),
 rewardMoney:z.number().int().min(0).max(999999).optional(),order:z.number().int().min(0).max(10000).optional(),enabled:z.boolean().optional()
}).strict().refine(v=>Object.keys(v).length>0,'Aucune modification');
export const rewardStatusLabels:Record<ObjectiveRewardStatus,string>={NONE:'Sans récompense',PENDING:'Récompense en attente',PAID:'Récompense versée',REVIEW:'Récompense à vérifier'};
