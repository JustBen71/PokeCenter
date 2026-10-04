import type Database from 'better-sqlite3';
import {randomBytes,randomUUID} from 'node:crypto';
import {defaultLobbySettings,lobbySettingsSchema,type Lobby,type LobbyMember,type LobbySettings,type LobbyStatus} from '@pokerace/shared';
import {nowIso} from '../db/database.js';
import {DomainError} from '../errors.js';

type LobbyRow={id:string;name:string;invite_code:string;created_by:string|null;status:LobbyStatus;created_at:string;updated_at:string};
type SettingsRow={bank_deposit_tax_percent:number;shop_jackpot_percent:number;auction_jackpot_percent:number;wheel_jackpot_percent:number;protection_price:number};
const toLobby=(r:LobbyRow):Lobby=>({id:r.id,name:r.name,inviteCode:r.invite_code,createdBy:r.created_by,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at});

export class LobbyRepository{
 constructor(private readonly db:Database.Database){}
 list():Lobby[]{return (this.db.prepare('SELECT * FROM lobbies ORDER BY rowid').all() as LobbyRow[]).map(toLobby);}
 get(id:string):Lobby|undefined{const row=this.db.prepare('SELECT * FROM lobbies WHERE id=?').get(id) as LobbyRow|undefined;return row&&toLobby(row);}
 getByInviteCode(code:string):Lobby|undefined{const row=this.db.prepare('SELECT * FROM lobbies WHERE invite_code=?').get(code) as LobbyRow|undefined;return row&&toLobby(row);}
 // Used when a person types the code; the Socket.IO handshake keeps the exact comparison.
 findByTypedCode(code:string):Lobby|undefined{const row=this.db.prepare('SELECT * FROM lobbies WHERE invite_code=? COLLATE NOCASE ORDER BY invite_code=? DESC LIMIT 1').get(code,code) as LobbyRow|undefined;return row&&toLobby(row);}
 rename(id:string,name:string){this.require(id);this.db.prepare('UPDATE lobbies SET name=?,updated_at=? WHERE id=?').run(name,nowIso(),id);return this.get(id)!;}
 require(id:string):Lobby{const lobby=this.get(id);if(!lobby)throw new DomainError('LOBBY_NOT_FOUND','Lobby introuvable');return lobby;}

 newInviteCode():string{let code:string;do{code=randomBytes(4).toString('hex').toUpperCase();}while(this.getByInviteCode(code));return code;}

 // The lobby, its default settings and the creator's membership are created together or not at all.
 create(input:{name:string;createdBy:string|null;id?:string;inviteCode?:string;createdAt?:string;status?:LobbyStatus}):Lobby{
  const id=input.id??randomUUID(),at=input.createdAt??nowIso();
  this.db.transaction(()=>{
   this.db.prepare('INSERT INTO lobbies(id,name,invite_code,created_by,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(id,input.name,input.inviteCode??this.newInviteCode(),input.createdBy,input.status??'OPEN',at,at);
   this.db.prepare('INSERT INTO lobby_settings(lobby_id,updated_at) VALUES(?,?)').run(id,at);
   if(input.createdBy)this.addMember(id,input.createdBy,at);
  })();
  return this.get(id)!;
 }

 setStatus(id:string,status:LobbyStatus){this.require(id);this.db.prepare('UPDATE lobbies SET status=?,updated_at=? WHERE id=?').run(status,nowIso(),id);return this.get(id)!;}

 members(lobbyId:string):LobbyMember[]{
  return (this.db.prepare('SELECT lobby_id,account_id,joined_at FROM lobby_members WHERE lobby_id=? ORDER BY joined_at,rowid').all(lobbyId) as {lobby_id:string;account_id:string;joined_at:string}[])
   .map(r=>({lobbyId:r.lobby_id,accountId:r.account_id,joinedAt:r.joined_at}));
 }
 isMember(lobbyId:string,accountId:string){return !!this.db.prepare('SELECT 1 FROM lobby_members WHERE lobby_id=? AND account_id=?').get(lobbyId,accountId);}
 // Joining twice is a no-op so the first join date is kept.
 addMember(lobbyId:string,accountId:string,at=nowIso()){
  this.db.prepare('INSERT OR IGNORE INTO lobby_members(lobby_id,account_id,joined_at) VALUES(?,?,?)').run(lobbyId,accountId,at);
 }

 settings(lobbyId:string):LobbySettings{
  const row=this.db.prepare('SELECT * FROM lobby_settings WHERE lobby_id=?').get(lobbyId) as SettingsRow|undefined;
  if(!row)return {...defaultLobbySettings};
  return {bankDepositTaxPercent:row.bank_deposit_tax_percent,shopJackpotPercent:row.shop_jackpot_percent,auctionJackpotPercent:row.auction_jackpot_percent,wheelJackpotPercent:row.wheel_jackpot_percent,protectionPrice:row.protection_price};
 }
 updateSettings(lobbyId:string,patch:Partial<LobbySettings>):LobbySettings{
  this.require(lobbyId);
  const parsed=lobbySettingsSchema.safeParse({...this.settings(lobbyId),...patch});
  if(!parsed.success)throw new DomainError('VALIDATION_FAILED','Paramètres du lobby invalides');
  const s=parsed.data;
  this.db.prepare(`INSERT INTO lobby_settings(lobby_id,bank_deposit_tax_percent,shop_jackpot_percent,auction_jackpot_percent,wheel_jackpot_percent,protection_price,updated_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(lobby_id) DO UPDATE SET bank_deposit_tax_percent=excluded.bank_deposit_tax_percent,shop_jackpot_percent=excluded.shop_jackpot_percent,
   auction_jackpot_percent=excluded.auction_jackpot_percent,wheel_jackpot_percent=excluded.wheel_jackpot_percent,protection_price=excluded.protection_price,updated_at=excluded.updated_at`)
   .run(lobbyId,s.bankDepositTaxPercent,s.shopJackpotPercent,s.auctionJackpotPercent,s.wheelJackpotPercent,s.protectionPrice,nowIso());
  return s;
 }
}
