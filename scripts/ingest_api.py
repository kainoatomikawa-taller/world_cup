#!/usr/bin/env python3
"""
ingest_api.py — pull football-data.org data into SQLite.

Fetches competition info, teams, matches, standings, and scorers for the
2026 FIFA World Cup and upserts them into the backbone SQLite tables.

Rate limit: the free tier allows 10 req/min.  A 7-second sleep between
every HTTP call keeps us within that limit (≈ 8.5 req/min headroom).
Five API calls are made per run; total wall time ≈ 35 s.

Usage:
    python scripts/ingest_api.py
    python scripts/ingest_api.py --db-path /custom/path/world_cup.db
    python scripts/ingest_api.py --dry-run   # fetch + summarise, no writes

Prerequisite:
    python scripts/init_db.py   # apply schema before first ingest

Dependencies (already in scripts/.venv):
    requests
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from config import (
    API_BASE,
    COMPETITION_CODE,
    COMPETITION_ID,
    DEFAULT_DB,
    REQUEST_DELAY,
    SEASON,
    load_api_key,
)
from identity import normalize_name, register_unmatched, resolve_team as _identity_resolve_team, seed_identity_map

# ---------------------------------------------------------------------------
# Static team data — mirrors src/data/schedule2026.ts exactly so that
# the slug identifiers are identical across the TypeScript and Python layers.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _TeamDef:
    id: str
    name: str
    code: str
    group_id: str
    flag: str


_TEAMS: list[_TeamDef] = [
    _TeamDef("mexico",                 "Mexico",                 "MEX", "A", "🇲🇽"),
    _TeamDef("south-africa",           "South Africa",           "RSA", "A", "🇿🇦"),
    _TeamDef("south-korea",            "South Korea",            "KOR", "A", "🇰🇷"),
    _TeamDef("czech-republic",         "Czech Republic",         "CZE", "A", "🇨🇿"),
    _TeamDef("canada",                 "Canada",                 "CAN", "B", "🇨🇦"),
    _TeamDef("bosnia-and-herzegovina", "Bosnia and Herzegovina", "BIH", "B", "🇧🇦"),
    _TeamDef("qatar",                  "Qatar",                  "QAT", "B", "🇶🇦"),
    _TeamDef("switzerland",            "Switzerland",            "SUI", "B", "🇨🇭"),
    _TeamDef("brazil",                 "Brazil",                 "BRA", "C", "🇧🇷"),
    _TeamDef("morocco",                "Morocco",                "MAR", "C", "🇲🇦"),
    _TeamDef("haiti",                  "Haiti",                  "HAI", "C", "🇭🇹"),
    _TeamDef("scotland",               "Scotland",               "SCO", "C", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"),
    _TeamDef("united-states",          "United States",          "USA", "D", "🇺🇸"),
    _TeamDef("paraguay",               "Paraguay",               "PAR", "D", "🇵🇾"),
    _TeamDef("australia",              "Australia",              "AUS", "D", "🇦🇺"),
    _TeamDef("turkey",                 "Turkey",                 "TUR", "D", "🇹🇷"),
    _TeamDef("germany",                "Germany",                "GER", "E", "🇩🇪"),
    _TeamDef("curacao",                "Curaçao",                "CUW", "E", "🇨🇼"),
    _TeamDef("ivory-coast",            "Ivory Coast",            "CIV", "E", "🇨🇮"),
    _TeamDef("ecuador",                "Ecuador",                "ECU", "E", "🇪🇨"),
    _TeamDef("netherlands",            "Netherlands",            "NED", "F", "🇳🇱"),
    _TeamDef("japan",                  "Japan",                  "JPN", "F", "🇯🇵"),
    _TeamDef("sweden",                 "Sweden",                 "SWE", "F", "🇸🇪"),
    _TeamDef("tunisia",                "Tunisia",                "TUN", "F", "🇹🇳"),
    _TeamDef("belgium",                "Belgium",                "BEL", "G", "🇧🇪"),
    _TeamDef("egypt",                  "Egypt",                  "EGY", "G", "🇪🇬"),
    _TeamDef("iran",                   "Iran",                   "IRN", "G", "🇮🇷"),
    _TeamDef("new-zealand",            "New Zealand",            "NZL", "G", "🇳🇿"),
    _TeamDef("spain",                  "Spain",                  "ESP", "H", "🇪🇸"),
    _TeamDef("cape-verde",             "Cape Verde",             "CPV", "H", "🇨🇻"),
    _TeamDef("saudi-arabia",           "Saudi Arabia",           "KSA", "H", "🇸🇦"),
    _TeamDef("uruguay",                "Uruguay",                "URU", "H", "🇺🇾"),
    _TeamDef("france",                 "France",                 "FRA", "I", "🇫🇷"),
    _TeamDef("senegal",                "Senegal",                "SEN", "I", "🇸🇳"),
    _TeamDef("iraq",                   "Iraq",                   "IRQ", "I", "🇮🇶"),
    _TeamDef("norway",                 "Norway",                 "NOR", "I", "🇳🇴"),
    _TeamDef("argentina",              "Argentina",              "ARG", "J", "🇦🇷"),
    _TeamDef("algeria",                "Algeria",                "ALG", "J", "🇩🇿"),
    _TeamDef("austria",                "Austria",                "AUT", "J", "🇦🇹"),
    _TeamDef("jordan",                 "Jordan",                 "JOR", "J", "🇯🇴"),
    _TeamDef("portugal",               "Portugal",               "POR", "K", "🇵🇹"),
    _TeamDef("dr-congo",               "DR Congo",               "COD", "K", "🇨🇩"),
    _TeamDef("uzbekistan",             "Uzbekistan",             "UZB", "K", "🇺🇿"),
    _TeamDef("colombia",               "Colombia",               "COL", "K", "🇨🇴"),
    _TeamDef("england",                "England",                "ENG", "L", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"),
    _TeamDef("croatia",                "Croatia",                "CRO", "L", "🇭🇷"),
    _TeamDef("ghana",                  "Ghana",                  "GHA", "L", "🇬🇭"),
    _TeamDef("panama",                 "Panama",                 "PAN", "L", "🇵🇦"),
]

# TLA overrides: football-data.org sometimes uses different 3-letter codes.
_TLA_OVERRIDES: dict[str, str] = {
    "SAU": "saudi-arabia",  # upstream sometimes emits SAU; our canonical code is KSA
    "IRN": "iran",          # double-cover for 'IR Iran' display variants
    "KSA": "saudi-arabia",
}

# Build fast lookup tables once at import time.
_TLA_TO_SLUG: dict[str, str] = {t.code.upper(): t.id for t in _TEAMS}
_TLA_TO_SLUG.update(_TLA_OVERRIDES)

_NAME_TO_SLUG: dict[str, str] = {t.name.lower(): t.id for t in _TEAMS}
_NAME_TO_SLUG.update({
    "republic of korea":           "south-korea",
    "czechia":                     "czech-republic",
    "usa":                         "united-states",
    "turkiye":                     "turkey",
    "cote d'ivoire":               "ivory-coast",
    "côte d'ivoire":               "ivory-coast",
    "ir iran":                     "iran",
    "democratic republic of congo": "dr-congo",
    "congo dr":                    "dr-congo",
    "curacao":                     "curacao",  # without cedilla
})

# Stage name mapping: football-data.org → domain Stage type (src/domain/types.ts)
_STAGE_MAP: dict[str, str] = {
    "GROUP_STAGE":          "group",
    "LAST_32":              "round32",
    "LAST_16":              "round16",
    "QUARTER_FINALS":       "quarter",
    "SEMI_FINALS":          "semi",
    "THIRD_PLACE":          "thirdPlacePlayoff",
    "THIRD_PLACE_PLAY_OFF": "thirdPlacePlayoff",
    "FINAL":                "final",
}

# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slugify(name: str) -> str:
    """Return a URL-safe slug, e.g. 'Kylian Mbappé' → 'kylian-mbappe'."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^\w\s-]", "", ascii_str.lower()).strip()
    return re.sub(r"[\s_-]+", "-", slug)


