CREATE TABLE IF NOT EXISTS player_source_ids (
        player_id TEXT NOT NULL,
            source TEXT NOT NULL,
                source_player_id TEXT NOT NULL,
                    season INTEGER NOT NULL DEFAULT 2026,
                        matched_by TEXT NOT NULL DEFAULT 'manual',
                            verified INTEGER NOT NULL DEFAULT 0,
                                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                    PRIMARY KEY (player_id, source, season),
                                        UNIQUE (source, source_player_id, season),

                                            FOREIGN KEY (player_id)
                                                    REFERENCES players(player_id)
                                                            ON DELETE CASCADE
                                                            );

                                                            CREATE INDEX IF NOT EXISTS idx_player_source_ids_source
                                                            ON player_source_ids(source, source_player_id);
