-- Servers and agent seats (@homie-rocks/studio 0.16.0): named, lasting room pools per game, their policies,
-- who belongs to them, and the passes that let an AI sit in a seat. Nothing here is about a person beyond a
-- player id the studio already has; no address, no age.
CREATE TABLE IF NOT EXISTS servers (
  game TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  blurb TEXT,
  policy TEXT NOT NULL,
  ai_seats INTEGER NOT NULL DEFAULT 0,
  guides INTEGER NOT NULL DEFAULT 0,
  bots TEXT NOT NULL DEFAULT 'fill',
  level INTEGER NOT NULL DEFAULT 3,
  level_max INTEGER NOT NULL DEFAULT 5,
  speech TEXT NOT NULL DEFAULT 'game',
  door TEXT NOT NULL DEFAULT 'open',
  kids INTEGER NOT NULL DEFAULT 0,
  beginner_days INTEGER,
  beginner_level INTEGER,
  rooms_max INTEGER NOT NULL DEFAULT 4,
  seats INTEGER,
  brain TEXT NOT NULL DEFAULT 'script',
  listed INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS server_members (
  game TEXT NOT NULL,
  server TEXT NOT NULL,
  player TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  home INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (game, server, player)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS server_members_player ON server_members (player);
-- An agent pass: one AI's way into a seat. Only the SHA-256 of its secret.
CREATE TABLE IF NOT EXISTS agent_passes (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'party',
  hands TEXT NOT NULL DEFAULT 'self',
  game TEXT,
  server TEXT,
  issuer TEXT NOT NULL DEFAULT 'owner',
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
ALTER TABLE office_invites ADD COLUMN server TEXT;
