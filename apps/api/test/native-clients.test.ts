import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Server} from 'socket.io';
import {io as connect, type Socket} from 'socket.io-client';
import {registerNativeClients} from '../src/native-clients.js';

async function fixture(t:test.TestContext,accountsRequired=false){
 const http=createServer();const io=new Server(http,{transports:['websocket']});
 const registry=registerNativeClients(io,{roomCode:'test-room',accountsRequired},name=>name==='Tester'?{id:'account-test',name}:undefined);
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
 const address=http.address();assert.ok(address&&typeof address==='object');
 const sockets:Socket[]=[];
 t.after(async()=>{for(const socket of sockets)socket.disconnect();await new Promise<void>(resolve=>io.close(()=>resolve()));});
 function client(auth:Record<string,unknown>={}){const socket=connect(`http://127.0.0.1:${address.port}/client`,{transports:['websocket'],reconnection:false,autoConnect:false,auth:{protocolVersion:1,roomCode:'test-room',playerId:'p-test',playerName:'Tester',...auth}});sockets.push(socket);return socket;}
 return {registry,client};
}
function event(socket:Socket,name:string){return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out: '+name)),3000);socket.once(name,value=>{clearTimeout(timer);resolve(value)});});}
const hello={type:'HELLO',protocolVersion:1,clientVersion:'0.1.0',playerId:'p-test',platform:'windows-x64',bridge:{type:'bizhawk',connected:true,protocolVersion:1,gameLoaded:true},emulator:{name:'BizHawk'},system:'TEST'};
async function ready(socket:Socket){const status=event(socket,'SERVER_STATUS');socket.connect();assert.equal((await status).protocolVersion,1);const accepted=event(socket,'SERVER_STATUS');socket.emit('HELLO',hello);assert.equal((await accepted).ready,true);}

test('native namespace authenticates, receives status and correlates COMMAND_ACK',async t=>{
 const {registry,client}=await fixture(t);const socket=client();await ready(socket);
 socket.emit('BRIDGE_STATUS',{type:'BRIDGE_STATUS',protocolVersion:1,bridge:hello.bridge,system:'TEST'});
 const command={type:'COMMAND' as const,protocolVersion:1 as const,commandId:randomUUID(),command:'bridge.readMemory' as const,payload:{domain:'RAM',address:0,length:4}};
 socket.once('COMMAND',request=>socket.emit('COMMAND_ACK',{type:'COMMAND_ACK',protocolVersion:1,commandId:request.commandId,ok:true,result:{data:'11223344'}}));
 const result=await registry.sendCommand('p-test',command);
 assert.equal(result.ok,true);assert.deepEqual(result.result,{data:'11223344'});
 assert.equal(registry.snapshot()[0].bridge?.system,'TEST');
 assert.equal(JSON.stringify(registry.snapshot()).includes('test-room'),false);
});
test('native namespace rejects wrong room and unsupported protocol',async t=>{
 const {client}=await fixture(t);
 for(const auth of [{roomCode:'wrong'},{protocolVersion:2}]){const socket=client(auth);const rejected=event(socket,'connect_error');socket.connect();await rejected;assert.equal(socket.connected,false);}
});
test('native namespace respects existing account requirement',async t=>{
 const {client,registry}=await fixture(t,true);const wrong=client({playerName:'Missing'});const error=event(wrong,'connect_error');wrong.connect();await error;
 const socket=client();await ready(socket);assert.equal(registry.snapshot()[0].accountId,'account-test');
});
test('native HELLO cannot impersonate another player',async t=>{
 const {client,registry}=await fixture(t);const socket=client();const connected=event(socket,'connect');socket.connect();await connected;
 const disconnected=event(socket,'disconnect');socket.emit('HELLO',{...hello,playerId:'someone-else'});await disconnected;assert.equal(registry.snapshot().length,0);
});
test('disconnect rejects pending command without claiming it was not executed',async t=>{
 const {client,registry}=await fixture(t);const socket=client();await ready(socket);
 socket.once('COMMAND',()=>socket.disconnect());
 await assert.rejects(registry.sendCommand('p-test',{type:'COMMAND',protocolVersion:1,commandId:randomUUID(),command:'bridge.writeMemory',payload:{domain:'RAM',address:0,data:'ab'}}),/outcome may be unknown/);
});
test('native commands never enter legacy agent namespace',async t=>{
 const {client,registry}=await fixture(t);const socket=client();await ready(socket);
 assert.throws(()=>registry.sendCommand('p-test',{type:'COMMAND',protocolVersion:1,commandId:randomUUID(),command:'injectPokemon' as any,payload:{}}));
});
