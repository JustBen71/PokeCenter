import type Database from 'better-sqlite3';

// "portal" is the main database (accounts, lobbies, runs, money, audit) and also hosts the legacy course data.
// "course" databases keep one lobby's feature data (teams, library, auctions, roulette) until those features move.
export type DatabaseScope='portal'|'course';
export type Migration={version:number;name:string;scopes:readonly DatabaseScope[];up:(db:Database.Database)=>void};

const tableExists=(db:Database.Database,name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const columns=(db:Database.Database,table:string)=>(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name);

export const migrations:readonly Migration[]=[
 {version:1,name:'legacy-baseline',scopes:['portal','course'],up:db=>db.exec(`
  CREATE TABLE IF NOT EXISTS player_states(player_id TEXT PRIMARY KEY,state_json TEXT NOT NULL,received_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);
 `)},
 // Feature tables previously created on first use. They remain document tables until their sprint rebuilds them.
 {version:2,name:'course-feature-tables',scopes:['portal','course'],up:db=>db.exec(`
  CREATE TABLE IF NOT EXISTS pokemon_library(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS roulette_gags(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS roulette_runs(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS roulette_effects(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS catalogue_imports(id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS auctions(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
 `)},
 {version:3,name:'accounts',scopes:['portal'],up:db=>{
  const legacy=tableExists(db,'accounts')&&columns(db,'accounts').includes('data_json');
  if(legacy)db.exec('ALTER TABLE accounts RENAME TO accounts_v1');
  db.exec(`CREATE TABLE IF NOT EXISTS accounts(
   id TEXT PRIMARY KEY,
   name TEXT NOT NULL,
   name_key TEXT NOT NULL UNIQUE,
   avatar TEXT NOT NULL,
   is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)),
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL
  )`);
  if(legacy){
   db.exec(`INSERT INTO accounts(id,name,name_key,avatar,is_admin,created_at,updated_at)
    SELECT id,json_extract(data_json,'$.name'),name_key,COALESCE(json_extract(data_json,'$.sprite'),'brendan'),
     CASE WHEN json_extract(data_json,'$.admin') THEN 1 ELSE 0 END,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM accounts_v1 ORDER BY rowid;
    DROP TABLE accounts_v1;`);
  }
 }},
 {version:4,name:'lobbies',scopes:['portal'],up:db=>{
  db.exec(`
   CREATE TABLE lobbies(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RUNNING','FINISHED','ARCHIVED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
   );
   CREATE TABLE lobby_members(
    lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    PRIMARY KEY(lobby_id,account_id)
   );
   CREATE INDEX lobby_members_account ON lobby_members(account_id);
   CREATE TABLE lobby_settings(
    lobby_id TEXT PRIMARY KEY REFERENCES lobbies(id) ON DELETE CASCADE,
    bank_deposit_tax_percent INTEGER NOT NULL DEFAULT 10 CHECK(bank_deposit_tax_percent BETWEEN 0 AND 100),
    shop_jackpot_percent INTEGER NOT NULL DEFAULT 0 CHECK(shop_jackpot_percent BETWEEN 0 AND 100),
    auction_jackpot_percent INTEGER NOT NULL DEFAULT 0 CHECK(auction_jackpot_percent BETWEEN 0 AND 100),
    wheel_jackpot_percent INTEGER NOT NULL DEFAULT 0 CHECK(wheel_jackpot_percent BETWEEN 0 AND 100),
    updated_at TEXT NOT NULL
   );
  `);
  if(!tableExists(db,'rooms'))return;
  // Former rooms keep their id, so their course database file and Socket.IO path stay the same.
  db.exec(`
   INSERT INTO lobbies(id,name,invite_code,created_by,status,created_at,updated_at)
    SELECT id,json_extract(data_json,'$.name'),json_extract(data_json,'$.code'),
     (SELECT a.id FROM accounts a WHERE a.id=json_extract(rooms.data_json,'$.ownerId')),'OPEN',
     json_extract(data_json,'$.createdAt'),json_extract(data_json,'$.createdAt')
    FROM rooms ORDER BY rowid;
   INSERT OR IGNORE INTO lobby_members(lobby_id,account_id,joined_at)
    SELECT rooms.id,m.value,json_extract(rooms.data_json,'$.createdAt')
    FROM rooms JOIN json_each(rooms.data_json,'$.memberIds') m
    WHERE EXISTS(SELECT 1 FROM accounts a WHERE a.id=m.value)
    ORDER BY rooms.rowid,m.key;
   INSERT INTO lobby_settings(lobby_id,updated_at) SELECT id,created_at FROM lobbies;
   DROP TABLE rooms;
  `);
 }},
 {version:5,name:'runs',scopes:['portal'],up:db=>db.exec(`
  CREATE TABLE runs(
   id TEXT PRIMARY KEY,
   lobby_id TEXT NOT NULL,
   account_id TEXT NOT NULL,
   number INTEGER NOT NULL CHECK(number>=1),
   status TEXT NOT NULL CHECK(status IN ('NOT_STARTED','RUNNING','LOST','COMPLETED','ABORTED')),
   started_at TEXT,
   ended_at TEXT,
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL,
   FOREIGN KEY(lobby_id,account_id) REFERENCES lobby_members(lobby_id,account_id) ON DELETE CASCADE,
   UNIQUE(lobby_id,account_id,number)
  );
  -- Invariant enforced by the database itself: at most one RUNNING attempt per player and lobby.
  CREATE UNIQUE INDEX runs_one_running ON runs(lobby_id,account_id) WHERE status='RUNNING';
 `)},
 {version:6,name:'money-ledger',scopes:['portal'],up:db=>db.exec(`
  CREATE TABLE bank_accounts(
   lobby_id TEXT NOT NULL,
   account_id TEXT NOT NULL,
   balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),
   updated_at TEXT NOT NULL,
   PRIMARY KEY(lobby_id,account_id),
   FOREIGN KEY(lobby_id,account_id) REFERENCES lobby_members(lobby_id,account_id) ON DELETE CASCADE
  );
  CREATE TABLE jackpots(
   lobby_id TEXT PRIMARY KEY REFERENCES lobbies(id) ON DELETE CASCADE,
   balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),
   updated_at TEXT NOT NULL
  );
  CREATE TABLE money_transactions(
   id TEXT PRIMARY KEY,
   lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
   account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
   run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
   type TEXT NOT NULL CHECK(type IN ('BANK_DEPOSIT','BANK_WITHDRAW','AUCTION_PAYMENT','SHOP_PURCHASE','WHEEL_TRANSFER','WHEEL_REWARD','JACKPOT_CONTRIBUTION','JACKPOT_REWARD','ADMIN_ADJUSTMENT','OBJECTIVE_REWARD')),
   amount INTEGER NOT NULL CHECK(amount>0),
   source TEXT NOT NULL CHECK(source IN ('GAME','BANK','JACKPOT','EXTERNAL')),
   destination TEXT NOT NULL CHECK(destination IN ('GAME','BANK','JACKPOT','EXTERNAL') AND destination<>source),
   status TEXT NOT NULL CHECK(status IN ('PENDING','APPLYING','CONFIRMED','FAILED','REVIEW','CANCELLED')),
   command_id TEXT,
   idempotency_key TEXT UNIQUE,
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL,
   confirmed_at TEXT,
   metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))
  );
  CREATE INDEX money_transactions_lobby ON money_transactions(lobby_id,created_at);
  CREATE INDEX money_transactions_account ON money_transactions(lobby_id,account_id,created_at);
  CREATE INDEX money_transactions_command ON money_transactions(command_id);
 `)},
 {version:7,name:'audit-logs',scopes:['portal'],up:db=>db.exec(`
  CREATE TABLE audit_logs(
   id TEXT PRIMARY KEY,
   timestamp TEXT NOT NULL,
   lobby_id TEXT REFERENCES lobbies(id) ON DELETE SET NULL,
   actor_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
   target_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
   run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
   category TEXT NOT NULL CHECK(category IN ('ACCOUNT','LOBBY','RUN','GAME_COMMAND','POKEMON','MONEY','BANK','JACKPOT','AUCTION','WHEEL','TICKET','PROTECTION','ADMIN','ERROR')),
   action TEXT NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('SUCCESS','FAILED','PENDING','REVIEW','INFO')),
   command_id TEXT,
   message TEXT NOT NULL,
   error_code TEXT,
   metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))
  );
  CREATE INDEX audit_logs_lobby ON audit_logs(lobby_id,timestamp);
  CREATE INDEX audit_logs_command ON audit_logs(command_id);
 `)},
 {version:8,name:'game-commands-and-library',scopes:['portal'],up:db=>db.exec(`
  -- Every game write sent to a client, so an unknown outcome can be reconciled after a reconnection.
  CREATE TABLE game_commands(
   id TEXT PRIMARY KEY,
   lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
   account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
   run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
   actor_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
   command TEXT NOT NULL,
   payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
   status TEXT NOT NULL CHECK(status IN ('SENT','COMPLETED','FAILED','REVIEW','RESOLVED_APPLIED','RESOLVED_NOT_APPLIED')),
   error_code TEXT,
   result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL
  );
  CREATE INDEX game_commands_lobby ON game_commands(lobby_id,created_at);
  CREATE INDEX game_commands_review ON game_commands(status) WHERE status='REVIEW';
  -- Versioned Pokémon copies, global to the portal and independent of Runs (the payload depends on the format).
  CREATE TABLE pokemon_artifacts(
   id TEXT PRIMARY KEY,
   label TEXT NOT NULL,
   format TEXT NOT NULL,
   game_family TEXT NOT NULL,
   generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9),
   species INTEGER NOT NULL CHECK(species>=1),
   display_json TEXT NOT NULL CHECK(json_valid(display_json)),
   payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
   source TEXT,
   captured_at TEXT,
   created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
   created_at TEXT NOT NULL
  );
  -- Lobby libraries already copied into pokemon_artifacts (imported once, so a deletion is never undone).
  CREATE TABLE library_imports(lobby_id TEXT PRIMARY KEY,imported_at TEXT NOT NULL);
 `)},
 {version:9,name:'objectives',scopes:['portal'],up:db=>db.exec(`
  CREATE TABLE objectives(
   lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
   id TEXT NOT NULL,
   name TEXT NOT NULL,
   description TEXT NOT NULL DEFAULT '',
   sort_order INTEGER NOT NULL,
   reward_money INTEGER NOT NULL DEFAULT 0 CHECK(reward_money BETWEEN 0 AND 999999),
   map_section TEXT,
   condition_json TEXT NOT NULL CHECK(json_valid(condition_json)),
   enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
   PRIMARY KEY(lobby_id,id)
  );
  -- One completion per player and objective in a lobby: the reward can never be paid twice.
  CREATE TABLE objective_completions(
   lobby_id TEXT NOT NULL,
   objective_id TEXT NOT NULL,
   account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
   run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
   completed_at TEXT NOT NULL,
   reward_status TEXT NOT NULL CHECK(reward_status IN ('NONE','PENDING','PAID','REVIEW')),
   reward_attempts INTEGER NOT NULL DEFAULT 0,
   reward_command_id TEXT,
   PRIMARY KEY(lobby_id,objective_id,account_id),
   FOREIGN KEY(lobby_id,objective_id) REFERENCES objectives(lobby_id,id) ON DELETE CASCADE
  );
 `)},
 // "auctions" already names the former per-lobby document table, hence lobby_auctions.
 {version:10,name:'auctions',scopes:['portal'],up:db=>db.exec(`
  CREATE TABLE lobby_auctions(
   id TEXT PRIMARY KEY,
   lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
   status TEXT NOT NULL CHECK(status IN ('OPEN','SETTLING','SOLD','CANCELLED','REVIEW')),
   species_id INTEGER NOT NULL,
   name TEXT NOT NULL,
   level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 100),
   sample_size INTEGER NOT NULL,
   uncertainty INTEGER NOT NULL CHECK(uncertainty BETWEEN 0 AND 100),
   hints_json TEXT NOT NULL CHECK(json_valid(hints_json)),
   template_json TEXT NOT NULL CHECK(json_valid(template_json)),
   log_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(log_json)),
   winner_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
   price INTEGER,
   command_id TEXT,
   created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
   created_at TEXT NOT NULL,
   closed_at TEXT
  );
  -- At most one auction in progress per lobby.
  CREATE UNIQUE INDEX lobby_auctions_active ON lobby_auctions(lobby_id) WHERE status IN ('OPEN','SETTLING','REVIEW');
  CREATE TABLE auction_bids(
   id TEXT PRIMARY KEY,
   auction_id TEXT NOT NULL REFERENCES lobby_auctions(id) ON DELETE CASCADE,
   account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
   amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 999999),
   created_at TEXT NOT NULL,
   UNIQUE(auction_id,amount)
  );
  CREATE INDEX auction_bids_auction ON auction_bids(auction_id,amount);
 `)},
 {version:11,name:'wheels',scopes:['portal'],up:db=>db.exec(`
  CREATE TABLE wheel_types(
   id TEXT PRIMARY KEY,
   lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
   name TEXT NOT NULL,
   description TEXT NOT NULL DEFAULT '',
   price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 999999),
   icon TEXT NOT NULL,
   tone TEXT NOT NULL CHECK(tone IN ('GOOD','BAD','NEUTRAL')),
   enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
   deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL
  );
  -- Gage configuration: a handler name and its validated parameters (JSON), never code.
  CREATE TABLE wheel_gages(
   id TEXT PRIMARY KEY,
   wheel_type_id TEXT NOT NULL REFERENCES wheel_types(id) ON DELETE CASCADE,
   name TEXT NOT NULL,
   description TEXT NOT NULL DEFAULT '',
   handler TEXT NOT NULL,
   params_json TEXT NOT NULL CHECK(json_valid(params_json)),
   weight INTEGER NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 100),
   sort_order INTEGER NOT NULL
  );
  -- The drawn gage is copied at draw time: editing a wheel later never changes a past result.
  CREATE TABLE wheel_resolutions(
   id TEXT PRIMARY KEY,
   lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
   wheel_type_id TEXT NOT NULL REFERENCES wheel_types(id),
   gage_json TEXT NOT NULL CHECK(json_valid(gage_json)),
   owner_account_id TEXT NOT NULL REFERENCES accounts(id),
   target_account_id TEXT REFERENCES accounts(id),
   ticket_id TEXT,
   status TEXT NOT NULL CHECK(status IN ('DRAWN','AWAITING_CHOICE','APPLYING','SUCCESS','FAILED','REVIEW','BLOCKED')),
   strip_json TEXT NOT NULL CHECK(json_valid(strip_json)),
   result TEXT,
   created_by TEXT REFERENCES accounts(id),
   created_at TEXT NOT NULL,
   applied_at TEXT
  );
  CREATE INDEX wheel_resolutions_lobby ON wheel_resolutions(lobby_id,created_at);
 `)},
 {version:12,name:'shop-tickets-protections',scopes:['portal'],up:db=>db.exec(`
  ALTER TABLE lobby_settings ADD COLUMN protection_price INTEGER NOT NULL DEFAULT 2000 CHECK(protection_price BETWEEN 0 AND 999999);
  -- A ticket is created before its payment, queued once the game confirmed the debit, then resolved by an admin.
  -- The queue of a player is the ordered list of QUEUED tickets whose recipient is that player.
  CREATE TABLE wheel_tickets(
   id TEXT PRIMARY KEY,
   lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
   wheel_type_id TEXT NOT NULL REFERENCES wheel_types(id),
   buyer_account_id TEXT NOT NULL REFERENCES accounts(id),
   recipient_account_id TEXT NOT NULL REFERENCES accounts(id),
   target_account_id TEXT REFERENCES accounts(id),
   price INTEGER NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('PENDING_PAYMENT','PAYMENT_REVIEW','QUEUED','RESOLVED','BLOCKED','CANCELLED')),
   command_id TEXT,
   resolution_id TEXT REFERENCES wheel_resolutions(id),
   created_at TEXT NOT NULL,
   queued_at TEXT,
   resolved_at TEXT
  );
  CREATE INDEX wheel_tickets_queue ON wheel_tickets(lobby_id,status,queued_at);
  CREATE TABLE protections(
   id TEXT PRIMARY KEY,
   lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
   account_id TEXT NOT NULL REFERENCES accounts(id),
   status TEXT NOT NULL CHECK(status IN ('PENDING_PAYMENT','PAYMENT_REVIEW','ACTIVE','USED','CANCELLED')),
   price INTEGER NOT NULL,
   command_id TEXT,
   acquired_at TEXT,
   used_at TEXT,
   used_on_ticket_id TEXT,
   created_at TEXT NOT NULL
  );
  CREATE INDEX protections_account ON protections(lobby_id,account_id,status);
 `)},
 {version:13,name:'race-passives',scopes:['portal'],up:db=>{
  // New audit category and ledger type: both tables are rebuilt from their own DDL (nothing references them).
  widenCheck(db,'audit_logs',"'ADMIN','ERROR')","'ADMIN','ERROR','PASSIVE')");
  widenCheck(db,'money_transactions',"'ADMIN_ADJUSTMENT','OBJECTIVE_REWARD')","'ADMIN_ADJUSTMENT','OBJECTIVE_REWARD','PASSIVE_REWARD')");
  db.exec(`
   -- The lobby status cannot be widened safely (every lobby table cascades from it): the selection phase lives here.
   CREATE TABLE passive_settings(
    lobby_id TEXT PRIMARY KEY REFERENCES lobbies(id) ON DELETE CASCADE,
    phase TEXT NOT NULL DEFAULT 'NONE' CHECK(phase IN ('NONE','SELECTION','DONE')),
    weights_json TEXT NOT NULL CHECK(json_valid(weights_json)),
    disabled_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(disabled_json)),
    updated_at TEXT NOT NULL
   );
   -- Three private cards per player and generation; a reset cancels the generation and creates the next one.
   CREATE TABLE passive_offers(
    id TEXT PRIMARY KEY,
    lobby_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    passive_id TEXT NOT NULL,
    offer_index INTEGER NOT NULL CHECK(offer_index BETWEEN 0 AND 2),
    status TEXT NOT NULL CHECK(status IN ('OFFERED','CHOSEN','REJECTED','CANCELLED')),
    generated_at TEXT NOT NULL,
    chosen_at TEXT,
    FOREIGN KEY(lobby_id,account_id) REFERENCES lobby_members(lobby_id,account_id) ON DELETE CASCADE,
    UNIQUE(lobby_id,account_id,generation,offer_index),
    UNIQUE(lobby_id,account_id,generation,passive_id)
   );
   -- Possession for the whole race. stackableCopies=false: the same passive is owned at most once.
   CREATE TABLE race_passives(
    id TEXT PRIMARY KEY,
    lobby_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    passive_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('INITIAL_CHOICE','ADMIN','WHEEL','JACKPOT','SHOP','EVENT')),
    acquired_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
    FOREIGN KEY(lobby_id,account_id) REFERENCES lobby_members(lobby_id,account_id) ON DELETE CASCADE,
    UNIQUE(lobby_id,account_id,passive_id)
   );
   -- Counters (places, species, activations…) follow the passive, including when it is stolen.
   CREATE TABLE passive_progress(
    lobby_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    passive_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(lobby_id,account_id,passive_id,key),
    FOREIGN KEY(lobby_id,account_id) REFERENCES lobby_members(lobby_id,account_id) ON DELETE CASCADE
   );
   -- An event is processed at most once per player: replays after a reconnection change nothing.
   CREATE TABLE passive_events(
    id TEXT PRIMARY KEY,
    lobby_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    processed_at TEXT NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result_json)),
    FOREIGN KEY(lobby_id,account_id) REFERENCES lobby_members(lobby_id,account_id) ON DELETE CASCADE,
    UNIQUE(lobby_id,account_id,event_id)
   );
   -- Deferred or uncertain rewards: PENDING until the game can receive them, REVIEW when the outcome is unknown.
   CREATE TABLE passive_rewards(
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    passive_id TEXT NOT NULL,
    lobby_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    status TEXT NOT NULL CHECK(status IN ('PENDING','APPLYING','CONFIRMED','FAILED','REVIEW')),
    command_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY(lobby_id,account_id) REFERENCES lobby_members(lobby_id,account_id) ON DELETE CASCADE,
    UNIQUE(lobby_id,account_id,event_id,passive_id)
   );
   CREATE INDEX passive_rewards_status ON passive_rewards(lobby_id,status);
  `);
 }},
 // Wheel draws with a choice (Sixième sens, Maître du chaos): the candidate gages and who picks one.
 {version:14,name:'wheel-choices',scopes:['portal'],up:db=>db.exec(`
  ALTER TABLE wheel_resolutions ADD COLUMN options_json TEXT CHECK(options_json IS NULL OR json_valid(options_json));
  ALTER TABLE wheel_resolutions ADD COLUMN chooser_account_id TEXT REFERENCES accounts(id);
 `)},
 // Battle encounters: one row per commanded battle, its frozen spec and its whole lifecycle.
 {version:15,name:'battle-encounters',scopes:['portal'],up:db=>{
  widenCheck(db,'audit_logs',"'PASSIVE')","'PASSIVE','BATTLE')");
  db.exec(`
   CREATE TABLE battle_encounters(
    id TEXT PRIMARY KEY,
    lobby_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('CURRENT_PLAYER_PARTY','OTHER_PLAYER_CURRENT_PARTY','LEADER_PARTY','CUSTOM_PARTY')),
    source_ref_id TEXT,
    source_label TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('CREATED','WAITING_SAFE_STATE','SENDING','STARTING','RUNNING','WON','LOST','CANCELLED','FAILED','REVIEW')),
    trainer_name TEXT NOT NULL,
    trainer_sprite TEXT NOT NULL,
    party_json TEXT NOT NULL CHECK(json_valid(party_json)),
    options_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(options_json)),
    scaling_json TEXT NOT NULL CHECK(json_valid(scaling_json)),
    command_id TEXT,
    created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
    error_code TEXT,
    FOREIGN KEY(lobby_id,account_id) REFERENCES lobby_members(lobby_id,account_id) ON DELETE CASCADE
   );
   CREATE INDEX battle_encounters_lobby ON battle_encounters(lobby_id,created_at);
   -- At most one commanded battle queued, in progress or uncertain per player.
   CREATE UNIQUE INDEX battle_encounters_active ON battle_encounters(lobby_id,account_id) WHERE status IN ('WAITING_SAFE_STATE','SENDING','STARTING','RUNNING','REVIEW');
  `);
 }},
 {version:16,name:'battle-board',scopes:['portal'],up:db=>{
  widenCheck(db,'battle_encounters',"'LEADER_PARTY','CUSTOM_PARTY')","'LEADER_PARTY','CUSTOM_PARTY','BOARD_TEAM')");
  widenCheck(db,'money_transactions',"'OBJECTIVE_REWARD','PASSIVE_REWARD')","'OBJECTIVE_REWARD','PASSIVE_REWARD','BATTLE_REWARD')");
  db.exec(`
   CREATE TABLE battle_board_teams(
    id TEXT PRIMARY KEY,
    lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    trainer_name TEXT NOT NULL,
    trainer_sprite TEXT NOT NULL,
    slots_json TEXT NOT NULL CHECK(json_valid(slots_json)),
    party_json TEXT NOT NULL CHECK(json_valid(party_json)),
    reward INTEGER NOT NULL CHECK(reward BETWEEN 0 AND 999999),
    status TEXT NOT NULL CHECK(status IN ('OPEN','CHALLENGED','WON','WITHDRAWN')),
    origin TEXT NOT NULL CHECK(origin IN ('ADMIN','WHEEL')),
    created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    challenger_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    encounter_id TEXT,
    winner_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    won_at TEXT,
    reward_status TEXT NOT NULL DEFAULT 'NONE' CHECK(reward_status IN ('NONE','PENDING','PAID','REVIEW')),
    reward_attempts INTEGER NOT NULL DEFAULT 0,
    reward_command_id TEXT
   );
   CREATE INDEX battle_board_teams_lobby ON battle_board_teams(lobby_id,created_at);
  `);
 }},
 // A wheel may be kept out of the shop (admin and automatic spins only); one automatic wheel per lobby.
 {version:17,name:'wheel-sale-and-auto',scopes:['portal'],up:db=>db.exec(`
  ALTER TABLE wheel_types ADD COLUMN for_sale INTEGER NOT NULL DEFAULT 1 CHECK(for_sale IN (0,1));
  CREATE TABLE auto_wheels(
   lobby_id TEXT PRIMARY KEY REFERENCES lobbies(id) ON DELETE CASCADE,
   wheel_type_id TEXT REFERENCES wheel_types(id) ON DELETE SET NULL,
   every_minutes INTEGER NOT NULL CHECK(every_minutes BETWEEN 0 AND 1440),
   last_at TEXT,
   updated_at TEXT NOT NULL
  );
 `)}
];

// Rebuilds a table nothing references, with one CHECK list widened; data, columns and indexes are kept.
function widenCheck(db:Database.Database,table:string,from:string,to:string){
 const sql=(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as {sql:string}).sql;
 if(!sql.includes(from))throw new Error(`${table}: CHECK ${from} not found`);
 // After a previous rebuild SQLite stores the renamed table as CREATE TABLE "name"(…).
 const header=new RegExp(`^CREATE TABLE "?${table}"?\\s*\\(`);
 if(!header.test(sql))throw new Error(`${table}: unexpected DDL`);
 const indexes=(db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table) as {sql:string}[]).map(r=>r.sql);
 db.exec(sql.replace(header,`CREATE TABLE ${table}_next(`).replace(from,to));
 db.exec(`INSERT INTO ${table}_next SELECT * FROM ${table};DROP TABLE ${table};ALTER TABLE ${table}_next RENAME TO ${table};`);
 for(const index of indexes)db.exec(index);
}

// Each migration runs in its own transaction and is recorded once; a failure leaves the previous version intact.
export function migrate(db:Database.Database,scope:DatabaseScope){
 db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
 if(!columns(db,'schema_migrations').includes('name'))db.exec('ALTER TABLE schema_migrations ADD COLUMN name TEXT');
 const applied=new Set((db.prepare('SELECT version FROM schema_migrations').all() as {version:number}[]).map(r=>r.version));
 const record=db.prepare("INSERT INTO schema_migrations(version,applied_at,name) VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)");
 for(const migration of migrations){
  if(!migration.scopes.includes(scope))continue;
  if(applied.has(migration.version)){
   // Version 1 was recorded without a name by the previous store.
   db.prepare('UPDATE schema_migrations SET name=? WHERE version=? AND name IS NULL').run(migration.name,migration.version);
   continue;
  }
  db.transaction(()=>{migration.up(db);record.run(migration.version,migration.name);})();
 }
}

export const schemaVersion=(db:Database.Database)=>(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {v:number|null}).v??0;
