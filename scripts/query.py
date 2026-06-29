#!/usr/bin/env python3
"""
query.py — read-only query functions over the World Cup Insights SQLite store.

All public functions accept a path to the database and return pandas DataFrames.
They never write to the database; the connection is opened in read-only URI mode.

Usage:
    python scripts/query.py                          # end-to-end demo
    python scripts/query.py --db-path /path/to.db
"""

from __future__ import annotations

import argparse
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "db" / "world_cup.db"
DEFAULT_COMPETITION = "fifa-wc-2026"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


@contextmanager
def _read_conn(db_path: Path) -> Generator[sqlite3.Connection, None, None]:
    """Yield a read-only SQLite connection that is always closed on exit."""
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Public query functions
# ---------------------------------------------------------------------------


def upcoming_fixtures(
    db_path: Path,
    competition_id: str = DEFAULT_COMPETITION,
    *,
    stage: str | None = None,
    limit: int = 10,
) -> pd.DataFrame:
    """Return the next unplayed fixtures ordered by kickoff time.

    Args:
        db_path: Path to the SQLite database file.
        competition_id: Competition slug (default: 'fifa-wc-2026').
        stage: Optional stage filter — 'group', 'round32', 'round16',
               'quarter', 'semi', 'thirdPlacePlayoff', or 'final'.
               If None, all stages are included.
        limit: Maximum rows to return.

    Returns:
        DataFrame with columns: match_id, kickoff, stage, group_id,
        home_team, home_code, home_flag, away_team, away_code, away_flag.
    """
    stage_clause = "AND m.stage = :stage" if stage else ""
    sql = f"""
        SELECT
            m.id            AS match_id,
            m.kickoff,
            m.stage,
            m.group_id,
            ht.name         AS home_team,
            ht.code         AS home_code,
            ht.flag         AS home_flag,
            at.name         AS away_team,
            at.code         AS away_code,
            at.flag         AS away_flag
        FROM  matches m
        JOIN  teams   ht ON ht.id = m.home_team_id
        JOIN  teams   at ON at.id = m.away_team_id
        WHERE m.competition_id = :competition_id
          AND m.played = 0
          {stage_clause}
        ORDER BY m.kickoff
        LIMIT :limit
    """
    params: dict[str, object] = {
        "competition_id": competition_id,
        "limit": limit,
    }
    if stage:
        params["stage"] = stage

    with _read_conn(db_path) as conn:
        return pd.read_sql_query(sql, conn, params=params)


def competition_table(
    db_path: Path,
    competition_id: str = DEFAULT_COMPETITION,
    *,
    group_id: str | None = None,
) -> pd.DataFrame:
    """Return group-stage standings ordered by group then position.

    Args:
        db_path: Path to the SQLite database file.
        competition_id: Competition slug (default: 'fifa-wc-2026').
        group_id: Single uppercase letter 'A'–'L'.  If None, all groups
                  are returned.

    Returns:
        DataFrame with columns: group_id, position, team, code, flag,
        played, won, drawn, lost, goals_for, goals_against,
        goal_diff, points.
    """
    group_clause = "AND s.group_id = :group_id" if group_id else ""
    sql = f"""
        SELECT
            s.group_id,
            s.position,
            t.name                                  AS team,
            t.code,
            t.flag,
            s.played,
            s.won,
            s.drawn,
            s.lost,
            s.goals_for,
            s.goals_against,
            s.goals_for - s.goals_against           AS goal_diff,
            s.points
        FROM  standings s
        JOIN  teams     t ON t.id = s.team_id
        WHERE s.competition_id = :competition_id
          {group_clause}
        ORDER BY s.group_id, s.position NULLS LAST, s.points DESC
    """
    params: dict[str, object] = {"competition_id": competition_id}
    if group_id:
        params["group_id"] = group_id.upper()

    with _read_conn(db_path) as conn:
        return pd.read_sql_query(sql, conn, params=params)


def top_scorers(
    db_path: Path,
    competition_id: str = DEFAULT_COMPETITION,
    *,
    limit: int = 20,
) -> pd.DataFrame:
    """Return the leading scorers in the competition.

    Primary sort: goals descending.
    Tiebreak: assists descending.

    Args:
        db_path: Path to the SQLite database file.
        competition_id: Competition slug (default: 'fifa-wc-2026').
        limit: Maximum rows to return.

    Returns:
        DataFrame with columns: rank, player_name, team, team_code,
        team_flag, goals, assists, penalties.
    """
    sql = """
        SELECT
            ROW_NUMBER() OVER (
                ORDER BY sc.goals DESC, sc.assists DESC
            )                   AS rank,
            sc.player_name,
            t.name              AS team,
            t.code              AS team_code,
            t.flag              AS team_flag,
            sc.goals,
            sc.assists,
            sc.penalties
        FROM  scorers sc
        JOIN  teams   t ON t.id = sc.team_id
        WHERE sc.competition_id = :competition_id
        ORDER BY sc.goals DESC, sc.assists DESC
        LIMIT :limit
    """
    params: dict[str, object] = {
        "competition_id": competition_id,
        "limit": limit,
    }
    with _read_conn(db_path) as conn:
        return pd.read_sql_query(sql, conn, params=params)


# ---------------------------------------------------------------------------
# CLI demo — proves the end-to-end ingest → query loop
# ---------------------------------------------------------------------------


def _section(title: str, df: pd.DataFrame) -> None:
    bar = "─" * 72
    print(f"\n{bar}")
    print(f"  {title}  ({len(df)} rows)")
    print(bar)
    if df.empty:
        print("  (no rows)")
    else:
        print(df.to_string(index=False))


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db-path",
        default=DEFAULT_DB,
        type=Path,
        metavar="PATH",
        help=f"SQLite database file (default: {DEFAULT_DB})",
    )
    args = parser.parse_args()
    db: Path = args.db_path

    _section(
        "Upcoming fixtures — next 8 across all stages",
        upcoming_fixtures(db, limit=8),
    )
    _section(
        "Group A standings",
        competition_table(db, group_id="A"),
    )
    _section(
        "Top 10 scorers",
        top_scorers(db, limit=10),
    )


if __name__ == "__main__":
    main()
