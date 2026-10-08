import type {GameCapability} from '@pokerace/shared';
import {api} from '../api/client';
import type {PlayerViewModel} from '../native-clients';

// A write is offered only when the player's native client announces the capability; the API checks it again.
export const nativeCan=(view:PlayerViewModel|undefined,capability:GameCapability)=>
 !!view?.native?.ready&&view.native.adapter.status==='ready'&&(view.native.adapter.capabilities as string[]).includes(capability);

export type PartyAction={action:'insert';artifactId:string}|{action:'remove';slot:number}|{action:'replace';slot:number;artifactId:string}|{action:'adopt';slot:number}|{action:'rename';slot:number;nickname:string};
export const partyAction=(lobbyId:string,accountId:string,action:PartyAction)=>
 api<{commandId:string;status:string}>(`/api/lobbies/${lobbyId}/players/${accountId}/pokemon`,{method:'POST',body:{...action,confirmOutOfBattle:true}});

// The battle state cannot be read from the game: the admin confirms it before each party change.
export const confirmOutOfBattle=(player:string,what:string)=>window.confirm(`${what}\n\nConfirme que ${player} n’est pas en combat (l’équipe de combat est une copie que le jeu réécrit).`);
