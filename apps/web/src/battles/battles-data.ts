import type {BattleEncounter,BattleStatus,BattlesSnapshot} from '@pokerace/shared';
import {useLiveTopic} from '../realtime/live-context';

export const useBattles=()=>useLiveTopic<BattlesSnapshot>('battles',{encounters:[]});
// Queued, being sent, in progress or uncertain: shown on the player's card.
export const ACTIVE:BattleStatus[]=['WAITING_SAFE_STATE','SENDING','STARTING','RUNNING','REVIEW'];
export const activeBattle=(snapshot:BattlesSnapshot,accountId:string)=>snapshot.encounters.find(e=>e.accountId===accountId&&ACTIVE.includes(e.status));
export const battlesOf=(snapshot:BattlesSnapshot,accountId:string)=>snapshot.encounters.filter(e=>e.accountId===accountId);
export const statusClass=(e:BattleEncounter)=>e.status==='WON'?'status-confirmed':e.status==='LOST'||e.status==='FAILED'?'status-failed':e.status==='REVIEW'?'status-review':'status-pending';
