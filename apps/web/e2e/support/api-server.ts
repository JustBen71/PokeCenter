// Test-only API for the browser E2E: real portal (SQLite, REST, Socket.IO) on a throwaway database.
// Auction lots are built offline so CI never calls PokeAPI.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {BuiltPokemon} from '@pokerace/shared';
import {Store} from '../../../api/src/store.ts';
import {createPortal} from '../../../api/src/rooms.ts';
import {generateLot} from '../../../api/src/auction-generator.ts';

const port=Number(process.env.PORT);
if(!Number.isInteger(port)||port<1)throw new Error('PORT is required');
const directory=mkdtempSync(join(tmpdir(),'pokerace-web-e2e-'));
const store=new Store(join(directory,'e2e.sqlite'));
const build=async():Promise<BuiltPokemon>=>({name:'Bulbizarre',stats:{maxHp:20,attack:10,defense:10,speed:10,spAttack:10,spDefense:10},
 moves:[{id:33,pp:35},{id:0,pp:0},{id:0,pp:0},{id:0,pp:0}],experience:100,choices:[]});
const {server,running}=createPortal(store,{corsOrigin:process.env.CORS_ORIGIN??'http://127.0.0.1',offlineAfterMs:15000,adminToken:'',commandTimeoutMs:3000,resetDelayMs:500,battleMoves:async()=>[33,45],
 auctionGenerator:players=>generateLot(players,()=>0,build)});
server.listen(port,'127.0.0.1',()=>console.log(`E2E API listening on ${port}`));
let stopping=false;
const stop=()=>{
 if(stopping)return;stopping=true;
 for(const course of running.values())course.io.disconnectSockets(true);
 server.close(()=>{store.close();rmSync(directory,{recursive:true,force:true});process.exit(0);});
 setTimeout(()=>process.exit(0),3000).unref();
};
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,stop);