def _resolve_team(tla: str, name: str, short_name: str = "") -> str | None:
    """Return the canonical team slug from a TLA/name pair, or None."""
    slug = _TLA_TO_SLUG.get(tla.upper())
    if slug:
        return slug
    slug = _NAME_TO_SLUG.get(name.lower())
    if slug:
        return slug
    if short_name:
        slug = _NAME_TO_SLUG.get(short_name.lower())
    return slug


def _parse_group(raw: str | None) -> str | None:
    """Extract group letter from various API formats, or None.

    Handles both football-data.org formats:
    - matches endpoint: 'GROUP_A'
    - standings endpoint: 'Group A'
    """
    if not raw:
        return None
    # Remove known prefixes then take the last non-space token.
    cleaned = raw.replace("GROUP_", "").replace("Group ", "").strip()
    letter = cleaned[-1] if cleaned else ""
    return letter if re.match(r"^[A-L]$", letter) else None


# ---------------------------------------------------------------------------
# HTTP client with built-in rate limiting
# ---------------------------------------------------------------------------

class ApiClient:
    """Thin wrapper around requests.Session that enforces inter-request delays."""

    def __init__(self, api_key: str, delay: float = REQUEST_DELAY) -> None:
        self._delay = delay
        self._last: float = 0.0
        self._session = requests.Session()
        self._session.headers.update({"X-Auth-Token": api_key})

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        """GET an API endpoint; sleep as needed to respect the rate limit."""
        elapsed = time.monotonic() - self._last
        gap = self._delay - elapsed
        if gap > 0:
            print(f"  [rate-limit] sleeping {gap:.1f}s …")
            time.sleep(gap)

        url = f"{API_BASE}{path}"
        qs = f" params={params}" if params else ""
        print(f"  GET {url}{qs}")

        resp = self._session.get(url, params=params or None, timeout=30)
        self._last = time.monotonic()

        if resp.status_code == 429:
            retry_after = int(resp.headers.get("X-RequestCounter-Reset", 60))
            print(f"  [429] upstream rate-limited — sleeping {retry_after}s then retrying")
            time.sleep(retry_after)
            resp = self._session.get(url, params=params or None, timeout=30)
            self._last = time.monotonic()

        if resp.status_code == 403:
            raise SystemExit("ERROR: API key rejected (403). Check FOOTBALL_API_KEY.")

        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        return data


