import Database from "better-sqlite3";
import type { PlayerState } from "@pokerace/shared";
export type StoredPlayer={playerId:string;receivedAt:string;lastSeenAt:string;state:PlayerState};
export class Store {
  private db:Database.Database;
  constructor(path:string){this.db=new Database(path);this.db.pragma("journal_mode = WAL");this.db.pragma("foreign_keys = ON");this.migrate();}
  private migrate(){this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS player_states(player_id TEXT PRIMARY KEY,state_json TEXT NOT NULL,received_at TEXT NOT NULL,last_seen_at TEXT NOT NULL); INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,datetime('now'));`)}
  save(state:PlayerState,receivedAt:string){this.db.prepare(`INSERT INTO player_states(player_id,state_json,received_at,last_seen_at) VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,received_at=excluded.received_at,last_seen_at=excluded.last_seen_at`).run(state.playerId,JSON.stringify(state),receivedAt,receivedAt)}
  heartbeat(playerId:string,receivedAt:string){this.db.prepare("UPDATE player_states SET last_seen_at=? WHERE player_id=?").run(receivedAt,playerId)}
  all():StoredPlayer[]{return this.db.prepare("SELECT player_id,state_json,received_at,last_seen_at FROM player_states ORDER BY player_id").all().map((r:any)=>({playerId:r.player_id,state:JSON.parse(r.state_json),receivedAt:r.received_at,lastSeenAt:r.last_seen_at}))}
  close(){this.db.close()}
}
