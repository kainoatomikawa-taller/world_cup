#!/usr/bin/env python3
"""
ingest_stats.py — pull xG, advanced metrics, and player ratings from enrichment sources.

Fully isolated from ingest_api.py: a scraping failure here never touches the
backbone tables (competitions, teams, matches, standings, scorers).

Sources
-------
FBref  (soccerdata.FBref, BaseSeleniumReader — needs headless Chrome):
    - League 'INT-World Cup', season 2026.
    - read_player_season_stats('standard') → goals, assists, minutes, cards, xG, npxG, xAG.
    - read_player_season_stats('shooting')  → shots, shots_on_target, xG, npxG.
    - Writes to: player_stats (source='fbref').
    - soccerdata caches scraped HTML to ~/soccerdata/data/FBref/; re-runs are free.

Understat  (soccerdata.Understat, tls-client — not available on ARM64 today):
    - Covers European club leagues only (EPL, La Liga, Bundesliga, Serie A, Ligue 1).
      It does NOT have World Cup data.
    - Pulls the most recent club-season stats for players who appear in our
      identity_map as WC participants — useful as pre-tournament form context.
    - Writes to: player_stats (source='understat').
    - Requires the tls-client native library (v1.13.1).  If the library cannot
      be loaded (e.g. ARM64 binary missing), the source is skipped gracefully
      and a SKIP message is printed.

Sofascore  (soccerdata.Sofascore, tls-client — same ARM64 caveat):
    - soccerdata v1.9.0 exposes read_league_table and read_schedule only.
      There is no player-ratings endpoint in this version of the library.
    - Player ratings from Sofascore are a no-op with an informative message
      until the upstream library exposes that endpoint.
    - Writes to: player_ratings (source='sofascore') — no-op today.

Failure isolation
-----------------
Each source is wrapped in an independent try/except.  A failure in one source
does not affect the others.

Caching
-------
soccerdata stores scraped pages locally in ~/soccerdata/data/{Source}/.
Pass --no-cache to bypass the cache and fetch fresh data.

Usage
-----
    python scripts/ingest_stats.py
    python scripts/ingest_stats.py --db-path /custom/path/world_cup.db
    python scripts/ingest_stats.py --no-cache
    python scripts/ingest_stats.py --dry-run
    python scripts/ingest_stats.py --source fbref     # only run FBref
    python scripts/ingest_stats.py --source understat # only run Understat
    python scripts/ingest_stats.py --source sofascore # only run Sofascore

Prerequisites
-------------
    python scripts/init_db.py   # backbone schema must exist first
"""

from __future__ import annotations

import argparse
import math
import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "db" / "world_cup.db"

COMPETITION_ID = "fifa-wc-2026"
FBREF_LEAGUE = "INT-World Cup"
FBREF_SEASON = 2026

# Understat league names as soccerdata knows them (club football only).
# Run `sd.Understat().available_leagues()` to see the full list.
UNDERSTAT_LEAGUES = [
    "ENG-Premier League",
    "ESP-La Liga",
    "GER-Bundesliga",
    "ITA-Serie A",
    "FRA-Ligue 1",
]
UNDERSTAT_SEASON = "2425"  # club season 2024-25 (most recent before the 2026 WC)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


@contextmanager
def _conn(db_path: Path) -> Generator[sqlite3.Connection, None, None]:
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.row_factory = sqlite3.Row
    try:
        yield con
    finally:
        con.close()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Schema migration
# ---------------------------------------------------------------------------


