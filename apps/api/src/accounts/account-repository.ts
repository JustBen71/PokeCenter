import type Database from 'better-sqlite3';
import {accountKey,type Account} from '@pokerace/shared';
import {nowIso} from '../db/database.js';

type Row={id:string;name:string;avatar:string;is_admin:number;created_at:string;updated_at:string};
const toAccount=(r:Row):Account=>({id:r.id,name:r.name,sprite:r.avatar,admin:r.is_admin===1,createdAt:r.created_at,updatedAt:r.updated_at});

export class AccountRepository{
 constructor(private readonly db:Database.Database){}
 list():Account[]{return (this.db.prepare('SELECT * FROM accounts ORDER BY rowid').all() as Row[]).map(toAccount);}
 get(id:string):Account|undefined{const row=this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as Row|undefined;return row&&toAccount(row);}
 findByName(name:string):Account|undefined{const row=this.db.prepare('SELECT * FROM accounts WHERE name_key=?').get(accountKey(name)) as Row|undefined;return row&&toAccount(row);}
 // Upsert keeps the creation date; the name key is the uniqueness rule used by clients to find their account.
 save(account:Account,key=accountKey(account.name)):Account{
  const now=nowIso();
  this.db.prepare(`INSERT INTO accounts(id,name,name_key,avatar,is_admin,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_key=excluded.name_key,avatar=excluded.avatar,is_admin=excluded.is_admin,updated_at=excluded.updated_at`)
   .run(account.id,account.name,key,account.sprite,account.admin?1:0,now,now);
  return this.get(account.id)!;
 }
}
