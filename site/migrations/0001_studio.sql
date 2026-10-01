-- A studio's own D1: the directory claim, and every finished round of every public room.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  room TEXT NOT NULL,
  n INTEGER NOT NULL,
  humans INTEGER NOT NULL,
  bots INTEGER NOT NULL,
  results TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rounds_game_at ON rounds (game, at);
