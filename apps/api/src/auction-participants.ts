import {nativeDisplayState,type PublicNativeClient,type PublicPlayer} from '@pokerace/shared';

// Reading an active team is sufficient to generate a lot. Buying still uses /agent.
export function auctionParticipants(legacy:PublicPlayer[],native:PublicNativeClient[]):PublicPlayer[]{
 const players=new Map(legacy.map(p=>[p.account?.id??p.playerId,p]));
 for(const client of native){
  const game=client.gameState;
  if(!client.ready||!client.bridge.connected||!client.bridge.gameLoaded||client.adapter.status!=='ready'||!game||Date.now()-Date.parse(client.lastSeenAt)>15000)continue;
  if(players.get(client.accountId)?.connected && players.get(client.accountId)?.state.capabilities?.includes("auction-purchase-v1"))continue;
  players.set(client.accountId,{
   playerId:client.accountId,account:players.get(client.accountId)?.account,connected:true,
   lastSeenAt:client.lastSeenAt,receivedAt:game.observedAt,
   state:{protocolVersion:1,playerId:client.accountId,playerName:client.playerName,
    ...nativeDisplayState(game),
    capabilities:client.canPurchase?["auction-purchase-v1"]:[],observedAt:game.observedAt,diagnostic:null}
  });
 }
 return [...players.values()];
}