# ---------------------------------------------------------------------------
# Ingest functions — each function owns one table
# ---------------------------------------------------------------------------

def _seed_teams(conn: sqlite3.Connection, dry_run: bool) -> None:
    """Upsert the 48 canonical teams and populate identity_map with all known aliases."""
    rows = [
        (t.id, COMPETITION_ID, t.name, t.code, t.group_id, t.flag)
        for t in _TEAMS
    ]
    if dry_run:
        print(f"  [dry-run] would upsert {len(rows)} teams")
        print(f"  [dry-run] would seed identity_map with all source name aliases")
        return
    conn.executemany(
        """
        INSERT INTO teams (id, competition_id, name, code, group_id, flag)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            competition_id = excluded.competition_id,
            name           = excluded.name,
            code           = excluded.code,
            group_id       = excluded.group_id,
            flag           = excluded.flag
        """,
        rows,
    )
    conn.commit()
    print(f"  {len(rows)} teams upserted")
    # Populate identity_map with all known name aliases across all sources.
    inserted, _ = seed_identity_map(conn)
    print(f"  {inserted} identity alias rows seeded (football-data, fbref, understat, sofascore)")


def _ingest_competition(
    conn: sqlite3.Connection,
    data: dict[str, Any],
    dry_run: bool,
) -> None:
    """Write one competition row for fifa-wc-2026."""
    season = data.get("currentSeason") or {}
    row = (
        COMPETITION_ID,
        data.get("name", "FIFA World Cup"),
        2026,
        "48-team",
        season.get("startDate"),
        season.get("endDate"),
    )
    if dry_run:
        print(f"  [dry-run] would upsert competition {row}")
        return
    conn.execute(
        """
        INSERT INTO competitions (id, name, year, format, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name       = excluded.name,
            start_date = excluded.start_date,
            end_date   = excluded.end_date
        """,
        row,
    )
    conn.commit()
    print(f"  competition '{COMPETITION_ID}' upserted")


