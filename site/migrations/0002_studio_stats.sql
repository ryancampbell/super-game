-- Studio metrics (@homie-rocks/studio 0.6.0): daily counters. Count, don't track: no row is about a person.
CREATE TABLE IF NOT EXISTS stats_daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  subject TEXT NOT NULL,
  source TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, metric, subject, source)
) WITHOUT ROWID;
-- The owner's read keys and page sessions: only a SHA-256 of each, never the key.
CREATE TABLE IF NOT EXISTS stats_keys (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
