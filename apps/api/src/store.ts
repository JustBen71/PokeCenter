import Database from "better-sqlite3";

import type { PlayerState, LibraryEntry,Gag,RouletteRun,Auction,Account,RouletteEffect } from "@pokerace/shared";

export type StoredPlayer={playerId:string;receivedAt:string;lastSeenAt:string;state:PlayerState};

export class Store {

  private db:Database.Database;

  constructor(path:string){this.db=new Database(path);this.db.pragma("journal_mode = WAL");this.db.pragma("foreign_keys = ON");this.migrate();this.db.exec('CREATE TABLE IF NOT EXISTS pokemon_library(id TEXT PRIMARY KEY, data_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS roulette_gags(id TEXT PRIMARY KEY,data_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS roulette_runs(id TEXT PRIMARY KEY,data_json TEXT NOT NULL)');}

  accounts():Account[]{this.db.exec('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name_key TEXT UNIQUE NOT NULL,data_json TEXT NOT NULL)');return this.db.prepare('SELECT data_json FROM accounts ORDER BY rowid').all().map((r:any)=>JSON.parse(r.data_json));}

  putAccount(a:Account,key:string){this.db.prepare('INSERT INTO accounts(id,name_key,data_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name_key=excluded.name_key,data_json=excluded.data_json').run(a.id,key,JSON.stringify(a));}

  seedGags(gags:Gag[]){this.db.exec('CREATE TABLE IF NOT EXISTS catalogue_imports(id TEXT PRIMARY KEY)');const importOnce=this.db.transaction(()=>{if(this.db.prepare('SELECT id FROM catalogue_imports WHERE id=?').get('chaos-v1'))return;for(const gag of gags)if(!this.gags().some(g=>g.id===gag.id))this.putGag(gag);this.db.prepare('INSERT INTO catalogue_imports(id) VALUES(?)').run('chaos-v1');});importOnce();}
  effects():RouletteEffect[]{this.db.exec('CREATE TABLE IF NOT EXISTS roulette_effects(id TEXT PRIMARY KEY,data_json TEXT NOT NULL)');return this.db.prepare('SELECT data_json FROM roulette_effects ORDER BY rowid DESC').all().map((r:any)=>JSON.parse(r.data_json));}
  putEffect(effect:RouletteEffect){this.effects();this.db.prepare('INSERT INTO roulette_effects(id,data_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(effect.id,JSON.stringify(effect));}
  childRuns(id:string):RouletteRun[]{return this.db.prepare("SELECT data_json FROM roulette_runs WHERE json_extract(data_json,'$.parentId')=?").all(id).map((r:any)=>JSON.parse(r.data_json));}
  pendingRuns():RouletteRun[]{return this.db.prepare("SELECT data_json FROM roulette_runs WHERE json_extract(data_json,'$.status') IN ('queued','drawn') ORDER BY rowid").all().map((r:any)=>JSON.parse(r.data_json));}
  gags():Gag[]{return this.db.prepare('SELECT data_json FROM roulette_gags ORDER BY rowid').all().map((r:any)=>JSON.parse(r.data_json));}

  auctions():Auction[]{this.db.exec('CREATE TABLE IF NOT EXISTS auctions(id TEXT PRIMARY KEY,data_json TEXT NOT NULL)');return this.db.prepare('SELECT data_json FROM auctions ORDER BY rowid DESC').all().map((r:any)=>JSON.parse(r.data_json));}

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

  private migrate(){this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS player_states(player_id TEXT PRIMARY KEY,state_json TEXT NOT NULL,received_at TEXT NOT NULL,last_seen_at TEXT NOT NULL); INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,datetime('now'));`)}

  save(state:PlayerState,receivedAt:string){this.db.prepare(`INSERT INTO player_states(player_id,state_json,received_at,last_seen_at) VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,received_at=excluded.received_at,last_seen_at=excluded.last_seen_at`).run(state.playerId,JSON.stringify(state),receivedAt,receivedAt)}

  heartbeat(playerId:string,receivedAt:string){this.db.prepare("UPDATE player_states SET last_seen_at=? WHERE player_id=?").run(receivedAt,playerId)}

  all():StoredPlayer[]{return this.db.prepare("SELECT player_id,state_json,received_at,last_seen_at FROM player_states ORDER BY player_id").all().map((r:any)=>({playerId:r.player_id,state:JSON.parse(r.state_json),receivedAt:r.received_at,lastSeenAt:r.last_seen_at}))}

  close(){this.db.close()}

}

