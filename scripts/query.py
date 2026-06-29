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


def recent_results(
    db_path: Path,
    competition_id: str = DEFAULT_COMPETITION,
    *,
    stage: str | None = None,
    limit: int = 10,
) -> pd.DataFrame:
    """Return recently played matches ordered newest-first, with scores.

    Args:
        db_path: Path to the SQLite database file.
        competition_id: Competition slug (default: 'fifa-wc-2026').
        stage: Optional stage filter — same values as upcoming_fixtures.
               If None, all stages are included.
        limit: Maximum rows to return.

    Returns:
        DataFrame with columns: match_id, kickoff, stage, group_id,
        home_team, home_code, home_flag, home_goals, away_goals,
        away_team, away_code, away_flag.
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
            m.home_goals,
            m.away_goals,
            at.name         AS away_team,
            at.code         AS away_code,
            at.flag         AS away_flag
        FROM  matches m
        JOIN  teams   ht ON ht.id = m.home_team_id
        JOIN  teams   at ON at.id = m.away_team_id
        WHERE m.competition_id = :competition_id
          AND m.played = 1
          {stage_clause}
        ORDER BY m.kickoff DESC
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


def identity_coverage(
    db_path: Path,
    *,
    entity_type: str | None = None,
) -> pd.DataFrame:
    """Return per-source identity mapping counts for audit purposes.

    Shows how many rows in identity_map are verified, unverified, or sentinel
    (unmatched) for each source.  Run this before joining enrichment data to
    catch gaps early.

    Args:
        db_path: Path to the SQLite database file.
        entity_type: Optional filter — 'team' or 'player'.  If None, all
                     entity types are aggregated together.

    Returns:
        DataFrame with columns: source, entity_type, verified,
        unverified, unmatched, total.
    """
    type_clause = "AND im.entity_type = :entity_type" if entity_type else ""
    sql = f"""
        SELECT
            im.source,
            im.entity_type,
            SUM(CASE WHEN im.canonical_id != '__unmatched__' AND im.verified = 1
                     THEN 1 ELSE 0 END)                    AS verified,
            SUM(CASE WHEN im.canonical_id != '__unmatched__' AND im.verified = 0
                     THEN 1 ELSE 0 END)                    AS unverified,
            SUM(CASE WHEN im.canonical_id  = '__unmatched__'
                     THEN 1 ELSE 0 END)                    AS unmatched,
            COUNT(*)                                        AS total
        FROM  identity_map im
        WHERE 1=1 {type_clause}
        GROUP BY im.source, im.entity_type
        ORDER BY im.entity_type, im.source
    """
    params: dict[str, object] = {}
    if entity_type:
        params["entity_type"] = entity_type

    with _read_conn(db_path) as conn:
        return pd.read_sql_query(sql, conn, params=params)


def enriched_player_stats(
    db_path: Path,
    competition_id: str = DEFAULT_COMPETITION,
    *,
    source: str | None = None,
    limit: int = 50,
) -> pd.DataFrame:
    """Return player_stats joined to canonical team and identity information.

    This is the canonical join pattern for enrichment data: player_stats rows
    use the canonical player_id slug (resolved via identity_map by the adapter
    layer) so the join is a simple foreign-key lookup.  The query also surfaces
    the source display name from identity_map for readability.

    Args:
        db_path: Path to the SQLite database file.
        competition_id: Competition slug (default: 'fifa-wc-2026').
        source: Optional enrichment source filter (e.g. 'sofascore', 'fbref').
                If None, one representative display name per player is used.
        limit: Maximum rows to return.

    Returns:
        DataFrame with columns: player_id, display_name, source, team,
        team_code, matches_played, minutes, goals, assists,
        shots, shots_on_target, passes, pass_accuracy.
    """
    source_join = "AND im.source = :source" if source else ""
    sql = f"""
        SELECT
            ps.player_id,
            COALESCE(im.source_name, ps.player_id)  AS display_name,
            im.source,
            t.name                                   AS team,
            t.code                                   AS team_code,
            ps.matches_played,
            ps.minutes,
            ps.goals,
            ps.assists,
            ps.shots,
            ps.shots_on_target,
            ps.passes,
            ps.pass_accuracy
        FROM  player_stats ps
        JOIN  teams         t  ON t.id = ps.team_id
        LEFT JOIN identity_map im
               ON im.canonical_id = ps.player_id
              AND im.entity_type  = 'player'
              AND im.verified     = 1
              {source_join}
        WHERE ps.competition_id = :competition_id
          AND ps.match_id IS NULL   -- tournament aggregate rows only
        ORDER BY ps.goals DESC, ps.minutes DESC
        LIMIT :limit
    """
    params: dict[str, object] = {
        "competition_id": competition_id,
        "limit": limit,
    }
    if source:
        params["source"] = source

    with _read_conn(db_path) as conn:
        return pd.read_sql_query(sql, conn, params=params)


def all_competitions(db_path: Path) -> pd.DataFrame:
    """Return all competitions stored in the database.

    Args:
        db_path: Path to the SQLite database file.

    Returns:
        DataFrame with columns: id, name, year, format, start_date, end_date.
    """
    sql = """
        SELECT id, name, year, format, start_date, end_date
        FROM   competitions
        ORDER BY year DESC
    """
    with _read_conn(db_path) as conn:
        return pd.read_sql_query(sql, conn)


def all_fixtures(
    db_path: Path,
    competition_id: str = DEFAULT_COMPETITION,
) -> pd.DataFrame:
    """Return all matches (played and unplayed) ordered by kickoff.

    Args:
        db_path: Path to the SQLite database file.
        competition_id: Competition slug (default: 'fifa-wc-2026').

    Returns:
        DataFrame with columns: match_id, kickoff, stage, group_id,
        home_team_id, home_team, home_code, home_flag, home_goals,
        away_team_id, away_team, away_code, away_flag, away_goals, played.
    """
    sql = """
        SELECT
            m.id            AS match_id,
            m.kickoff,
            m.stage,
            m.group_id,
            ht.id           AS home_team_id,
            ht.name         AS home_team,
            ht.code         AS home_code,
            ht.flag         AS home_flag,
            m.home_goals,
            at.id           AS away_team_id,
            at.name         AS away_team,
            at.code         AS away_code,
            at.flag         AS away_flag,
            m.away_goals,
            m.played
        FROM  matches m
        JOIN  teams   ht ON ht.id = m.home_team_id
        JOIN  teams   at ON at.id = m.away_team_id
        WHERE m.competition_id = :competition_id
        ORDER BY m.kickoff
    """
    with _read_conn(db_path) as conn:
        return pd.read_sql_query(
            sql, conn, params={"competition_id": competition_id}
        )


def all_player_ratings(
    db_path: Path,
    competition_id: str = DEFAULT_COMPETITION,
    *,
    limit: int = 1000,
) -> pd.DataFrame:
    """Return player ratings joined to canonical team information.

    Args:
        db_path: Path to the SQLite database file.
        competition_id: Competition slug (default: 'fifa-wc-2026').
        limit: Maximum rows to return.

    Returns:
        DataFrame with columns: player_id, team, team_code, match_id,
        source, rating.
    """
    sql = """
        SELECT
            pr.player_id,
            t.name      AS team,
            t.code      AS team_code,
            pr.match_id,
            pr.source,
            pr.rating
        FROM  player_ratings pr
        JOIN  teams           t  ON t.id = pr.team_id
        WHERE pr.competition_id = :competition_id
        ORDER BY pr.rating DESC NULLS LAST
        LIMIT :limit
    """
    with _read_conn(db_path) as conn:
        return pd.read_sql_query(
            sql,
            conn,
            params={"competition_id": competition_id, "limit": limit},
        )


def unmatched_entities(
    db_path: Path,
    *,
    entity_type: str | None = None,
    source: str | None = None,
) -> pd.DataFrame:
    """Return identity_map rows that could not be resolved (sentinel rows).

    These require human review: either add a mapping to identity.py's seed
    tables and re-run `python scripts/identity.py seed`, or manually UPDATE
    identity_map to set the correct canonical_id and verified=1.

    Args:
        db_path: Path to the SQLite database file.
        entity_type: Optional filter — 'team' or 'player'.
        source: Optional source filter (e.g. 'sofascore').

    Returns:
        DataFrame with columns: id, entity_type, source, source_id,
        source_name, notes.
    """
    clauses = ["im.canonical_id = '__unmatched__'"]
    params: dict[str, object] = {}
    if entity_type:
        clauses.append("im.entity_type = :entity_type")
        params["entity_type"] = entity_type
    if source:
        clauses.append("im.source = :source")
        params["source"] = source

    where = " AND ".join(clauses)
    sql = f"""
        SELECT
            im.id,
            im.entity_type,
            im.source,
            im.source_id,
            im.source_name,
            im.notes
        FROM identity_map im
        WHERE {where}
        ORDER BY im.entity_type, im.source, im.source_name
    """
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
        "Recent results — last 5 played matches",
        recent_results(db, limit=5),
    )
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
    _section(
        "Identity coverage — rows per source",
        identity_coverage(db),
    )


if __name__ == "__main__":
    main()