def _ensure_player_stats_schema(conn: sqlite3.Connection) -> None:
    """Migrate player_stats to the Phase 2 schema (source, xg, xg_non_penalty, xa).

    The original Phase 1 schema has UNIQUE(competition_id, player_id, match_id).
    Phase 2 adds a `source` column and updates the constraint to
    UNIQUE(competition_id, player_id, match_id, source) so multiple enrichment
    sources can coexist.

    If the table is empty (first enrichment run), we drop and recreate it with
    the full Phase 2 schema.  If it already has rows from a previous enrichment
    run (already migrated), we skip.
    """
    cols = {row[1] for row in conn.execute("PRAGMA table_info(player_stats)").fetchall()}

    if "source" in cols:
        return  # already Phase 2

    row_count = conn.execute("SELECT COUNT(*) FROM player_stats").fetchone()[0]
    if row_count > 0:
        # Has data from the Phase 1 schema — add new columns with defaults.
        # The UNIQUE constraint can't be changed without recreation; callers
        # must manually recreate the table if multi-source write conflicts occur.
        print(
            "  [migration] player_stats has existing rows; adding new columns only.\n"
            "  (UNIQUE constraint stays as-is — recreate the table for full constraint update)"
        )
        for stmt in [
            "ALTER TABLE player_stats ADD COLUMN source TEXT NOT NULL DEFAULT 'fbref'",
            "ALTER TABLE player_stats ADD COLUMN xg REAL",
            "ALTER TABLE player_stats ADD COLUMN xg_non_penalty REAL",
            "ALTER TABLE player_stats ADD COLUMN xa REAL",
        ]:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # column added in an earlier partial run
    else:
        # Empty — safe to drop and recreate with the full Phase 2 schema.
        conn.executescript("""
            DROP TABLE IF EXISTS player_stats;
            CREATE TABLE player_stats (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                competition_id  TEXT    NOT NULL,
                player_id       TEXT    NOT NULL,
                team_id         TEXT    NOT NULL,
                match_id        TEXT,
                source          TEXT    NOT NULL DEFAULT 'fbref',
                matches_played  INTEGER DEFAULT 0,
                minutes         INTEGER DEFAULT 0,
                goals           INTEGER DEFAULT 0,
                assists         INTEGER DEFAULT 0,
                yellow_cards    INTEGER DEFAULT 0,
                red_cards       INTEGER DEFAULT 0,
                shots           INTEGER DEFAULT 0,
                shots_on_target INTEGER DEFAULT 0,
                xg              REAL,
                xg_non_penalty  REAL,
                xa              REAL,
                passes          INTEGER DEFAULT 0,
                pass_accuracy   REAL,
                updated_at      TEXT,
                UNIQUE(competition_id, player_id, match_id, source)
            );
        """)
        print("  [migration] player_stats recreated with Phase 2 schema")

    conn.commit()


def _check_schema(conn: sqlite3.Connection) -> None:
    """Abort if the backbone tables don't exist."""
    required = {"competitions", "teams", "identity_map", "player_stats", "player_ratings"}
    existing = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    missing = required - existing
    if missing:
        raise SystemExit(
            f"ERROR: required table(s) missing: {', '.join(sorted(missing))}.\n"
            "Run `python scripts/init_db.py` first to apply the schema."
        )


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _import_identity():
    """Import identity module from the scripts directory."""
    scripts_dir = Path(__file__).resolve().parent
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    import identity as _id
    return _id


def _int_or(val, default: int = 0) -> int:
    """Coerce to int; return `default` on None/NaN/error."""
    try:
        if val is None:
            return default
        if isinstance(val, float) and math.isnan(val):
            return default
        return int(val)
    except (TypeError, ValueError):
        return default


def _float_or(val) -> Optional[float]:
    """Coerce to float; return None on None/NaN/error."""
    try:
        if val is None:
            return None
        f = float(val)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _pick(row, candidates: list[tuple[str, str]]):
    """Try each (group, stat) tuple against a DataFrame row; return first hit or None.

    FBref DataFrames have MultiIndex columns (group, stat).  This helper
    tries each candidate in order and returns the first value that exists
    in the row.  Returns None when no candidate matches.
    """
    for group, stat in candidates:
        key = (group, stat) if stat else group
        try:
            val = row[key]
            # pandas NA / numpy nan → None
            if val is None:
                continue
            try:
                if math.isnan(float(val)):
                    continue
            except (TypeError, ValueError):
                pass
            return val
        except (KeyError, TypeError):
            continue
    return None


# ---------------------------------------------------------------------------
# FBref column map
# ---------------------------------------------------------------------------

# Each entry: (db_column, [(group, stat), ...])
# Multiple candidates handle FBref table layout variations across seasons.
_FBREF_STD_MAP: list[tuple[str, list[tuple[str, str]]]] = [
    ("matches_played",  [("Playing Time", "MP"), ("MP", "")]),
    ("minutes",         [("Playing Time", "Min"), ("Min", "")]),
    ("goals",           [("Performance", "Gls"), ("Gls", "")]),
    ("assists",         [("Performance", "Ast"), ("Ast", "")]),
    ("yellow_cards",    [("Performance", "CrdY"), ("CrdY", "")]),
    ("red_cards",       [("Performance", "CrdR"), ("CrdR", "")]),
    ("xg",              [("Expected", "xG"), ("xG", "")]),
    ("xg_non_penalty",  [("Expected", "npxG"), ("npxG", "")]),
    ("xa",              [("Expected", "xAG"), ("xAG", "")]),
]

