CREATE TABLE player_seasons (
    player_id TEXT NOT NULL,
      season INTEGER NOT NULL,
        team_id TEXT,
          team_name TEXT,
            PRIMARY KEY (player_id, season)
            );
