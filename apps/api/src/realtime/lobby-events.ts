import type {Namespace} from 'socket.io';

type Snapshot=(lobbyId:string,accountId:string)=>unknown;

/**
 * Pushes portal state (runs, members, balances…) on each lobby's /dashboard namespace.
 * A topic registers a snapshot function once; it is sent on connection and re-sent by `refresh`.
 * Snapshots receive the viewer's account so per-player data can be filtered.
 */
export class LobbyEvents{
 private readonly namespaces=new Map<string,Namespace>();
 private readonly topics=new Map<string,Snapshot>();

 attach(lobbyId:string,dashboard:Namespace){
  this.namespaces.set(lobbyId,dashboard);
  dashboard.on('connection',socket=>{
   const accountId=String(socket.handshake.auth?.accountId??'');
   socket.join(`account:${accountId}`);
   for(const [topic,snapshot] of this.topics)socket.emit(topic,snapshot(lobbyId,accountId));
   // A page mounted after the connection asks again for the topic it displays.
   socket.on('topic:get',(topic:unknown)=>{const snapshot=typeof topic==='string'?this.topics.get(topic):undefined;if(snapshot)socket.emit(topic as string,snapshot(lobbyId,accountId));});
  });
 }
 provide(topic:string,snapshot:Snapshot){this.topics.set(topic,snapshot);}

 // Re-sends a topic to every viewer of the lobby (each one gets its own snapshot).
 async refresh(lobbyId:string,topic:string){
  const dashboard=this.namespaces.get(lobbyId),snapshot=this.topics.get(topic);
  if(!dashboard||!snapshot)return;
  for(const socket of await dashboard.fetchSockets())socket.emit(topic,snapshot(lobbyId,String(socket.handshake.auth?.accountId??'')));
 }
 emit(lobbyId:string,event:string,payload:unknown){this.namespaces.get(lobbyId)?.emit(event,payload);}
 emitTo(lobbyId:string,accountId:string,event:string,payload:unknown){this.namespaces.get(lobbyId)?.to(`account:${accountId}`).emit(event,payload);}
}
