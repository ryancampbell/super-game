-- Players and cloud saves (@homie-rocks/studio 0.12.0): accounts on this studio only (saves/SAVES.md).
-- A player is a random id and a display name. Passkeys keep only their PUBLIC key; sessions and one-time
-- challenges keep only a SHA-256 hash. No IP address, no password, no email unless a player adds one.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  named INTEGER NOT NULL DEFAULT 0,
  guest INTEGER NOT NULL DEFAULT 1,
  owner INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS players_created ON players (created_at);
CREATE INDEX IF NOT EXISTS players_seen ON players (guest, seen_at);
CREATE TABLE IF NOT EXISTS player_passkeys (
  id TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  synced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS player_passkeys_player ON player_passkeys (player);
CREATE TABLE IF NOT EXISTS player_sessions (
  hash TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'session',
  game TEXT,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS player_sessions_player ON player_sessions (player);
CREATE TABLE IF NOT EXISTS player_challenges (
  hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  player TEXT,
  data TEXT,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS player_emails (
  player TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  verified_at INTEGER,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS player_emails_email ON player_emails (email);
CREATE TABLE IF NOT EXISTS saves (
  player TEXT NOT NULL,
  game TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  blob INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player, game, key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS player_stats (
  player TEXT NOT NULL,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  n REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player, game, name)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS memorials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  game TEXT NOT NULL,
  character TEXT NOT NULL,
  player_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memorials_game_at ON memorials (game, at);
CREATE INDEX IF NOT EXISTS memorials_player ON memorials (player);
