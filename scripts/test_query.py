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

from query import competition_table, top_scorers, upcoming_fixtures


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
             NULL, NULL, '2026-01-10T12:00:00Z', 0, 'm4', NULL);

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
