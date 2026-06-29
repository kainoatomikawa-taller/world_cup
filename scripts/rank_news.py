#!/usr/bin/env python3
"""
rank_news.py — Phase 2: compute and write four-signal priority scores.

Reads all articles from the news table and the matches table, computes a
priority score for each story cluster using four signals, then writes an integer
priority (0–1000) back to the news table for every article.

Priority formula
----------------
    priority = (source_coverage × w1) + (recency_decay × w2)
             + (source_weight   × w3) + (fixture_relevance × w4)

    Default weights: w1=0.40, w2=0.25, w3=0.15, w4=0.20

    Each signal is in [0, 1]; the combined score is scaled to an integer in
    [0, 1000] before storage.

Signals
-------
source_coverage  — (distinct_sources − 1) / 3.  0 for a solo article,
                   1 when all four configured outlets cover the story.
                   Primary signal: cross-outlet reach indicates newsworthiness.

recency_decay    — 2^(−age_hours / 12).  1 at publication, 0.5 after 12 h,
                   0.25 after 24 h.  Keeps the feed fresh.

source_weight    — Best outlet tier across the cluster.  ESPN/BBC=1.0,
                   Sky/Fox=0.8, unknown=0.5.

fixture_relevance — Proximity to an upcoming (next 24 h) or just-played
                   (last 6 h) match involving a cluster team.  Scaled
                   linearly to 1 at kickoff time and multiplied by a
                   stage-importance factor (final=2×, semi=1.5×, etc.),
                   then capped at 1.0.  Articles covering imminent or
                   just-concluded big matches surface prominently.

Stability & idempotency
-----------------------
All articles in the same cluster receive the same priority.  Re-running the
script is safe and will update existing priority values.  Articles that have
no cluster_id (unclustered) are treated as singleton clusters.

Usage:
    python scripts/rank_news.py
    python scripts/rank_news.py --dry-run
    python scripts/rank_news.py --db-path /path/to.db
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import COMPETITION_ID, DEFAULT_DB

# ---------------------------------------------------------------------------
# Weights (must match newsRanking.ts DEFAULT_WEIGHTS)
# ---------------------------------------------------------------------------

W1_SOURCE_COVERAGE    = 0.40
W2_RECENCY_DECAY      = 0.25
W3_SOURCE_WEIGHT      = 0.15
W4_FIXTURE_RELEVANCE  = 0.20

# ---------------------------------------------------------------------------
# Signal constants
# ---------------------------------------------------------------------------

MAX_SOURCES = 4                  # number of configured RSS feeds
RECENCY_HALF_LIFE_HOURS = 12.0
UPCOMING_WINDOW_HOURS = 24
JUST_PLAYED_WINDOW_HOURS = 6

SOURCE_TIER_WEIGHTS: dict[str, float] = {
    "espn":       1.0,
    "bbc-sport":  1.0,
    "sky-sports": 0.8,
    "fox-sports": 0.8,
}
DEFAULT_SOURCE_WEIGHT = 0.5

STAGE_IMPORTANCE: dict[str, float] = {
    "final":             2.0,
    "semi":              1.5,
    "thirdPlacePlayoff": 1.2,
    "quarter":           1.3,
    "round16":           1.1,
    "round32":           1.05,
    "group":             1.0,
}

PRIORITY_SCALE = 1000   # float [0,1] → integer [0, 1000]

# ---------------------------------------------------------------------------
# Signal functions (mirror of newsRanking.ts)
# ---------------------------------------------------------------------------

def source_coverage_signal(distinct_source_count: int, max_sources: int = MAX_SOURCES) -> float:
    """Cross-outlet coverage: (n−1)/(max−1), clamped to [0, 1]."""
    if max_sources <= 1 or distinct_source_count <= 0:
        return 0.0
    return min(1.0, (distinct_source_count - 1) / (max_sources - 1))


def recency_decay_signal(
    most_recent_published_at: str,
    now: datetime,
    half_life_hours: float = RECENCY_HALF_LIFE_HOURS,
) -> float:
    """True half-life exponential freshness decay: 2^(−age_hours / half_life_hours).

    Score halves exactly every half_life_hours: 1.0 at age 0, 0.5 at 12 h,
    0.25 at 24 h.  Clamped to [0, 1] so future-dated articles don't inflate.
    """
    try:
        s = most_recent_published_at
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        age_hours = (now - dt.astimezone(timezone.utc)).total_seconds() / 3600
        return min(1.0, max(0.0, math.exp(-math.log(2) * age_hours / half_life_hours)))
    except (ValueError, AttributeError, OverflowError):
        return 0.0


def source_weight_signal(sources: list[str]) -> float:
    """Best outlet tier weight among all sources in the cluster."""
    return max((SOURCE_TIER_WEIGHTS.get(s, DEFAULT_SOURCE_WEIGHT) for s in sources), default=0.0)


def fixture_relevance_signal(
    teams: set[str],
    upcoming: list[dict],
    just_played: list[dict],
    now: datetime,
) -> float:
    """Proximity to an upcoming or just-finished match involving a cluster team.

    Args:
        teams:       Canonical team slugs mentioned across the cluster.
        upcoming:    Matches with played=0 and kickoff within the next 24 h.
        just_played: Matches with played=1 and kickoff within the last 6 h.
        now:         Current UTC datetime (aware).
    """
    best = 0.0
    now_utc = now.astimezone(timezone.utc)

    for match in upcoming:
        if match["home_team_id"] not in teams and match["away_team_id"] not in teams:
            continue
        try:
            kick_str = match["kickoff"]
            if kick_str.endswith("Z"):
                kick_str = kick_str[:-1] + "+00:00"
            kick = datetime.fromisoformat(kick_str).astimezone(timezone.utc)
        except (ValueError, AttributeError):
            continue
        hours_to_kick = (kick - now_utc).total_seconds() / 3600
        if 0 <= hours_to_kick <= UPCOMING_WINDOW_HOURS:
            raw = 1 - hours_to_kick / UPCOMING_WINDOW_HOURS
            stage_mult = STAGE_IMPORTANCE.get(match.get("stage", "group"), 1.0)
            best = max(best, min(1.0, raw * stage_mult))

    for match in just_played:
        if match["home_team_id"] not in teams and match["away_team_id"] not in teams:
            continue
        try:
            kick_str = match["kickoff"]
            if kick_str.endswith("Z"):
                kick_str = kick_str[:-1] + "+00:00"
            kick = datetime.fromisoformat(kick_str).astimezone(timezone.utc)
        except (ValueError, AttributeError):
            continue
        hours_after_kick = (now_utc - kick).total_seconds() / 3600
        if 0 <= hours_after_kick <= JUST_PLAYED_WINDOW_HOURS:
            raw = 1 - hours_after_kick / JUST_PLAYED_WINDOW_HOURS
            stage_mult = STAGE_IMPORTANCE.get(match.get("stage", "group"), 1.0)
            best = max(best, min(1.0, raw * stage_mult))

    return best


def compute_priority(
    distinct_sources: list[str],
    most_recent: str,
    teams: set[str],
    upcoming: list[dict],
    just_played: list[dict],
    now: datetime,
) -> int:
    """Combine four signals into an integer priority in [0, 1000]."""
    sc = source_coverage_signal(len(distinct_sources))
    rd = recency_decay_signal(most_recent, now)
    sw = source_weight_signal(distinct_sources)
    fr = fixture_relevance_signal(teams, upcoming, just_played, now)
    score = sc * W1_SOURCE_COVERAGE + rd * W2_RECENCY_DECAY + sw * W3_SOURCE_WEIGHT + fr * W4_FIXTURE_RELEVANCE
    return round(score * PRIORITY_SCALE)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _load_relevant_matches(
    conn: sqlite3.Connection,
    competition_id: str,
    now: datetime,
) -> tuple[list[dict], list[dict]]:
    """Return (upcoming, just_played) match dicts for fixture_relevance scoring."""
    now_utc = now.astimezone(timezone.utc)
    upcoming_cutoff = (now_utc + timedelta(hours=UPCOMING_WINDOW_HOURS)).isoformat()
    past_cutoff = (now_utc - timedelta(hours=JUST_PLAYED_WINDOW_HOURS)).isoformat()

    upcoming = [
        {"id": r[0], "stage": r[1], "kickoff": r[2], "home_team_id": r[3], "away_team_id": r[4]}
        for r in conn.execute(
            """
            SELECT id, stage, kickoff, home_team_id, away_team_id
            FROM matches
            WHERE competition_id = ?
              AND played = 0
              AND kickoff >= ?
              AND kickoff <= ?
            """,
            (competition_id, now_utc.isoformat(), upcoming_cutoff),
        ).fetchall()
    ]

    just_played = [
        {"id": r[0], "stage": r[1], "kickoff": r[2], "home_team_id": r[3], "away_team_id": r[4]}
        for r in conn.execute(
            """
            SELECT id, stage, kickoff, home_team_id, away_team_id
            FROM matches
            WHERE competition_id = ?
              AND played = 1
              AND kickoff >= ?
            """,
            (competition_id, past_cutoff),
        ).fetchall()
    ]

    return upcoming, just_played


def _load_articles(conn: sqlite3.Connection, competition_id: str) -> list[dict]:
    """Load all news rows relevant to this competition."""
    rows = conn.execute(
        """
        SELECT id, cluster_id, source, published_at, teams
        FROM news
        WHERE competition_id = ? OR competition_id IS NULL
        """,
        (competition_id,),
    ).fetchall()
    articles = []
    for row in rows:
        art_id, cluster_id, source, published_at, teams_json = row
        try:
            teams: list[str] = json.loads(teams_json or "[]")
        except (json.JSONDecodeError, TypeError):
            teams = []
        articles.append({
            "id": art_id,
            "cluster_id": cluster_id,
            "source": source or "",
            "published_at": published_at or "",
            "teams": teams,
        })
    return articles


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run(
    db_path: Path,
    competition_id: str = COMPETITION_ID,
    dry_run: bool = False,
) -> None:
    """Load articles, score clusters, and write priorities to the news table."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        now = datetime.now(timezone.utc)
        articles = _load_articles(conn, competition_id)
        if not articles:
            print("No articles to rank — news table is empty.")
            return

        print(f"Loaded {len(articles)} article(s).")

        upcoming, just_played = _load_relevant_matches(conn, competition_id, now)
        print(f"  Fixture windows: {len(upcoming)} upcoming, {len(just_played)} just-played.")

        # Group by cluster_id (articles with cluster_id=NULL each form their own cluster).
        clusters: dict[str, list[dict]] = defaultdict(list)
        for a in articles:
            key = a["cluster_id"] or f"__solo__{a['id']}"
            clusters[key].append(a)

        # Compute priority for each cluster; update all member articles.
        updates: list[tuple[int, str]] = []
        n_multi = 0
        for _key, members in clusters.items():
            distinct_sources = list({a["source"] for a in members})
            most_recent = max((a["published_at"] for a in members), default="")
            teams: set[str] = {t for a in members for t in a["teams"]}

            priority = compute_priority(distinct_sources, most_recent, teams, upcoming, just_played, now)
            if len(members) > 1:
                n_multi += 1
            for a in members:
                updates.append((priority, a["id"]))

        print(
            f"  Scored {len(clusters)} cluster(s) ({n_multi} multi-article, "
            f"{len(clusters) - n_multi} solo)."
        )

        if dry_run:
            scores = sorted({p for p, _ in updates}, reverse=True)[:5]
            print(f"  [dry-run] top priority values: {scores}")
            print("[dry-run] No changes written.")
            return

        conn.executemany("UPDATE news SET priority = ? WHERE id = ?", updates)
        conn.commit()
        print(f"Done — priority written for {len(updates)} article(s).")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--db-path", default=DEFAULT_DB, type=Path, metavar="PATH",
                        help=f"SQLite database (default: {DEFAULT_DB})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute scores but do not write to the database")
    args = parser.parse_args()
    run(args.db_path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