_FBREF_SHOOT_MAP: list[tuple[str, list[tuple[str, str]]]] = [
    ("shots",           [("Standard", "Sh"), ("Sh", "")]),
    ("shots_on_target", [("Standard", "SoT"), ("SoT", "")]),
    # Prefer the shooting-table xG/npxG over the standard-table versions
    # (same formula but the shooting table is the canonical FBref source)
    ("xg",              [("Expected", "xG"), ("xG", "")]),
    ("xg_non_penalty",  [("Expected", "npxG"), ("npxG", "")]),
]


def _std_val(row, db_col: str):
    cands = next((c for n, c in _FBREF_STD_MAP if n == db_col), [])
    return _pick(row, cands)


def _shoot_val(row, db_col: str):
    cands = next((c for n, c in _FBREF_SHOOT_MAP if n == db_col), [])
    return _pick(row, cands)


# ---------------------------------------------------------------------------
# FBref ingest
# ---------------------------------------------------------------------------


def _fbref_to_records(
    df_std,
    df_shoot,
    conn: sqlite3.Connection,
    updated_at: str,
    *,
    dry_run: bool,
) -> list[tuple]:
    """Map FBref standard + shooting DataFrames → player_stats insert tuples.

    Both DataFrames share the index (league, season, team, player).
    The shooting DataFrame is looked up by index key for each standard row
    so the two stat groups are combined without a full join.
    """
    _id = _import_identity()

    # Build a fast index dict for shooting stats so we can look up by (league, season, team, player)
    shoot_index: dict = {}
    if df_shoot is not None:
        for idx, srow in df_shoot.iterrows():
            shoot_index[idx] = srow

    records: list[tuple] = []
    skipped = 0
    unresolved_teams: list[str] = []
    auto_slugged_players: list[str] = []

    for idx, std_row in df_std.iterrows():
        (league, season, team_name, player_name) = idx
        shoot_row = shoot_index.get(idx)  # None if player had 0 shots

        # ── Resolve team ──────────────────────────────────────────────────────
        team_slug = _id.slug_from_name(team_name)
        team_id = _id.resolve_team("fbref", team_slug, team_name, conn=conn)
        if not team_id:
            if team_name not in unresolved_teams:
                unresolved_teams.append(team_name)
            skipped += 1
            continue

        # ── Resolve player ────────────────────────────────────────────────────
        player_slug = _id.slug_from_name(player_name)
        player_id = _id.resolve_player("fbref", player_slug, player_name, conn=conn)
        if not player_id:
            # Auto-register from slug — WC players not yet in identity_map are trusted
            player_id = player_slug
            if not dry_run:
                conn.execute(
                    """
                    INSERT INTO identity_map
                        (canonical_id, entity_type, source, source_id, source_name, verified)
                    VALUES (?, 'player', 'fbref', ?, ?, 0)
                    ON CONFLICT(entity_type, source, source_id) DO NOTHING
                    """,
                    (player_id, player_slug, player_name),
                )
            auto_slugged_players.append(player_name)

        # ── Extract stats from standard table ─────────────────────────────────
        matches_played = _int_or(_std_val(std_row, "matches_played"))
        minutes        = _int_or(_std_val(std_row, "minutes"))
        goals          = _int_or(_std_val(std_row, "goals"))
        assists        = _int_or(_std_val(std_row, "assists"))
        yellow_cards   = _int_or(_std_val(std_row, "yellow_cards"))
        red_cards      = _int_or(_std_val(std_row, "red_cards"))
        xg             = _float_or(_std_val(std_row, "xg"))
        xg_np          = _float_or(_std_val(std_row, "xg_non_penalty"))
        xa             = _float_or(_std_val(std_row, "xa"))

        # ── Override with shooting-table values where available ───────────────
        # Shooting table provides more granular xG and shot counts.
        shots = 0
        sot   = 0
        if shoot_row is not None:
            shots = _int_or(_shoot_val(shoot_row, "shots"))
            sot   = _int_or(_shoot_val(shoot_row, "shots_on_target"))
            xg_s  = _float_or(_shoot_val(shoot_row, "xg"))
            npxg_s = _float_or(_shoot_val(shoot_row, "xg_non_penalty"))
            if xg_s is not None:
                xg = xg_s
            if npxg_s is not None:
                xg_np = npxg_s

        records.append((
            COMPETITION_ID,
            player_id,
            team_id,
            None,        # match_id=NULL → tournament aggregate
            "fbref",
            matches_played,
            minutes,
            goals,
            assists,
            yellow_cards,
            red_cards,
            shots,
            sot,
            xg,
            xg_np,
            xa,
            0,           # passes (not in standard/shooting stat types)
            None,        # pass_accuracy
            updated_at,
        ))

    if unresolved_teams:
        print(f"  WARNING: {len(unresolved_teams)} unresolved team(s): {unresolved_teams}")
    if auto_slugged_players:
        shown = auto_slugged_players[:5]
        tail  = f" … (+{len(auto_slugged_players) - 5} more)" if len(auto_slugged_players) > 5 else ""
        print(f"  NOTE: {len(auto_slugged_players)} player(s) auto-slugged (not yet in identity_map): {shown}{tail}")
    if skipped:
        print(f"  {skipped} rows skipped (team could not be resolved to a WC canonical slug)")

    return records


