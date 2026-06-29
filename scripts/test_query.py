"""
test_query.py — unit tests for query.py.

Each test builds a minimal in-memory SQLite database that mirrors the
backbone schema (competitions, teams, matches, standings, scorers) and
verifies the shape and correctness of the query functions without hitting
the real database or the network.
"""

from __future__ import annotations

import sqlite3
import textwrap
from pathlib import Path

import pandas as pd
import pytest

from query import (
    competition_table,
    enriched_player_stats,
    identity_coverage,
    recent_results,
    top_scorers,
    unmatched_entities,
    upcoming_fixtures,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    """Return a path to a fresh SQLite database seeded with minimal test data."""
    path = tmp_path / "test.db"

    conn = sqlite3.connect(path)
    conn.executescript(
        textwrap.dedent("""
        PRAGMA foreign_keys = ON;

        CREATE TABLE competitions (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            year INTEGER NOT NULL, format TEXT,
            start_date TEXT, end_date TEXT
        );

        CREATE TABLE teams (
            id TEXT PRIMARY KEY, competition_id TEXT NOT NULL,
            name TEXT NOT NULL, code TEXT NOT NULL,
            group_id TEXT, flag TEXT
        );

        CREATE TABLE matches (
            id TEXT PRIMARY KEY, competition_id TEXT NOT NULL,
            stage TEXT NOT NULL, group_id TEXT,
            home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL,
            home_goals INTEGER, away_goals INTEGER,
            kickoff TEXT NOT NULL, played INTEGER NOT NULL DEFAULT 0,
            source_id TEXT, fetched_at TEXT
        );

        CREATE TABLE standings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            competition_id TEXT NOT NULL, group_id TEXT NOT NULL,
            team_id TEXT NOT NULL, played INTEGER NOT NULL DEFAULT 0,
            won INTEGER NOT NULL DEFAULT 0, drawn INTEGER NOT NULL DEFAULT 0,
            lost INTEGER NOT NULL DEFAULT 0,
            goals_for INTEGER NOT NULL DEFAULT 0,
            goals_against INTEGER NOT NULL DEFAULT 0,
            points INTEGER NOT NULL DEFAULT 0, position INTEGER,
            updated_at TEXT,
            UNIQUE(competition_id, group_id, team_id)
        );

        CREATE TABLE scorers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            competition_id TEXT NOT NULL, player_id TEXT NOT NULL,
            player_name TEXT NOT NULL, team_id TEXT NOT NULL,
            goals INTEGER NOT NULL DEFAULT 0,
            assists INTEGER NOT NULL DEFAULT 0,
            penalties INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT,
            UNIQUE(competition_id, player_id)
        );

        CREATE TABLE player_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            competition_id TEXT NOT NULL,
            player_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            match_id TEXT,
            source TEXT NOT NULL DEFAULT 'fbref',
            matches_played INTEGER DEFAULT 0,
            minutes INTEGER DEFAULT 0,
            goals INTEGER DEFAULT 0,
            assists INTEGER DEFAULT 0,
            yellow_cards INTEGER DEFAULT 0,
            red_cards INTEGER DEFAULT 0,
            shots INTEGER DEFAULT 0,
            shots_on_target INTEGER DEFAULT 0,
            xg REAL,
            xg_non_penalty REAL,
            xa REAL,
            passes INTEGER DEFAULT 0,
            pass_accuracy REAL,
            updated_at TEXT,
            UNIQUE(competition_id, player_id, match_id, source)
        );

        CREATE TABLE identity_map (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            canonical_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            source TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_name TEXT,
            verified INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            UNIQUE(entity_type, source, source_id)
        );

        INSERT INTO competitions VALUES
            ('test-comp', 'Test Cup', 2026, '4-team', '2026-01-01', '2026-01-31');

        INSERT INTO teams VALUES
            ('alpha', 'test-comp', 'Alpha FC', 'ALP', 'A', '🅰'),
            ('beta',  'test-comp', 'Beta FC',  'BET', 'A', '🅱'),
            ('gamma', 'test-comp', 'Gamma FC', 'GAM', 'B', '🎮'),
            ('delta', 'test-comp', 'Delta FC', 'DEL', 'B', '🔺');

        INSERT INTO matches VALUES
            ('m1', 'test-comp', 'group', 'A', 'alpha', 'beta',
             3, 1, '2026-01-01T12:00:00Z', 1, 'm1', NULL),
            ('m2', 'test-comp', 'group', 'A', 'alpha', 'beta',
             NULL, NULL, '2026-01-05T12:00:00Z', 0, 'm2', NULL),
            ('m3', 'test-comp', 'group', 'B', 'gamma', 'delta',
             NULL, NULL, '2026-01-07T12:00:00Z', 0, 'm3', NULL),
            ('m4', 'test-comp', 'round32', NULL, 'alpha', 'gamma',
             NULL, NULL, '2026-01-10T12:00:00Z', 0, 'm4', NULL),
            ('m5', 'test-comp', 'group', 'B', 'gamma', 'delta',
             2, 0, '2025-12-30T12:00:00Z', 1, 'm5', NULL);

        INSERT INTO standings VALUES
            (NULL, 'test-comp', 'A', 'alpha', 1, 1, 0, 0, 3, 1, 3, 1, NULL),
            (NULL, 'test-comp', 'A', 'beta',  1, 0, 0, 1, 1, 3, 0, 2, NULL),
            (NULL, 'test-comp', 'B', 'gamma', 0, 0, 0, 0, 0, 0, 0, NULL, NULL),
            (NULL, 'test-comp', 'B', 'delta', 0, 0, 0, 0, 0, 0, 0, NULL, NULL);

        INSERT INTO scorers VALUES
            (NULL, 'test-comp', 'alice', 'Alice',   'alpha', 5, 2, 1, NULL),
            (NULL, 'test-comp', 'bob',   'Bob',     'beta',  5, 0, 0, NULL),
            (NULL, 'test-comp', 'carol', 'Carol',   'gamma', 3, 4, 0, NULL),
            (NULL, 'test-comp', 'dave',  'Dave',    'delta', 1, 1, 0, NULL);

        -- tournament-aggregate rows (match_id IS NULL) for enriched_player_stats
        INSERT INTO player_stats
            (competition_id, player_id, team_id, match_id, source,
             matches_played, minutes, goals, assists, shots, shots_on_target,
             passes, pass_accuracy, xg, updated_at)
        VALUES
            ('test-comp', 'alice', 'alpha', NULL, 'fbref',
             3, 270, 5, 2, 15, 8, 120, 0.85, 4.2, NULL),
            ('test-comp', 'bob', 'beta', NULL, 'fbref',
             3, 270, 5, 0, 12, 5,  98, 0.82, 3.9, NULL),
            ('test-comp', 'alice', 'alpha', 'm1', 'fbref',
             1,  90, 3, 1,  5, 3,  40, 0.87, 2.1, NULL);

        INSERT INTO identity_map
            (canonical_id, entity_type, source, source_id, source_name, verified)
        VALUES
            ('alpha', 'team',   'football-data', 'fd-1', 'Alpha FC',       1),
            ('beta',  'team',   'football-data', 'fd-2', 'Beta FC',        1),
            ('alice', 'player', 'fbref', 'fbref-alice', 'Alice Smith',     1),
            ('bob',   'player', 'fbref', 'fbref-bob',   'Bob Jones',       0),
            ('__unmatched__', 'player', 'sofascore', 'ss-999', 'Unknown X', 0);
        """)
    )
    conn.commit()
    conn.close()
    return path


# ---------------------------------------------------------------------------
# upcoming_fixtures
# ---------------------------------------------------------------------------


class TestUpcomingFixtures:
    def test_returns_only_unplayed(self, db_path: Path) -> None:
        df = upcoming_fixtures(db_path, "test-comp")
        assert (df["match_id"] != "m1").all(), "played match m1 must be excluded"

    def test_ordered_by_kickoff(self, db_path: Path) -> None:
        df = upcoming_fixtures(db_path, "test-comp")
        assert list(df["match_id"]) == ["m2", "m3", "m4"]

    def test_limit_respected(self, db_path: Path) -> None:
        df = upcoming_fixtures(db_path, "test-comp", limit=2)
        assert len(df) == 2

    def test_stage_filter(self, db_path: Path) -> None:
        df = upcoming_fixtures(db_path, "test-comp", stage="round32")
        assert len(df) == 1
        assert df.iloc[0]["match_id"] == "m4"

    def test_group_filter_excludes_knockout(self, db_path: Path) -> None:
        df = upcoming_fixtures(db_path, "test-comp", stage="group")
        assert all(df["stage"] == "group")

    def test_columns_present(self, db_path: Path) -> None:
        df = upcoming_fixtures(db_path, "test-comp")
        expected = {
            "match_id", "kickoff", "stage", "group_id",
            "home_team", "home_code", "home_flag",
            "away_team", "away_code", "away_flag",
        }
        assert expected.issubset(df.columns)

    def test_team_names_resolved(self, db_path: Path) -> None:
        df = upcoming_fixtures(db_path, "test-comp", stage="group")
        names = set(df["home_team"]) | set(df["away_team"])
        assert "Alpha FC" in names
        assert "Beta FC" in names

    def test_empty_for_unknown_competition(self, db_path: Path) -> None:
        df = upcoming_fixtures(db_path, "no-such-comp")
        assert df.empty

    def test_read_only_does_not_mutate(self, db_path: Path) -> None:
        upcoming_fixtures(db_path, "test-comp")
        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM matches WHERE played=0").fetchone()[0]
        conn.close()
        assert count == 3, "query must not modify the matches table"


# ---------------------------------------------------------------------------
# competition_table
# ---------------------------------------------------------------------------


class TestCompetitionTable:
    def test_all_groups_returned_when_no_filter(self, db_path: Path) -> None:
        df = competition_table(db_path, "test-comp")
        assert set(df["group_id"]) == {"A", "B"}

    def test_single_group_filter(self, db_path: Path) -> None:
        df = competition_table(db_path, "test-comp", group_id="A")
        assert set(df["group_id"]) == {"A"}
        assert len(df) == 2

    def test_group_filter_case_insensitive(self, db_path: Path) -> None:
        df_upper = competition_table(db_path, "test-comp", group_id="A")
        df_lower = competition_table(db_path, "test-comp", group_id="a")
        assert len(df_upper) == len(df_lower)

    def test_ordered_by_position(self, db_path: Path) -> None:
        df = competition_table(db_path, "test-comp", group_id="A")
        positions = list(df["position"].dropna().astype(int))
        assert positions == sorted(positions)

    def test_goal_diff_computed(self, db_path: Path) -> None:
        df = competition_table(db_path, "test-comp", group_id="A")
        row_alpha = df[df["team"] == "Alpha FC"].iloc[0]
        assert row_alpha["goal_diff"] == row_alpha["goals_for"] - row_alpha["goals_against"]

    def test_columns_present(self, db_path: Path) -> None:
        df = competition_table(db_path, "test-comp")
        expected = {
            "group_id", "position", "team", "code", "flag",
            "played", "won", "drawn", "lost",
            "goals_for", "goals_against", "goal_diff", "points",
        }
        assert expected.issubset(df.columns)

    def test_team_names_populated(self, db_path: Path) -> None:
        df = competition_table(db_path, "test-comp", group_id="A")
        assert "Alpha FC" in df["team"].values

    def test_empty_for_unknown_competition(self, db_path: Path) -> None:
        df = competition_table(db_path, "no-such-comp")
        assert df.empty


# ---------------------------------------------------------------------------
# top_scorers
# ---------------------------------------------------------------------------


class TestTopScorers:
    def test_ordered_by_goals_desc(self, db_path: Path) -> None:
        df = top_scorers(db_path, "test-comp")
        goals = list(df["goals"])
        assert goals == sorted(goals, reverse=True)

    def test_tiebreak_by_assists(self, db_path: Path) -> None:
        # Alice and Bob both have 5 goals; Alice has 2 assists → ranked first.
        df = top_scorers(db_path, "test-comp")
        first_two = list(df["player_name"].iloc[:2])
        assert first_two == ["Alice", "Bob"]

    def test_limit_respected(self, db_path: Path) -> None:
        df = top_scorers(db_path, "test-comp", limit=2)
        assert len(df) == 2

    def test_rank_column_starts_at_one(self, db_path: Path) -> None:
        df = top_scorers(db_path, "test-comp")
        assert int(df.iloc[0]["rank"]) == 1

    def test_rank_sequential(self, db_path: Path) -> None:
        df = top_scorers(db_path, "test-comp")
        assert list(df["rank"].astype(int)) == list(range(1, len(df) + 1))

    def test_team_info_joined(self, db_path: Path) -> None:
        df = top_scorers(db_path, "test-comp")
        assert "Alpha FC" in df["team"].values
        assert "ALP" in df["team_code"].values

    def test_columns_present(self, db_path: Path) -> None:
        df = top_scorers(db_path, "test-comp")
        expected = {
            "rank", "player_name", "team", "team_code", "team_flag",
            "goals", "assists", "penalties",
        }
        assert expected.issubset(df.columns)

    def test_empty_for_unknown_competition(self, db_path: Path) -> None:
        df = top_scorers(db_path, "no-such-comp")
        assert df.empty

    def test_returns_dataframe(self, db_path: Path) -> None:
        df = top_scorers(db_path, "test-comp")
        assert isinstance(df, pd.DataFrame)

    def test_read_only_does_not_mutate(self, db_path: Path) -> None:
        top_scorers(db_path, "test-comp")
        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM scorers").fetchone()[0]
        conn.close()
        assert count == 4, "query must not modify the scorers table"


# ---------------------------------------------------------------------------
# recent_results
# ---------------------------------------------------------------------------


class TestRecentResults:
    def test_returns_only_played(self, db_path: Path) -> None:
        df = recent_results(db_path, "test-comp")
        assert df["match_id"].isin(["m1", "m5"]).all()

    def test_ordered_newest_first(self, db_path: Path) -> None:
        df = recent_results(db_path, "test-comp")
        assert list(df["match_id"]) == ["m1", "m5"]

    def test_limit_respected(self, db_path: Path) -> None:
        df = recent_results(db_path, "test-comp", limit=1)
        assert len(df) == 1

    def test_stage_filter(self, db_path: Path) -> None:
        df = recent_results(db_path, "test-comp", stage="group")
        assert all(df["stage"] == "group")

    def test_scores_populated(self, db_path: Path) -> None:
        df = recent_results(db_path, "test-comp")
        assert df["home_goals"].notna().all()
        assert df["away_goals"].notna().all()

    def test_columns_present(self, db_path: Path) -> None:
        df = recent_results(db_path, "test-comp")
        expected = {
            "match_id", "kickoff", "stage", "group_id",
            "home_team", "home_code", "home_flag", "home_goals", "away_goals",
            "away_team", "away_code", "away_flag",
        }
        assert expected.issubset(df.columns)

    def test_empty_for_unknown_competition(self, db_path: Path) -> None:
        df = recent_results(db_path, "no-such-comp")
        assert df.empty

    def test_read_only_does_not_mutate(self, db_path: Path) -> None:
        recent_results(db_path, "test-comp")
        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM matches WHERE played=1").fetchone()[0]
        conn.close()
        assert count == 2, "query must not modify the matches table"


# ---------------------------------------------------------------------------
# competition_table — read-only mutation guard (supplements existing tests)
# ---------------------------------------------------------------------------


class TestCompetitionTableMutation:
    def test_read_only_does_not_mutate(self, db_path: Path) -> None:
        competition_table(db_path, "test-comp")
        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM standings").fetchone()[0]
        conn.close()
        assert count == 4, "query must not modify the standings table"


# ---------------------------------------------------------------------------
# identity_coverage
# ---------------------------------------------------------------------------


class TestIdentityCoverage:
    def test_returns_dataframe(self, db_path: Path) -> None:
        df = identity_coverage(db_path)
        assert isinstance(df, pd.DataFrame)

    def test_columns_present(self, db_path: Path) -> None:
        df = identity_coverage(db_path)
        expected = {"source", "entity_type", "verified", "unverified", "unmatched", "total"}
        assert expected.issubset(df.columns)

    def test_entity_type_filter(self, db_path: Path) -> None:
        df = identity_coverage(db_path, entity_type="team")
        assert set(df["entity_type"]) == {"team"}

    def test_verified_count_correct(self, db_path: Path) -> None:
        # football-data source has 2 team rows both verified=1
        df = identity_coverage(db_path, entity_type="team")
        row = df[df["source"] == "football-data"].iloc[0]
        assert int(row["verified"]) == 2
        assert int(row["unverified"]) == 0

    def test_unverified_counted_separately(self, db_path: Path) -> None:
        # fbref: alice verified=1, bob verified=0
        df = identity_coverage(db_path, entity_type="player")
        fbref = df[df["source"] == "fbref"].iloc[0]
        assert int(fbref["verified"]) == 1
        assert int(fbref["unverified"]) == 1

    def test_unmatched_counted_separately(self, db_path: Path) -> None:
        # sofascore has one sentinel __unmatched__ row
        df = identity_coverage(db_path, entity_type="player")
        sofascore = df[df["source"] == "sofascore"].iloc[0]
        assert int(sofascore["unmatched"]) == 1
        assert int(sofascore["verified"]) == 0


# ---------------------------------------------------------------------------
# enriched_player_stats
# ---------------------------------------------------------------------------


class TestEnrichedPlayerStats:
    def test_returns_dataframe(self, db_path: Path) -> None:
        df = enriched_player_stats(db_path, "test-comp")
        assert isinstance(df, pd.DataFrame)

    def test_columns_present(self, db_path: Path) -> None:
        df = enriched_player_stats(db_path, "test-comp")
        expected = {
            "player_id", "display_name", "source", "team", "team_code",
            "matches_played", "minutes", "goals", "assists",
            "shots", "shots_on_target", "passes", "pass_accuracy",
        }
        assert expected.issubset(df.columns)

    def test_aggregate_rows_only(self, db_path: Path) -> None:
        # match_id IS NULL filter — per-match row for alice/m1 must be excluded
        df = enriched_player_stats(db_path, "test-comp")
        assert len(df) == 2, "only tournament-aggregate rows (match_id IS NULL) returned"

    def test_ordered_by_goals_desc(self, db_path: Path) -> None:
        df = enriched_player_stats(db_path, "test-comp")
        goals = list(df["goals"])
        assert goals == sorted(goals, reverse=True)

    def test_source_filter(self, db_path: Path) -> None:
        df = enriched_player_stats(db_path, "test-comp", source="fbref")
        assert df["source"].dropna().isin(["fbref"]).all()

    def test_display_name_from_identity_map(self, db_path: Path) -> None:
        df = enriched_player_stats(db_path, "test-comp")
        # alice has a verified fbref entry → display_name should be 'Alice Smith'
        alice_row = df[df["player_id"] == "alice"].iloc[0]
        assert alice_row["display_name"] == "Alice Smith"

    def test_limit_respected(self, db_path: Path) -> None:
        df = enriched_player_stats(db_path, "test-comp", limit=1)
        assert len(df) == 1

    def test_empty_for_unknown_competition(self, db_path: Path) -> None:
        df = enriched_player_stats(db_path, "no-such-comp")
        assert df.empty


# ---------------------------------------------------------------------------
# unmatched_entities
# ---------------------------------------------------------------------------


class TestUnmatchedEntities:
    def test_returns_only_unmatched(self, db_path: Path) -> None:
        df = unmatched_entities(db_path)
        # Only the sofascore sentinel row has canonical_id='__unmatched__'
        assert len(df) == 1

    def test_columns_present(self, db_path: Path) -> None:
        df = unmatched_entities(db_path)
        expected = {"id", "entity_type", "source", "source_id", "source_name", "notes"}
        assert expected.issubset(df.columns)

    def test_entity_type_filter(self, db_path: Path) -> None:
        df_player = unmatched_entities(db_path, entity_type="player")
        assert set(df_player["entity_type"]) == {"player"}

    def test_source_filter(self, db_path: Path) -> None:
        df = unmatched_entities(db_path, source="sofascore")
        assert len(df) == 1
        assert df.iloc[0]["source"] == "sofascore"

    def test_source_filter_no_match(self, db_path: Path) -> None:
        df = unmatched_entities(db_path, source="football-data")
        assert df.empty

    def test_empty_when_all_resolved(self, db_path: Path) -> None:
        df = unmatched_entities(db_path, entity_type="team")
        assert df.empty
