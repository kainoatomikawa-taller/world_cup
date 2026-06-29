-- schema.sql: World Cup Insights — baseline SQLite schema
-- Idempotent: safe to re-run. All statements use IF NOT EXISTS so existing
-- data is never dropped. New tables/indexes added here are applied on the
-- next run of scripts/init_db.py.
--
-- Usage:
--   python scripts/init_db.py               # recommended
--   sqlite3 db/world_cup.db < scripts/schema.sql  # direct

PRAGMA foreign_keys = ON;
PRAGMA journal_mode  = WAL;

-- ---------------------------------------------------------------------------
-- competitions
-- One row per tournament edition. The app currently targets FIFA WC 2026.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitions (
    id          TEXT    PRIMARY KEY,   -- e.g. 'fifa-wc-2026'
    name        TEXT    NOT NULL,
    year        INTEGER NOT NULL,
    format      TEXT,                  -- e.g. '48-team', '32-team'
    start_date  TEXT,                  -- ISO 8601 date
    end_date    TEXT
);

-- ---------------------------------------------------------------------------
-- teams
-- Canonical team records. The id slug must match schedule2026.ts so that
-- the TypeScript domain layer and the data layer share the same identity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
    id              TEXT    PRIMARY KEY,  -- slug, e.g. 'argentina'
    competition_id  TEXT    NOT NULL REFERENCES competitions(id),
    name            TEXT    NOT NULL,
    code            TEXT    NOT NULL,     -- 3-letter TLA, e.g. 'ARG'
    group_id        TEXT,                 -- 'A'–'L'; NULL for future non-group-stage use
    flag            TEXT                  -- emoji or asset path
);

CREATE INDEX IF NOT EXISTS idx_teams_competition
    ON teams(competition_id);

-- ---------------------------------------------------------------------------
-- matches
-- One row per fixture. home_goals / away_goals are NULL until played.
-- source_id preserves the upstream integer id (football-data.org) for
-- reverse-lookup when re-fetching.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
    id              TEXT    PRIMARY KEY,          -- upstream id cast to TEXT
    competition_id  TEXT    NOT NULL REFERENCES competitions(id),
    -- stage values mirror the domain Stage type in src/domain/types.ts
    stage           TEXT    NOT NULL,             -- 'group'|'round32'|'round16'|'quarter'|'semi'|'thirdPlacePlayoff'|'final'
    group_id        TEXT,                         -- 'A'–'L'; NULL outside group stage
    home_team_id    TEXT    NOT NULL REFERENCES teams(id),
    away_team_id    TEXT    NOT NULL REFERENCES teams(id),
    home_goals      INTEGER,                      -- NULL = not yet played
    away_goals      INTEGER,
    kickoff         TEXT    NOT NULL,             -- ISO 8601 datetime
    played          INTEGER NOT NULL DEFAULT 0,   -- 0|1 boolean
    source_id       TEXT,                         -- raw upstream id (for re-sync)
    fetched_at      TEXT                          -- ISO 8601 datetime of last API pull
);

CREATE INDEX IF NOT EXISTS idx_matches_competition
    ON matches(competition_id);
CREATE INDEX IF NOT EXISTS idx_matches_stage
    ON matches(competition_id, stage);
CREATE INDEX IF NOT EXISTS idx_matches_group
    ON matches(competition_id, group_id);