def ingest_fbref(
    conn: sqlite3.Connection,
    *,
    no_cache: bool = False,
    dry_run: bool = False,
) -> None:
    """Fetch FBref World Cup stats and write to player_stats (source='fbref')."""
    import soccerdata as sd

    print(f"\n[FBref] Reading player season stats for {FBREF_LEAGUE} {FBREF_SEASON} …")

    fbref = sd.FBref(
        leagues=FBREF_LEAGUE,
        seasons=FBREF_SEASON,
        no_cache=no_cache,
    )

    # Standard stats: goals, assists, minutes, cards, xG, npxG, xAG
    print("  Fetching standard stats (goals, assists, xG, cards) …")
    df_std = fbref.read_player_season_stats("standard")
    print(f"  Standard stats: {len(df_std)} player-rows")

    # Shooting stats: shots, shots_on_target, and more precise per-shot xG
    print("  Fetching shooting stats (shots, SoT, xG) …")
    try:
        df_shoot = fbref.read_player_season_stats("shooting")
        print(f"  Shooting stats: {len(df_shoot)} player-rows")
    except Exception as exc:
        print(f"  WARNING: shooting stats unavailable ({exc}); shot data will be 0")
        df_shoot = None

    updated_at = _now_iso()
    records = _fbref_to_records(df_std, df_shoot, conn, updated_at, dry_run=dry_run)

    if dry_run:
        print(f"  [dry-run] would upsert {len(records)} player_stats rows (source=fbref)")
        return

    conn.executemany(
        """
        INSERT INTO player_stats
            (competition_id, player_id, team_id, match_id, source,
             matches_played, minutes, goals, assists, yellow_cards, red_cards,
             shots, shots_on_target, xg, xg_non_penalty, xa,
             passes, pass_accuracy, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(competition_id, player_id, match_id, source) DO UPDATE SET
            matches_played  = excluded.matches_played,
            minutes         = excluded.minutes,
            goals           = excluded.goals,
            assists         = excluded.assists,
            yellow_cards    = excluded.yellow_cards,
            red_cards       = excluded.red_cards,
            shots           = excluded.shots,
            shots_on_target = excluded.shots_on_target,
            xg              = excluded.xg,
            xg_non_penalty  = excluded.xg_non_penalty,
            xa              = excluded.xa,
            updated_at      = excluded.updated_at
        """,
        records,
    )
    conn.commit()
    print(f"  {len(records)} player_stats rows upserted (source=fbref)")


# ---------------------------------------------------------------------------
# Understat ingest
# ---------------------------------------------------------------------------