def _ingest_team_identity(
    conn: sqlite3.Connection,
    data: dict[str, Any],
    dry_run: bool,
) -> None:
    """Map football-data.org integer team IDs → canonical slugs in identity_map."""
    teams = data.get("teams", [])
    rows: list[tuple[str, str, str, str, str]] = []
    unresolved: list[str] = []

    for t in teams:
        fd_id = str(t.get("id", ""))
        tla = (t.get("tla") or "").upper()
        name = t.get("name") or ""
        short = t.get("shortName") or ""
        # Try legacy inline resolver first, then fall back to identity module
        slug = _resolve_team(tla, name, short)
        if not slug:
            slug = _identity_resolve_team("football-data", fd_id, name, conn=conn)
        if not slug:
            unresolved.append(f"{tla}/{name}")
            if not dry_run:
                register_unmatched("team", "football-data", fd_id, name,
                                   notes=f"tla={tla}", conn=conn)
            continue
        rows.append((slug, "team", "football-data", fd_id, name))

    if dry_run:
        print(
            f"  [dry-run] would upsert {len(rows)} team identity entries"
            f" ({len(unresolved)} unresolved)"
        )
        if unresolved:
            print(f"  unresolved: {unresolved}")
        return

    conn.executemany(
        """
        INSERT INTO identity_map
            (canonical_id, entity_type, source, source_id, source_name, verified)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(entity_type, source, source_id) DO UPDATE SET
            canonical_id = excluded.canonical_id,
            source_name  = excluded.source_name,
            verified     = 1
        """,
        rows,
    )
    conn.commit()
    print(
        f"  {len(rows)} team identity rows upserted"
        + (f"; WARNING {len(unresolved)} unresolved: {unresolved}" if unresolved else "")
    )


