CREATE TABLE IF NOT EXISTS players (
      player_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
          team_id TEXT,
            team_name TEXT,
              position TEXT,
                jersey_number TEXT,
                  headshot_url TEXT,
                    season INTEGER NOT NULL DEFAULT 2026,
                      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                      );

                      CREATE TABLE IF NOT EXISTS games (
                        game_id TEXT PRIMARY KEY,
                          season INTEGER NOT NULL,
                            game_date TEXT NOT NULL,
                              home_team TEXT,
                                away_team TEXT,
                                  status TEXT,
                                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    );

                                    CREATE TABLE IF NOT EXISTS player_game_stats (
                                      player_id TEXT NOT NULL,
                                        game_id TEXT NOT NULL,
                                          season INTEGER NOT NULL,
                                            game_date TEXT NOT NULL,
                                              opponent TEXT,
                                                minutes REAL,
                                                  points INTEGER,
                                                    rebounds INTEGER,
                                                      assists INTEGER,
                                                        steals INTEGER,
                                                          blocks INTEGER,
                                                            turnovers INTEGER,
                                                              three_pointers_made INTEGER,
                                                                field_goals_made INTEGER,
                                                                  field_goals_attempted INTEGER,
                                                                    three_pointers_attempted INTEGER,
                                                                      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                                                        PRIMARY KEY (player_id, game_id, season),
                                                                          FOREIGN KEY (player_id) REFERENCES players(player_id),
                                                                            FOREIGN KEY (game_id) REFERENCES games(game_id)
                                                                            );

                                                                            CREATE TABLE IF NOT EXISTS sync_log (
                                                                              id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                                                season INTEGER NOT NULL,
                                                                                  player_id TEXT,
                                                                                    sync_type TEXT NOT NULL,
                                                                                      last_game_date TEXT,
                                                                                        status TEXT NOT NULL,
                                                                                          records_synced INTEGER NOT NULL DEFAULT 0,
                                                                                            error_message TEXT,
                                                                                              synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                                                              );

                                                                                              CREATE INDEX IF NOT EXISTS idx_player_stats_season_date
                                                                                              ON player_game_stats(season, game_date);

                                                                                              CREATE INDEX IF NOT EXISTS idx_player_stats_player_date
                                                                                              ON player_game_stats(player_id, game_date);

                                                                                              CREATE INDEX IF NOT EXISTS idx_games_date
                                                                                              ON games(game_date);