def ingest_understat(
    conn: sqlite3.Connection,
    *,
    no_cache: bool = False,
    dry_run: bool = False,
) -> None:
    """Fetch Understat club-season xG stats for WC players → player_stats (source='understat').

    Understat covers European club leagues only (EPL, La Liga, Bundesliga,
    Serie A, Ligue 1).  It has no World Cup data.  This function pulls the
    most recent club-season stats (2024-25) for players who appear in our
    WC identity_map, providing useful pre-tournament form context.

    The team_id stored is the player's WC national team (looked up from
    scorers) so the row satisfies the FK constraint against the teams table
    while the source='understat' label makes it clear this is club data.

    Requires the tls-client native library (v1.13.1 ARM64 dylib).  If that
    library is missing, the source is skipped gracefully.
    """
    _id = _import_identity()

    print(f"\n[Understat] Reading club stats (season {UNDERSTAT_SEASON}) for WC players …")
    league_short = [l.split("-", 1)[-1] for l in UNDERSTAT_LEAGUES]
    print(f"  NOTE: Understat covers club leagues only ({', '.join(league_short)}).")
    print("  Only players already in identity_map (WC participants) are written.")

    try:
        import soccerdata as sd
        understat = sd.Understat(
            leagues=UNDERSTAT_LEAGUES,
            seasons=UNDERSTAT_SEASON,
            no_cache=no_cache,
        )
        df = understat.read_player_season_stats()
    except Exception as exc:
        msg = str(exc)
        if any(kw in msg.lower() for kw in ("tls", "library", "download", "dylib")):
            print(
                "  SKIP: Understat requires the tls-client native library (v1.13.1).\n"
                "  On ARM64 the binary is not available via auto-download.\n"
                "  Download manually: "
                "https://github.com/bogdanfinn/tls-client/releases/tag/v1.13.1"
            )
        else:
            print(f"  SKIP: Understat fetch failed — {exc}")
        return

    if df.empty:
        print("  No data returned from Understat.")
        return

    print(f"  Club stats: {len(df)} player-rows across all leagues")

    # Canonical player IDs from identity_map (WC participants only)
    known_players: set[str] = {
        row[0]
        for row in conn.execute(
            "SELECT DISTINCT canonical_id FROM identity_map "
            "WHERE entity_type='player' AND canonical_id != '__unmatched__'"
        ).fetchall()
    }

    # Precompute: canonical player_id → WC national team_id (from scorers table)
    wc_team_by_player: dict[str, str] = {
        row[0]: row[1]
        for row in conn.execute(
            "SELECT player_id, team_id FROM scorers WHERE competition_id = ?",
            (COMPETITION_ID,),
        ).fetchall()
    }

    updated_at = _now_iso()
    records: list[tuple] = []
    skipped_non_wc = 0
    skipped_no_team = 0

    for idx, row in df.iterrows():
        (league, season, team_name, player_name) = idx

        # Resolve to canonical WC player_id
        understat_player_id = str(row.get("player_id", ""))
        player_slug = _id.slug_from_name(player_name)
        player_id = _id.resolve_player(
            "understat", understat_player_id, player_name, conn=conn
        )
        if not player_id:
            player_id = player_slug

        # Skip players who are not WC participants
        if player_id not in known_players:
            skipped_non_wc += 1
            continue

        # Look up the player's WC national team for the FK reference
        team_id = wc_team_by_player.get(player_id)
        if not team_id:
            skipped_no_team += 1
            continue

        records.append((
            COMPETITION_ID,
            player_id,
            team_id,
            None,        # match_id=NULL → aggregate
            "understat",
            _int_or(row.get("matches")),
            _int_or(row.get("minutes")),
            _int_or(row.get("goals")),
            _int_or(row.get("assists")),
            _int_or(row.get("yellow_cards")),
            _int_or(row.get("red_cards")),
            _int_or(row.get("shots")),
            0,           # Understat does not track shots_on_target
            _float_or(row.get("xg")),
            _float_or(row.get("np_xg")),
            _float_or(row.get("xa")),
            0,           # passes not in Understat
            None,
            updated_at,
        ))

    if skipped_non_wc:
        print(f"  {skipped_non_wc} club-only players skipped (not in WC identity_map)")
    if skipped_no_team:
        print(f"  {skipped_no_team} WC players skipped (no entry in scorers table)")

    if dry_run:
        print(
            f"  [dry-run] would upsert {len(records)} player_stats rows (source=understat)"
        )
        return

    if not records:
        print("  No WC players found in Understat club data.")
        return

    conn.executemany(
        """
        INSERT INTO player_stats
            (competition_id, player_id, team_id, match_id, source,
             matches_played, minutes, goals, assists, yellow_cards, red_cards,
             shots, shots_on_target, xg, xg_non_penalty, xa,
             passes, pass_accuracy, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(competition_id, player_id, match_id, source) DO UPDATE SET
            matches_played  = excluded.matches_played,
            minutes         = excluded.minutes,
            goals           = excluded.goals,
            assists         = excluded.assists,
            yellow_cards    = excluded.yellow_cards,
            red_cards       = excluded.red_cards,
            shots           = excluded.shots,
            xg              = excluded.xg,
            xg_non_penalty  = excluded.xg_non_penalty,
            xa              = excluded.xa,
            updated_at      = excluded.updated_at
        """,
        records,
    )
    conn.commit()
    print(
        f"  {len(records)} player_stats rows upserted (source=understat)"
    )