def _ingest_matches(
    conn: sqlite3.Connection,
    data: dict[str, Any],
    dry_run: bool,
) -> None:
    """Upsert all matches; rows are keyed on the upstream integer id."""
    matches = data.get("matches", [])
    fetched_at = _now_iso()
    rows: list[tuple[Any, ...]] = []
    skipped = 0

    for m in matches:
        stage_raw: str = m.get("stage") or ""
        stage = _STAGE_MAP.get(stage_raw)
        if not stage:
            print(f"  WARNING unknown stage '{stage_raw}' for match {m.get('id')} — skipped")
            skipped += 1
            continue

        ht: dict[str, Any] = m.get("homeTeam") or {}
        at: dict[str, Any] = m.get("awayTeam") or {}
        home_id = _resolve_team(
            ht.get("tla") or "", ht.get("name") or "", ht.get("shortName") or ""
        )
        away_id = _resolve_team(
            at.get("tla") or "", at.get("name") or "", at.get("shortName") or ""
        )

        if not home_id or not away_id:
            print(
                f"  WARNING unresolved team(s) for match {m.get('id')}: "
                f"home={ht.get('tla')}/{ht.get('name')} "
                f"away={at.get('tla')}/{at.get('name')} — skipped"
            )
            skipped += 1
            continue

        played = m.get("status") == "FINISHED"
        ft: dict[str, Any] = (m.get("score") or {}).get("fullTime") or {}
        # Guard `!= None` (not just falsy) so a 0-0 scoreline isn't discarded.
        home_goals: int | None = ft.get("home") if played and ft.get("home") is not None else None
        away_goals: int | None = ft.get("away") if played and ft.get("away") is not None else None

        rows.append((
            str(m["id"]),       # id (PK)
            COMPETITION_ID,
            stage,
            _parse_group(m.get("group")),
            home_id,
            away_id,
            home_goals,
            away_goals,
            m.get("utcDate", ""),
            int(played),
            str(m["id"]),       # source_id
            fetched_at,
        ))

    if dry_run:
        print(f"  [dry-run] would upsert {len(rows)} matches ({skipped} skipped)")
        return

    conn.executemany(
        """
        INSERT INTO matches
            (id, competition_id, stage, group_id, home_team_id, away_team_id,
             home_goals, away_goals, kickoff, played, source_id, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            stage        = excluded.stage,
            group_id     = excluded.group_id,
            home_goals   = excluded.home_goals,
            away_goals   = excluded.away_goals,
            kickoff      = excluded.kickoff,
            played       = excluded.played,
            fetched_at   = excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    played_count = sum(1 for r in rows if r[9])
    print(f"  {len(rows)} matches upserted ({played_count} played, {skipped} skipped)")


def _ingest_standings(
    conn: sqlite3.Connection,
    data: dict[str, Any],
    dry_run: bool,
) -> None:
    """Upsert TOTAL-type group standings; one row per (competition, group, team)."""
    updated_at = _now_iso()
    rows: list[tuple[Any, ...]] = []
    skipped = 0

    for block in data.get("standings", []):
        if block.get("type") != "TOTAL":
            continue  # skip HOME/AWAY splits if present

        group_id = _parse_group(block.get("group"))
        if not group_id:
            continue  # knockout-round blocks have no group letter

        for entry in block.get("table", []):
            team_raw: dict[str, Any] = entry.get("team") or {}
            tla = (team_raw.get("tla") or "").upper()
            name = team_raw.get("name") or ""
            team_id = _resolve_team(tla, name)
            if not team_id:
                print(f"  WARNING unresolved standing team {tla}/{name} — skipped")
                skipped += 1
                continue

            rows.append((
                COMPETITION_ID,
                group_id,
                team_id,
                entry.get("playedGames", 0),
                entry.get("won", 0),
                entry.get("draw", 0),   # API key is 'draw', column is 'drawn'
                entry.get("lost", 0),
                entry.get("goalsFor", 0),
                entry.get("goalsAgainst", 0),
                entry.get("points", 0),
                entry.get("position"),
                updated_at,
            ))

    if dry_run:
        print(f"  [dry-run] would upsert {len(rows)} standing rows ({skipped} skipped)")
        return

    conn.executemany(
        """
        INSERT INTO standings
            (competition_id, group_id, team_id, played, won, drawn, lost,
             goals_for, goals_against, points, position, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(competition_id, group_id, team_id) DO UPDATE SET
            played        = excluded.played,
            won           = excluded.won,
            drawn         = excluded.drawn,
            lost          = excluded.lost,
            goals_for     = excluded.goals_for,
            goals_against = excluded.goals_against,
            points        = excluded.points,
            position      = excluded.position,
            updated_at    = excluded.updated_at
        """,
        rows,
    )
    conn.commit()
    print(f"  {len(rows)} standing rows upserted ({skipped} skipped)")


def _ingest_scorers(
    conn: sqlite3.Connection,
    data: dict[str, Any],
    dry_run: bool,
) -> None:
    """Upsert top scorers; also seed player entries in identity_map."""
    updated_at = _now_iso()
    rows: list[tuple[Any, ...]] = []
    id_rows: list[tuple[str, str, str, str, str]] = []
    skipped = 0

    for s in data.get("scorers", []):
        player: dict[str, Any] = s.get("player") or {}
        team_raw: dict[str, Any] = s.get("team") or {}
        tla = (team_raw.get("tla") or "").upper()
        team_name = team_raw.get("name") or ""
        team_id = _resolve_team(tla, team_name)
        if not team_id:
            print(f"  WARNING unresolved scorer's team {tla}/{team_name} — skipped")
            skipped += 1
            continue

        player_name = player.get("name") or ""
        fd_player_id = str(player.get("id") or "")
        player_id = _slugify(player_name) if player_name else f"player-{fd_player_id or 'unknown'}"

        rows.append((
            COMPETITION_ID,
            player_id,
            player_name,
            team_id,
            s.get("goals") or 0,
            s.get("assists") or 0,
            s.get("penalties") or 0,
            updated_at,
        ))

        if fd_player_id:
            id_rows.append((player_id, "player", "football-data", fd_player_id, player_name))

    if dry_run:
        print(f"  [dry-run] would upsert {len(rows)} scorers ({skipped} skipped)")
        return

    conn.executemany(
        """
        INSERT INTO scorers
            (competition_id, player_id, player_name, team_id,
             goals, assists, penalties, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(competition_id, player_id) DO UPDATE SET
            player_name = excluded.player_name,
            team_id     = excluded.team_id,
            goals       = excluded.goals,
            assists     = excluded.assists,
            penalties   = excluded.penalties,
            updated_at  = excluded.updated_at
        """,
        rows,
    )
    if id_rows:
        conn.executemany(
            """
            INSERT INTO identity_map
                (canonical_id, entity_type, source, source_id, source_name, verified)
            VALUES (?, ?, ?, ?, ?, 0)
            ON CONFLICT(entity_type, source, source_id) DO UPDATE SET
                source_name = excluded.source_name
            """,
            id_rows,
        )
    conn.commit()
    print(f"  {len(rows)} scorers upserted ({skipped} skipped); {len(id_rows)} player identity entries")


# ---------------------------------------------------------------------------
# Schema guard
# ---------------------------------------------------------------------------

def _check_schema(conn: sqlite3.Connection) -> None:
    """Abort if the backbone tables don't exist yet."""
    required = {"competitions", "teams", "matches", "standings", "scorers"}
    existing = {
        row[0]
        for row in conn.execute(
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
# Orchestration
# ---------------------------------------------------------------------------

def run(db_path: Path, dry_run: bool) -> None:
    """Fetch from football-data.org and upsert into SQLite."""
    api_key = load_api_key()

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    _check_schema(conn)

    client = ApiClient(api_key)

    # ── 1 ── Competition metadata ─────────────────────────────────────────
    print("\n[1/6] Fetching competition metadata …")
    comp_data = client.get(f"/competitions/{COMPETITION_CODE}")
    _ingest_competition(conn, comp_data, dry_run)

    # ── 2 ── Seed teams (static list, no API call) ────────────────────────
    print("\n[2/6] Seeding teams from static list …")
    _seed_teams(conn, dry_run)

    # ── 3 ── Team identity mapping ────────────────────────────────────────
    print("\n[3/6] Fetching teams for identity_map …")
    teams_data = client.get(f"/competitions/{COMPETITION_CODE}/teams", season=SEASON)
    _ingest_team_identity(conn, teams_data, dry_run)

    # ── 4 ── Matches ──────────────────────────────────────────────────────
    print("\n[4/6] Fetching matches …")
    matches_data = client.get(f"/competitions/{COMPETITION_CODE}/matches", season=SEASON)
    _ingest_matches(conn, matches_data, dry_run)

    # ── 5 ── Standings ────────────────────────────────────────────────────
    # Note: the standings endpoint rejects `season` for WC; omit it.
    print("\n[5/6] Fetching standings …")
    standings_data = client.get(f"/competitions/{COMPETITION_CODE}/standings")
    _ingest_standings(conn, standings_data, dry_run)

    # ── 6 ── Scorers ──────────────────────────────────────────────────────
    print("\n[6/6] Fetching top scorers …")
    scorers_data = client.get(
        f"/competitions/{COMPETITION_CODE}/scorers",
        season=SEASON,
        limit=100,
    )
    _ingest_scorers(conn, scorers_data, dry_run)

    conn.close()
    tag = "[dry-run] " if dry_run else ""
    print(f"\n{tag}Ingest complete → {db_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

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
        "--dry-run",
        action="store_true",
        help="Fetch from the API and print a summary without writing to the database",
    )
    args = parser.parse_args()
    run(args.db_path, args.dry_run)


if __name__ == "__main__":
    main()
