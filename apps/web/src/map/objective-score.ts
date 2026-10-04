import type {Objective,PublicPlayer} from '@pokerace/shared';
import {progress} from '../progression';

/**
 * Race score shared by the Course and Map pages. With lobby objectives: number of enabled objectives reached,
 * then the furthest one in the lobby order. Without them, the former Emerald progression order is used.
 */
export function raceScore(player:PublicPlayer,objectives:Objective[]){
 const base=progress(player);
 if(!objectives.length)return {known:base.known,score:base.score,reached:[] as Objective[]};
 const enabled=objectives.filter(o=>o.enabled).sort((a,b)=>a.order-b.order);
 const reached=base.known?enabled.filter(o=>base.completed.has(o.gameCondition.objectiveId)):[];
 const furthest=reached.length?enabled.indexOf(reached[reached.length-1])+1:0;
 return {known:base.known,score:reached.length*1000+furthest,reached};
}

// Equal scores share the rank (1, 1, 3…); unknown progressions are not ranked.
export function rankBy<T>(rows:T[],score:(row:T)=>number|null):(number|null)[]{
 const scores=rows.map(score);
 return scores.map(s=>s===null?null:scores.filter(o=>o!==null&&o>s).length+1);
}
