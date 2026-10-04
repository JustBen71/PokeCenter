import type Database from "better-sqlite3";
import type { PlayerState, LibraryEntry,Gag,RouletteRun,Auction,Account,RouletteEffect } from "@pokerace/shared";
import {openDatabase,type DatabaseScope} from "./db/database.js";
import {AccountRepository} from "./accounts/account-repository.js";
import {LobbyRepository} from "./lobbies/lobby-repository.js";
import {RunService} from "./runs/run-service.js";
import {LedgerService} from "./money/ledger-service.js";
import {AuditService} from "./audit/audit-service.js";

export type StoredPlayer={playerId:string;receivedAt:string;lastSeenAt:string;state:PlayerState};
export type PortalDomain={db:Database.Database;accounts:AccountRepository;lobbies:LobbyRepository;runs:RunService;ledger:LedgerService;audit:AuditService};

// Schema changes go through db/migrations.ts; tables are no longer created on first use.
export class Store {
  readonly db:Database.Database;
  // Present only on the main database: relational accounts, lobbies, runs, money and audit.
  readonly portal?:PortalDomain;

  constructor(readonly path:string,readonly scope:DatabaseScope="portal"){
    this.db=openDatabase(path,scope);
    if(scope==="portal"){const lobbies=new LobbyRepository(this.db);this.portal={db:this.db,accounts:new AccountRepository(this.db),lobbies,runs:new RunService(this.db),ledger:new LedgerService(this.db),audit:new AuditService(this.db)};}
  }

  // Course databases have no accounts: the portal injects the lobby members (see rooms.ts).
  accounts():Account[]{return this.portal?.accounts.list()??[];}
  putAccount(a:Account,key:string){this.portal?.accounts.save(a,key);}

  seedGags(gags:Gag[]){const importOnce=this.db.transaction(()=>{if(this.db.prepare('SELECT id FROM catalogue_imports WHERE id=?').get('chaos-v1'))return;for(const gag of gags)if(!this.gags().some(g=>g.id===gag.id))this.putGag(gag);this.db.prepare('INSERT INTO catalogue_imports(id) VALUES(?)').run('chaos-v1');});importOnce();}
  effects():RouletteEffect[]{return this.db.prepare('SELECT data_json FROM roulette_effects ORDER BY rowid DESC').all().map((r:any)=>JSON.parse(r.data_json));}
  putEffect(effect:RouletteEffect){this.db.prepare('INSERT INTO roulette_effects(id,data_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(effect.id,JSON.stringify(effect));}
  childRuns(id:string):RouletteRun[]{return this.db.prepare("SELECT data_json FROM roulette_runs WHERE json_extract(data_json,'$.parentId')=?").all(id).map((r:any)=>JSON.parse(r.data_json));}
  pendingRuns():RouletteRun[]{return this.db.prepare("SELECT data_json FROM roulette_runs WHERE json_extract(data_json,'$.status') IN ('queued','drawn') ORDER BY rowid").all().map((r:any)=>JSON.parse(r.data_json));}
  gags():Gag[]{return this.db.prepare('SELECT data_json FROM roulette_gags ORDER BY rowid').all().map((r:any)=>JSON.parse(r.data_json));}

  auctions():Auction[]{return this.db.prepare('SELECT data_json FROM auctions ORDER BY rowid DESC').all().map((r:any)=>JSON.parse(r.data_json));}
  putAuction(a:Auction){this.db.prepare('INSERT INTO auctions(id,data_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(a.id,JSON.stringify(a));}

  putGag(g:Gag){this.db.prepare('INSERT INTO roulette_gags(id,data_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(g.id,JSON.stringify(g));}
  deleteGag(id:string){return this.db.prepare('DELETE FROM roulette_gags WHERE id=?').run(id).changes>0;}

  runs():RouletteRun[]{return this.db.prepare('SELECT data_json FROM roulette_runs ORDER BY rowid DESC LIMIT 100').all().map((r:any)=>JSON.parse(r.data_json));}
  unresolvedRuns():RouletteRun[]{return this.db.prepare("SELECT data_json FROM roulette_runs WHERE json_extract(data_json,'$.status') IN ('preparing','executing','review')").all().map((r:any)=>JSON.parse(r.data_json));}
  run(id:string):RouletteRun|undefined{const row=this.db.prepare('SELECT data_json FROM roulette_runs WHERE id=?').get(id) as {data_json:string}|undefined;return row?JSON.parse(row.data_json):undefined;}
  putRun(run:RouletteRun){this.db.prepare('INSERT INTO roulette_runs(id,data_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(run.id,JSON.stringify(run));}

  library():LibraryEntry[]{return this.db.prepare('SELECT data_json FROM pokemon_library ORDER BY rowid DESC').all().map((r:any)=>JSON.parse(r.data_json));}
  saveLibrary(entry:LibraryEntry){this.db.prepare('INSERT INTO pokemon_library(id,data_json) VALUES(?,?)').run(entry.id,JSON.stringify(entry));}
  deleteLibrary(id:string){return this.db.prepare('DELETE FROM pokemon_library WHERE id=?').run(id).changes>0;}

  save(state:PlayerState,receivedAt:string){this.db.prepare(`INSERT INTO player_states(player_id,state_json,received_at,last_seen_at) VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,received_at=excluded.received_at,last_seen_at=excluded.last_seen_at`).run(state.playerId,JSON.stringify(state),receivedAt,receivedAt)}
  heartbeat(playerId:string,receivedAt:string){this.db.prepare("UPDATE player_states SET last_seen_at=? WHERE player_id=?").run(receivedAt,playerId)}
  all():StoredPlayer[]{return this.db.prepare("SELECT player_id,state_json,received_at,last_seen_at FROM player_states ORDER BY player_id").all().map((r:any)=>({playerId:r.player_id,state:JSON.parse(r.state_json),receivedAt:r.received_at,lastSeenAt:r.last_seen_at}))}

  close(){this.db.close()}
}
