-- The studio's back office (@homie-rocks/studio 0.13.0): each game's launch state, remix switch and room size,
-- its invites and the passes they gave, and the controls the owner's AI asked the owner to confirm.
CREATE TABLE IF NOT EXISTS office_games (
  game TEXT PRIMARY KEY,
  launch TEXT,
  remix INTEGER,
  max_players INTEGER,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS office_invites (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  label TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS office_invites_game ON office_invites (game);
-- A pass is one browser's way into an invite-only game: only the SHA-256 of its cookie.
CREATE TABLE IF NOT EXISTS office_passes (
  hash TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  invite TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS office_asks (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  state TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
