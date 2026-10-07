import {z} from 'zod';

export const runStatusSchema=z.enum(['NOT_STARTED','RUNNING','LOST','COMPLETED','ABORTED']);
export type RunStatus=z.infer<typeof runStatusSchema>;

// Terminal statuses have no outgoing transition: a finished attempt stays in the history.
export const runTransitions:Record<RunStatus,readonly RunStatus[]>={
 NOT_STARTED:['RUNNING','ABORTED'],
 RUNNING:['LOST','COMPLETED','ABORTED'],
 LOST:[],COMPLETED:[],ABORTED:[]
};

export type Run={id:string;lobbyId:string;accountId:string;number:number;status:RunStatus;startedAt:string|null;endedAt:string|null;createdAt:string;updatedAt:string};

export const runCreateSchema=z.object({accountId:z.string().min(1).max(64),start:z.boolean().default(false)}).strict();
export const runStatusChangeSchema=z.object({status:runStatusSchema}).strict();
// Labels shared by every screen so a status is always worded the same way.
export const runStatusLabels:Record<RunStatus,string>={NOT_STARTED:'Pas commencée',RUNNING:'En cours',LOST:'Perdue',COMPLETED:'Terminée',ABORTED:'Abandonnée'};

// In-game end of Run journal of one player (defeats, fallen Pokémon, game resets), readable by the lobby members.
export type RunJournalEntry={id:string;action:'run.lost'|'pokemon.boxed'|'run.reset'|'run.reset_failed';message:string;runId:string|null;at:string};
