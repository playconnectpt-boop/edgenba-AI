CREATE TABLE IF NOT EXISTS ones_to_watch_daily (
  selection_date TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('points', 'rebounds', 'assists', 'threes', 'pra')),
  direction TEXT NOT NULL CHECK (direction IN ('OVER', 'UNDER')),
  suggested_line REAL NOT NULL,
  score INTEGER NOT NULL,
  confidence TEXT NOT NULL,
  explanation_json TEXT NOT NULL,
  source_data_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ones_to_watch_player
ON ones_to_watch_daily(player_id, selection_date);
