-- The Lounge and kept chat (@homie-rocks/studio 0.29.0): what was said in a room whose owner turned history on (never a
-- reaction, an address or a browser key; a signed-in sender's account id so they can remove it), the play nights the
-- owner sets, and the moderators the owner names. Kept chat is forgotten after the room's history days.
CREATE TABLE IF NOT EXISTS chat_history (
  game TEXT NOT NULL,
  room TEXT NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  src TEXT NOT NULL,
  text TEXT,
  say TEXT,
  card TEXT,
  player TEXT,
  acct INTEGER NOT NULL DEFAULT 0,
  owner INTEGER NOT NULL DEFAULT 0,
  mod INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game, room, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_history_at ON chat_history (game, room, at);
CREATE INDEX IF NOT EXISTS chat_history_player ON chat_history (player);
CREATE TABLE IF NOT EXISTS lounge_nights (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  note TEXT,
  game TEXT,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS lounge_nights_at ON lounge_nights (starts_at);
CREATE TABLE IF NOT EXISTS lounge_mods (
  player TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
) WITHOUT ROWID;