# ---------------------------------------------------------------------------
# Sofascore ingest
# ---------------------------------------------------------------------------


def ingest_sofascore(
    conn: sqlite3.Connection,
    *,
    no_cache: bool = False,
    dry_run: bool = False,
) -> None:
    """Fetch Sofascore player ratings → player_ratings (source='sofascore').

    soccerdata v1.9.0 exposes only read_league_table and read_schedule for
    Sofascore.  A player-ratings endpoint is not yet available in this version.
    This function is a graceful no-op that will activate automatically once
    the upstream library exposes the required method.

    The tls-client library (v1.13.1) is also required for Sofascore; the same
    ARM64 binary availability constraint applies as for Understat.
    """
    print("\n[Sofascore] Checking for player ratings endpoint …")

    try:
        import soccerdata as sd
        sofascore = sd.Sofascore(no_cache=no_cache)
    except Exception as exc:
        msg = str(exc)
        if any(kw in msg.lower() for kw in ("tls", "library", "download", "dylib")):
            print(
                "  SKIP: Sofascore requires the tls-client native library (v1.13.1).\n"
                "  Download manually: "
                "https://github.com/bogdanfinn/tls-client/releases/tag/v1.13.1"
            )
        else:
            print(f"  SKIP: Sofascore initialisation failed — {exc}")
        return

    if not hasattr(sofascore, "read_player_ratings"):
        print(
            "  SKIP: soccerdata.Sofascore v1.9.0 does not expose a player-ratings\n"
            "  endpoint (only read_league_table and read_schedule are available).\n"
            "  The player_ratings table will remain empty for source='sofascore' until\n"
            "  the upstream library adds this method.\n"
            "  Upstream issue: https://github.com/probberechts/soccerdata"
        )
        return

    # --- Placeholder for when the library exposes read_player_ratings() ---
    # df = sofascore.read_player_ratings(leagues="FIFA World Cup", seasons=2026)
    # updated_at = _now_iso()
    # records = [...]
    # conn.executemany("INSERT INTO player_ratings ...", records)
    # conn.commit()
    print("  Sofascore player ratings ingest: method not yet available.")


# ---------------------------------------------------------------------------
# Schema guard and orchestration
# ---------------------------------------------------------------------------


def run(
    db_path: Path,
    *,
    sources: list[str],
    no_cache: bool = False,
    dry_run: bool = False,
) -> None:
    """Run the enrichment ingest for the requested sources."""
    with _conn(db_path) as conn:
        _check_schema(conn)
        _ensure_player_stats_schema(conn)

        if "fbref" in sources:
            try:
                ingest_fbref(conn, no_cache=no_cache, dry_run=dry_run)
            except Exception as exc:
                print(f"\n[FBref] ERROR — {exc}")
                print("  FBref ingest failed; backbone data is unaffected.")

        if "understat" in sources:
            try:
                ingest_understat(conn, no_cache=no_cache, dry_run=dry_run)
            except Exception as exc:
                print(f"\n[Understat] ERROR — {exc}")
                print("  Understat ingest failed; other sources are unaffected.")

        if "sofascore" in sources:
            try:
                ingest_sofascore(conn, no_cache=no_cache, dry_run=dry_run)
            except Exception as exc:
                print(f"\n[Sofascore] ERROR — {exc}")
                print("  Sofascore ingest failed; other sources are unaffected.")

    tag = "[dry-run] " if dry_run else ""
    print(f"\n{tag}Stats ingest complete → {db_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


ALL_SOURCES = ["fbref", "understat", "sofascore"]


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
    parser.add_argument(
        "--source",
        choices=ALL_SOURCES,
        metavar="SOURCE",
        action="append",
        dest="sources",
        help=(
            "Run only a specific enrichment source "
            f"({', '.join(ALL_SOURCES)}). "
            "Repeatable. Default: all sources."
        ),
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Bypass soccerdata's local page cache and fetch fresh data.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch data and print a summary without writing to the database.",
    )
    args = parser.parse_args()

    sources = args.sources if args.sources else ALL_SOURCES
    run(args.db_path, sources=sources, no_cache=args.no_cache, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
