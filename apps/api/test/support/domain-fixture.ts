import {passiveCatalog,type LobbyNotification} from '@pokerace/shared';
import {Store} from '../../src/store.js';
import {PassiveService} from '../../src/passives/passive-service.js';

// Portal domain in one database: accounts Ben, Tim, Admin (lobby creator) and Dehors (not a member).
// Deterministic RNG: replays the given values (modulo n), then 0.
export const sequence=(...values:number[])=>(n:number)=>(values.length?values.shift()!:0)%n;

export function passiveFixture(path=':memory:',implemented:ReadonlySet<string>=new Set(passiveCatalog.map(p=>p.id)),random=sequence()){
 const store=new Store(path);const domain=store.portal!;
 for(const [id,name] of [['ben','Ben'],['tim','Tim'],['adm','Admin'],['out','Dehors']])domain.accounts.save({id,name,sprite:'may',admin:id==='adm'});
 const lobby=domain.lobbies.get('lobby')??domain.lobbies.create({id:'lobby',name:'Course',createdBy:'adm'});
 for(const id of ['ben','tim'])domain.lobbies.addMember(lobby.id,id);
 const notes:{n:LobbyNotification;to?:string}[]=[],changes:string[]=[];
 const passives=new PassiveService({domain,implemented,random,changed:l=>changes.push(l),notify:(_l,n,to)=>notes.push({n,to})});
 return {store,domain,passives,notes,changes,lobbyId:lobby.id};
}
