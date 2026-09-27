import {progressionData,type PublicPlayer} from '@pokerace/shared';
export const objectives=progressionData.objectives;
export function progress(player:PublicPlayer) {
 const known=player.state.game.romStatus==='recognized'&&player.state.progression?.version===1;
 const completed=new Set(known?player.state.progression!.completed:[]);
 const count=(kind:string)=>objectives.filter(o=>o.kind===kind&&completed.has(o.id)).length;
 const badges=count('badge'),league=count('league'),story=count('story'),champion=count('champion');
 // Lexicographic order: champion > current League run > badges > story objectives.
 return {known,completed,badges,league,story,champion,score:champion*100000+league*10000+badges*100+story};
}
export function ranking(players:PublicPlayer[]) {
 const sorted=players.map(player=>({player,...progress(player)})).sort((a,b)=>Number(b.known)-Number(a.known)||b.score-a.score||a.player.playerId.localeCompare(b.player.playerId));
 return sorted.map((row,i)=>({...row,rank:row.known?sorted.findIndex(other=>other.known&&other.score===row.score)+1:null}));
}
export function areaFor(player:PublicPlayer) {
 const location=player.state.location;if(!location)return undefined;
 const id=(progressionData.locations as Record<string,string>)[`${location.mapGroup}:${location.mapNumber}`];
 return progressionData.sections.find(s=>s.id===id);
}
