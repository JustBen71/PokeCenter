import Database from 'better-sqlite3';
import {migrate,type DatabaseScope} from './migrations.js';

export type {DatabaseScope} from './migrations.js';
export const nowIso=()=>new Date().toISOString();

export function openDatabase(path:string,scope:DatabaseScope){
 const db=new Database(path);
 db.pragma('journal_mode = WAL');
 db.pragma('foreign_keys = ON');
 // Two connections may share the legacy file (portal + legacy course); wait instead of failing on a write lock.
 db.pragma('busy_timeout = 5000');
 migrate(db,scope);
 return db;
}
