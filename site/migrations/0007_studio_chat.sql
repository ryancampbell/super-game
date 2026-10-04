-- Room chat (@homie-rocks/studio 0.23.0): the owner's chat rules per game and per server, and players' reports.
-- The chat itself is never stored: it lives a few minutes in the room's memory. A report keeps only the message it
-- is about (its words, its sender's room name and account id if they had one, the room), for 30 days; never who
-- reported it, never an address.
CREATE TABLE IF NOT EXISTS chat_rules (
  game TEXT NOT NULL,
  server TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game, server)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chat_reports (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  room TEXT NOT NULL,
  line TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  sender_name TEXT,
  sender_player TEXT,
  sender_seat INTEGER,
  said_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_reports_game ON chat_reports (game, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS chat_reports_line ON chat_reports (game, room, line);