-- ---------------------------------------------------------------------------
-- standings
-- Computed group-stage standings. Recalculated on each data sync; this table
-- is a derived cache — the matches table is the source of truth.
-- One row per (competition, group, team); upserted by the sync process.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS standings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id  TEXT    NOT NULL REFERENCES competitions(id),
    group_id        TEXT    NOT NULL,
    team_id         TEXT    NOT NULL REFERENCES teams(id),
    played          INTEGER NOT NULL DEFAULT 0,
    won             INTEGER NOT NULL DEFAULT 0,
    drawn           INTEGER NOT NULL DEFAULT 0,
    lost            INTEGER NOT NULL DEFAULT 0,
    goals_for       INTEGER NOT NULL DEFAULT 0,
    goals_against   INTEGER NOT NULL DEFAULT 0,
    points          INTEGER NOT NULL DEFAULT 0,
    position        INTEGER,                      -- 1–4; NULL until tiebreakers resolved
    updated_at      TEXT,
    UNIQUE(competition_id, group_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_standings_group
    ON standings(competition_id, group_id);

-- ---------------------------------------------------------------------------
-- scorers
-- Backbone top-scorer data from the primary API (football-data.org).
-- Enriched stats live in player_stats (Phase 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scorers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id  TEXT    NOT NULL REFERENCES competitions(id),
    player_id       TEXT    NOT NULL,  -- canonical slug, e.g. 'kylian-mbappe'
    player_name     TEXT    NOT NULL,
    team_id         TEXT    NOT NULL REFERENCES teams(id),
    goals           INTEGER NOT NULL DEFAULT 0,
    assists         INTEGER NOT NULL DEFAULT 0,
    penalties       INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT,
    UNIQUE(competition_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_scorers_leaderboard
    ON scorers(competition_id, goals DESC);

-- ---------------------------------------------------------------------------
-- player_stats  [Phase 2 — populated by enrichment pipeline]
-- Per-player match and tournament-aggregate statistics from a stats provider.
-- match_id = NULL means a tournament aggregate row.
-- source distinguishes rows from different enrichment pipelines (fbref,
-- understat) so the same player can have a row per source.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_stats (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id  TEXT    NOT NULL,
    player_id       TEXT    NOT NULL,
    team_id         TEXT    NOT NULL,
    match_id        TEXT,              -- NULL → tournament aggregate
    source          TEXT    NOT NULL DEFAULT 'fbref',  -- 'fbref' | 'understat'
    matches_played  INTEGER DEFAULT 0,
    minutes         INTEGER DEFAULT 0,
    goals           INTEGER DEFAULT 0,
    assists         INTEGER DEFAULT 0,
    yellow_cards    INTEGER DEFAULT 0,
    red_cards       INTEGER DEFAULT 0,
    shots           INTEGER DEFAULT 0,
    shots_on_target INTEGER DEFAULT 0,
    xg              REAL,              -- expected goals (FBref: xG)
    xg_non_penalty  REAL,              -- non-penalty xG (FBref: npxG, Understat: np_xg)
    xa              REAL,              -- expected assists (FBref: xAG, Understat: xa)
    passes          INTEGER DEFAULT 0,
    pass_accuracy   REAL,              -- 0.0–1.0
    updated_at      TEXT,
    UNIQUE(competition_id, player_id, match_id, source)
);

-- ---------------------------------------------------------------------------
-- player_ratings  [Phase 2 — populated by enrichment pipeline]
-- Per-player ratings from third-party sources (e.g. SofaScore, WhoScored).
-- match_id = NULL means a tournament-average rating.
-- Ratings are stored on the source's original scale; normalisation is done
-- at query time so raw data is preserved for auditability.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_ratings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id  TEXT    NOT NULL,
    player_id       TEXT    NOT NULL,
    team_id         TEXT    NOT NULL,
    match_id        TEXT,              -- NULL → tournament average
    source          TEXT    NOT NULL,  -- 'sofascore' | 'whoscored' | ...
    rating          REAL    NOT NULL,  -- scale varies by source; preserved as-is
    updated_at      TEXT,
    UNIQUE(competition_id, player_id, match_id, source)
);

-- ---------------------------------------------------------------------------
-- identity_map
-- Cross-source identity reconciliation. Each row maps one external source's
-- identifier/name to our canonical slug. Used by the adapter layer to resolve
-- API responses from multiple providers to a single canonical_id.
--
-- Workflow: the adapter inserts rows with verified=0 when it encounters an
-- unknown name. A human (or a future auto-verify step) flips verified=1 once
-- the mapping is confirmed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity_map (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_id    TEXT    NOT NULL,           -- our stable slug
    entity_type     TEXT    NOT NULL,           -- 'team' | 'player'
    source          TEXT    NOT NULL,           -- 'football-data' | 'sofascore' | 'whoscored' | ...
    source_id       TEXT    NOT NULL,           -- the ID or name used by that source
    source_name     TEXT,                       -- display name from that source (audit trail)
    verified        INTEGER NOT NULL DEFAULT 0, -- 1 once a human has confirmed the mapping
    notes           TEXT,
    UNIQUE(entity_type, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_map_canonical
    ON identity_map(canonical_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_identity_map_unverified
    ON identity_map(verified) WHERE verified = 0;

-- ---------------------------------------------------------------------------
-- identity_review  [view — not a base table]
-- Convenience view for the manual-review workflow.  Shows every row that
-- needs human attention: either auto-generated (verified=0) or unresolvable
-- (canonical_id='__unmatched__').  Update via:
--
--   UPDATE identity_map SET canonical_id='<slug>', verified=1 WHERE id=<id>;
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS identity_review AS
SELECT
    im.id,
    CASE
        WHEN im.canonical_id = '__unmatched__' THEN 'unmatched'
        ELSE 'unverified'
    END                 AS review_status,
    im.entity_type,
    im.source,
    im.source_id,
    im.source_name,
    im.canonical_id,
    im.notes
FROM identity_map im
WHERE im.canonical_id = '__unmatched__'
   OR im.verified = 0
ORDER BY im.entity_type, im.source, im.source_name;
