#!/usr/bin/env python3
"""
identity.py — cross-source identity reconciliation for teams and players.

Unifies identities across football-data.org, FBref, Understat, and Sofascore
by combining three resolution strategies in priority order:

    1. DB-first: check identity_map for a confirmed or previously-seen mapping.
    2. Static seeds: look up in pre-built alias tables for all four sources.
    3. Fuzzy fallback (players only): normalise + difflib against known players
       already in the database (scorers + player_stats tables).

Unmatched entities are written to identity_map with canonical_id='__unmatched__'
so they surface in the review report rather than being silently dropped.

CLI usage:
    python scripts/identity.py seed [--db-path PATH] [--dry-run]
    python scripts/identity.py report [--db-path PATH]
"""

from __future__ import annotations

import argparse
import difflib
import re
import sqlite3
import unicodedata
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Generator, Optional

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "db" / "world_cup.db"

SENTINEL = "__unmatched__"  # canonical_id written for entities we cannot resolve

# ---------------------------------------------------------------------------
# Canonical team registry — must match src/data/schedule2026.ts and ingest_api.py
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _TeamDef:
    id: str    # canonical slug
    name: str  # canonical display name
    code: str  # our 3-letter code (may differ from any single source's TLA)


_TEAMS: list[_TeamDef] = [
    # Group A
    _TeamDef("mexico",                 "Mexico",                 "MEX"),
    _TeamDef("south-africa",           "South Africa",           "RSA"),
    _TeamDef("south-korea",            "South Korea",            "KOR"),
    _TeamDef("czech-republic",         "Czech Republic",         "CZE"),
    # Group B
    _TeamDef("canada",                 "Canada",                 "CAN"),
    _TeamDef("bosnia-and-herzegovina", "Bosnia and Herzegovina", "BIH"),
    _TeamDef("qatar",                  "Qatar",                  "QAT"),
    _TeamDef("switzerland",            "Switzerland",            "SUI"),
    # Group C
    _TeamDef("brazil",                 "Brazil",                 "BRA"),
    _TeamDef("morocco",                "Morocco",                "MAR"),
    _TeamDef("haiti",                  "Haiti",                  "HAI"),
    _TeamDef("scotland",               "Scotland",               "SCO"),
    # Group D
    _TeamDef("united-states",          "United States",          "USA"),
    _TeamDef("paraguay",               "Paraguay",               "PAR"),
    _TeamDef("australia",              "Australia",              "AUS"),
    _TeamDef("turkey",                 "Turkey",                 "TUR"),
    # Group E
    _TeamDef("germany",                "Germany",                "GER"),
    _TeamDef("curacao",                "Curaçao",                "CUW"),
    _TeamDef("ivory-coast",            "Ivory Coast",            "CIV"),
    _TeamDef("ecuador",                "Ecuador",                "ECU"),
    # Group F
    _TeamDef("netherlands",            "Netherlands",            "NED"),
    _TeamDef("japan",                  "Japan",                  "JPN"),
    _TeamDef("sweden",                 "Sweden",                 "SWE"),
    _TeamDef("tunisia",                "Tunisia",                "TUN"),
    # Group G
    _TeamDef("belgium",                "Belgium",                "BEL"),
    _TeamDef("egypt",                  "Egypt",                  "EGY"),
    _TeamDef("iran",                   "Iran",                   "IRN"),
    _TeamDef("new-zealand",            "New Zealand",            "NZL"),
    # Group H
    _TeamDef("spain",                  "Spain",                  "ESP"),
    _TeamDef("cape-verde",             "Cape Verde",             "CPV"),
    _TeamDef("saudi-arabia",           "Saudi Arabia",           "KSA"),
    _TeamDef("uruguay",                "Uruguay",                "URU"),
    # Group I
    _TeamDef("france",                 "France",                 "FRA"),
    _TeamDef("senegal",                "Senegal",                "SEN"),
    _TeamDef("iraq",                   "Iraq",                   "IRQ"),
    _TeamDef("norway",                 "Norway",                 "NOR"),
    # Group J
    _TeamDef("argentina",              "Argentina",              "ARG"),
    _TeamDef("algeria",                "Algeria",                "ALG"),
    _TeamDef("austria",                "Austria",                "AUT"),
    _TeamDef("jordan",                 "Jordan",                 "JOR"),
    # Group K
    _TeamDef("portugal",               "Portugal",               "POR"),
    _TeamDef("dr-congo",               "DR Congo",               "COD"),
    _TeamDef("uzbekistan",             "Uzbekistan",             "UZB"),
    _TeamDef("colombia",               "Colombia",               "COL"),
    # Group L
    _TeamDef("england",                "England",                "ENG"),
    _TeamDef("croatia",                "Croatia",                "CRO"),
    _TeamDef("ghana",                  "Ghana",                  "GHA"),
    _TeamDef("panama",                 "Panama",                 "PAN"),
]

# ---------------------------------------------------------------------------
# Fast lookup tables built at import time
# ---------------------------------------------------------------------------

# code → slug (our canonical codes)
_CODE_TO_SLUG: dict[str, str] = {t.code.upper(): t.id for t in _TEAMS}

# normalized name → slug (canonical names)
_NORM_TO_SLUG: dict[str, str] = {}
for _t in _TEAMS:
    _NORM_TO_SLUG[_t.name.lower()] = _t.id

# All canonical slugs as a set (for fast membership tests)
_ALL_SLUGS: frozenset[str] = frozenset(t.id for t in _TEAMS)

# ---------------------------------------------------------------------------
# Known name aliases per source
# ---------------------------------------------------------------------------
# Each tuple: (canonical_slug, source, source_name)
# source_id in the DB will be the slugified source_name unless the source
# provides an integer ID (in which case the caller supplies it separately).
#
# Sources:
#   "football-data"  football-data.org (primary backbone)
#   "fbref"          FBref / Sports-Reference
#   "understat"      Understat (primarily club football; included for player tracking)
#   "sofascore"      Sofascore

_TEAM_NAME_SEEDS: list[tuple[str, str, str]] = [
    # ── football-data.org name variants ─────────────────────────────────────
    # (their integer team IDs are seeded separately by ingest_api.py)
    ("south-korea",            "football-data", "Republic of Korea"),
    ("south-korea",            "football-data", "Korea Republic"),
    ("czech-republic",         "football-data", "Czechia"),
    ("united-states",          "football-data", "USA"),
    ("turkey",                 "football-data", "Türkiye"),
    ("turkey",                 "football-data", "Turkiye"),
    ("ivory-coast",            "football-data", "Côte d'Ivoire"),
    ("ivory-coast",            "football-data", "Cote d'Ivoire"),
    ("ivory-coast",            "football-data", "Cote dIvoire"),
    ("dr-congo",               "football-data", "Congo DR"),
    ("dr-congo",               "football-data", "Democratic Republic of Congo"),
    ("curacao",                "football-data", "Curaçao"),
    ("iran",                   "football-data", "IR Iran"),
    ("iran",                   "football-data", "Islamic Republic of Iran"),
    ("saudi-arabia",           "football-data", "Saudi Arabia"),
    ("bosnia-and-herzegovina", "football-data", "Bosnia-Herzegovina"),
    ("bosnia-and-herzegovina", "football-data", "Bosnia & Herzegovina"),
    ("cape-verde",             "football-data", "Cape Verde Islands"),
    ("new-zealand",            "football-data", "New Zealand"),
    # ── FBref / Sports-Reference name variants ───────────────────────────────
    # FBref typically uses FIFA-official names; key divergences noted below.
    ("south-korea",            "fbref", "Korea Republic"),
    ("south-korea",            "fbref", "South Korea"),
    ("czech-republic",         "fbref", "Czech Republic"),
    ("czech-republic",         "fbref", "Czechia"),
    ("united-states",          "fbref", "United States"),
    ("united-states",          "fbref", "USA"),
    ("turkey",                 "fbref", "Türkiye"),
    ("turkey",                 "fbref", "Turkiye"),
    ("turkey",                 "fbref", "Turkey"),
    ("ivory-coast",            "fbref", "Côte d'Ivoire"),
    ("ivory-coast",            "fbref", "Ivory Coast"),
    ("dr-congo",               "fbref", "Congo DR"),
    ("dr-congo",               "fbref", "DR Congo"),
    ("dr-congo",               "fbref", "Democratic Republic of Congo"),
    ("dr-congo",               "fbref", "Congo, DR"),
    ("curacao",                "fbref", "Curaçao"),
    ("curacao",                "fbref", "Curacao"),
    ("iran",                   "fbref", "IR Iran"),
    ("iran",                   "fbref", "Iran"),
    ("saudi-arabia",           "fbref", "Saudi Arabia"),
    ("bosnia-and-herzegovina", "fbref", "Bosnia-Herzegovina"),
    ("bosnia-and-herzegovina", "fbref", "Bosnia & Herzegovina"),
    ("bosnia-and-herzegovina", "fbref", "Bosnia and Herzegovina"),
    ("cape-verde",             "fbref", "Cape Verde Islands"),
    ("cape-verde",             "fbref", "Cape Verde"),
    ("new-zealand",            "fbref", "New Zealand"),
    ("netherlands",            "fbref", "Netherlands"),
    ("south-africa",           "fbref", "South Africa"),
    # ── Sofascore name variants ──────────────────────────────────────────────
    ("united-states",          "sofascore", "USA"),
    ("united-states",          "sofascore", "United States"),
    ("south-korea",            "sofascore", "South Korea"),
    ("south-korea",            "sofascore", "Korea Republic"),
    ("czech-republic",         "sofascore", "Czech Republic"),
    ("czech-republic",         "sofascore", "Czechia"),
    ("turkey",                 "sofascore", "Türkiye"),
    ("turkey",                 "sofascore", "Turkiye"),
    ("turkey",                 "sofascore", "Turkey"),
    ("ivory-coast",            "sofascore", "Ivory Coast"),
    ("ivory-coast",            "sofascore", "Côte d'Ivoire"),
    ("ivory-coast",            "sofascore", "Cote d'Ivoire"),
    ("dr-congo",               "sofascore", "DR Congo"),
    ("dr-congo",               "sofascore", "Congo DR"),
    ("dr-congo",               "sofascore", "Democratic Republic of Congo"),
    ("curacao",                "sofascore", "Curaçao"),
    ("curacao",                "sofascore", "Curacao"),
    ("iran",                   "sofascore", "IR Iran"),
    ("iran",                   "sofascore", "Iran"),
    ("saudi-arabia",           "sofascore", "Saudi Arabia"),
    ("bosnia-and-herzegovina", "sofascore", "Bosnia & Herzegovina"),
    ("bosnia-and-herzegovina", "sofascore", "Bosnia-Herzegovina"),
    ("bosnia-and-herzegovina", "sofascore", "Bosnia and Herzegovina"),
    ("cape-verde",             "sofascore", "Cape Verde"),
    ("cape-verde",             "sofascore", "Cape Verde Islands"),
    ("new-zealand",            "sofascore", "New Zealand"),
    ("netherlands",            "sofascore", "Netherlands"),
    ("south-africa",           "sofascore", "South Africa"),
    # ── Understat name variants ──────────────────────────────────────────────
    # Understat tracks club football; national team names appear in player
    # nationality fields and some international competition contexts.
    ("united-states",          "understat", "USA"),
    ("united-states",          "understat", "United States"),
    ("south-korea",            "understat", "Korea Republic"),
    ("south-korea",            "understat", "South Korea"),
    ("czech-republic",         "understat", "Czech Republic"),
    ("czech-republic",         "understat", "Czechia"),
    ("turkey",                 "understat", "Turkiye"),
    ("turkey",                 "understat", "Turkey"),
    ("ivory-coast",            "understat", "Ivory Coast"),
    ("ivory-coast",            "understat", "Cote d'Ivoire"),
    ("dr-congo",               "understat", "DR Congo"),
    ("dr-congo",               "understat", "Congo DR"),
    ("iran",                   "understat", "Iran"),
    ("curacao",                "understat", "Curacao"),
    ("saudi-arabia",           "understat", "Saudi Arabia"),
    ("bosnia-and-herzegovina", "understat", "Bosnia-Herzegovina"),
    ("bosnia-and-herzegovina", "understat", "Bosnia and Herzegovina"),
    ("cape-verde",             "understat", "Cape Verde"),
    ("netherlands",            "understat", "Netherlands"),
    ("south-africa",           "understat", "South Africa"),
]

# ---------------------------------------------------------------------------
# Name normalisation utilities
# ---------------------------------------------------------------------------


def normalize_name(name: str) -> str:
    """Strip accents, lowercase, and collapse whitespace.

    'Kylian Mbappé'  → 'kylian mbappe'
    'Côte d'Ivoire'  → "cote d'ivoire"
    """
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_str.lower()).strip()


def slug_from_name(name: str) -> str:
    """Return a URL-safe slug suitable for use as a canonical player_id."""
    normalised = normalize_name(name)
    slug = re.sub(r"[^\w\s-]", "", normalised)
    return re.sub(r"[\s_-]+", "-", slug).strip("-")


# Build a normalized → slug lookup for all seed names
_SEED_NORM_TO_SLUG: dict[tuple[str, str], str] = {}  # (source, norm_name) → canonical_id
for _slug, _source, _sname in _TEAM_NAME_SEEDS:
    _SEED_NORM_TO_SLUG[(f"{_source}", normalize_name(_sname))] = _slug

# Also allow source-agnostic canonical-name lookup
_CANON_NORM_TO_SLUG: dict[str, str] = {normalize_name(t.name): t.id for t in _TEAMS}

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


@contextmanager
def _conn(db_path: Path) -> Generator[sqlite3.Connection, None, None]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        yield con
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Core resolution: teams
# ---------------------------------------------------------------------------


def resolve_team(
    source: str,
    source_id: str,
    source_name: str = "",
    *,
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Path] = None,
) -> Optional[str]:
    """Return the canonical team slug for a given source identifier.

    Resolution order:
      1. identity_map lookup by (source, source_id).
      2. Static seed table — exact match on normalized source_name.
      3. Normalized canonical name match (source-agnostic fallback).
      4. Code / TLA match for our canonical 3-letter codes.

    Returns None if no mapping can be found; the caller should then call
    register_unmatched() to surface the entity for manual review.
    """
    close_after = False
    if conn is None:
        if db_path is None:
            db_path = DEFAULT_DB
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        close_after = True

    try:
        # 1. DB lookup by source_id
        row = conn.execute(
            "SELECT canonical_id FROM identity_map "
            "WHERE entity_type='team' AND source=? AND source_id=? "
            "AND canonical_id != ?",
            (source, source_id, SENTINEL),
        ).fetchone()
        if row:
            return row["canonical_id"]

        # 2. DB lookup by normalized source_name
        if source_name:
            norm = normalize_name(source_name)
            row = conn.execute(
                "SELECT canonical_id FROM identity_map "
                "WHERE entity_type='team' AND source=? AND lower(source_name)=? "
                "AND canonical_id != ?",
                (source, norm, SENTINEL),
            ).fetchone()
            if row:
                return row["canonical_id"]

        # 3. Static seed: (source, normalized name)
        if source_name:
            norm = normalize_name(source_name)
            slug = _SEED_NORM_TO_SLUG.get((source, norm))
            if slug:
                return slug
            # Cross-source fallback: try every source's seed table
            slug = _CANON_NORM_TO_SLUG.get(norm)
            if slug:
                return slug

        # 4. TLA / code match (source_id treated as a code when it's 2–3 uppercase letters)
        if len(source_id) in (2, 3) and source_id.isalpha():
            slug = _CODE_TO_SLUG.get(source_id.upper())
            if slug:
                return slug

        return None

    finally:
        if close_after:
            conn.close()


# ---------------------------------------------------------------------------
# Core resolution: players
# ---------------------------------------------------------------------------


def resolve_player(
    source: str,
    source_id: str,
    source_name: str = "",
    *,
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Path] = None,
    fuzzy_threshold: float = 0.82,
) -> Optional[str]:
    """Return the canonical player slug for a given source identifier.

    Resolution order:
      1. identity_map lookup by (source, source_id).
      2. identity_map lookup by normalized source_name.
      3. Fuzzy match against known players in scorers + player_stats.

    The fuzzy stage uses:
      - difflib.SequenceMatcher on normalized full names.
      - Initial-expansion: 'K. Mbappe' matches 'Kylian Mbappe' when last-name
        matches exactly and the first initial matches the candidate's first name.

    Returns None when no confident match is found.
    """
    close_after = False
    if conn is None:
        if db_path is None:
            db_path = DEFAULT_DB
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        close_after = True

    try:
        # 1. DB lookup by source_id
        row = conn.execute(
            "SELECT canonical_id FROM identity_map "
            "WHERE entity_type='player' AND source=? AND source_id=? "
            "AND canonical_id != ?",
            (source, source_id, SENTINEL),
        ).fetchone()
        if row:
            return row["canonical_id"]

        # 2. DB lookup by normalized source_name
        if source_name:
            norm = normalize_name(source_name)
            row = conn.execute(
                "SELECT canonical_id FROM identity_map "
                "WHERE entity_type='player' AND source=? AND lower(source_name)=? "
                "AND canonical_id != ?",
                (source, norm, SENTINEL),
            ).fetchone()
            if row:
                return row["canonical_id"]

        # 3. Fuzzy match against scorers + player_stats
        if source_name:
            return _fuzzy_player(conn, source_name, fuzzy_threshold)

        return None

    finally:
        if close_after:
            conn.close()


def _fuzzy_player(
    conn: sqlite3.Connection,
    source_name: str,
    threshold: float,
) -> Optional[str]:
    """Fuzzy-match source_name against all known canonical players.

    Builds a candidate list from scorers and player_stats, then scores via:
      - Normalized full-name similarity (SequenceMatcher).
      - Initial-expansion heuristic for abbreviated first names.
    """
    rows = conn.execute(
        """
        SELECT player_id AS pid, player_name AS pname FROM scorers
        UNION
        SELECT player_id AS pid, player_id AS pname FROM player_stats
        """
    ).fetchall()

    norm_query = normalize_name(source_name)

    best_slug: Optional[str] = None
    best_score: float = 0.0

    for row in rows:
        pid: str = row["pid"]
        # Also check identity_map for the canonical display name of this player
        id_row = conn.execute(
            "SELECT source_name FROM identity_map WHERE canonical_id=? AND entity_type='player' LIMIT 1",
            (pid,),
        ).fetchone()
        candidate_name = id_row["source_name"] if id_row else pid.replace("-", " ")

        score = _name_similarity(norm_query, normalize_name(candidate_name))
        if score > best_score:
            best_score = score
            best_slug = pid

    if best_score >= threshold:
        return best_slug
    return None


def _name_similarity(a: str, b: str) -> float:
    """Score similarity between two normalized player name strings.

    Combines SequenceMatcher with an initial-expansion heuristic so that
    "c. ronaldo" (abbreviated first name) boosts to 0.90 when the last name
    matches exactly and the first initial matches the candidate's first name.
    """
    base = difflib.SequenceMatcher(None, a, b).ratio()

    # Initial-expansion: handle "k. mbappe" / "c. ronaldo" style abbreviations.
    parts_a = a.split()
    parts_b = b.split()
    if len(parts_a) >= 2 and len(parts_b) >= 2:
        last_a, last_b = parts_a[-1], parts_b[-1]
        if last_a == last_b:
            init_a = parts_a[0].rstrip(".")  # strip trailing period from "c."
            init_b = parts_b[0].rstrip(".")
            # Match if one is a single-character prefix of the other
            if init_a and init_b and (
                init_a == init_b[0] or init_b == init_a[0]
            ):
                base = max(base, 0.90)

    return base


# ---------------------------------------------------------------------------
# Register unmatched entities
# ---------------------------------------------------------------------------


def register_unmatched(
    entity_type: str,
    source: str,
    source_id: str,
    source_name: str = "",
    notes: str = "",
    *,
    conn: sqlite3.Connection,
) -> None:
    """Write a sentinel row to identity_map for human review.

    Uses ON CONFLICT DO NOTHING so repeated calls for the same entity are
    idempotent — the first encounter is what gets recorded.
    """
    conn.execute(
        """
        INSERT INTO identity_map
            (canonical_id, entity_type, source, source_id, source_name, verified, notes)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(entity_type, source, source_id) DO NOTHING
        """,
        (SENTINEL, entity_type, source, source_id, source_name or None, notes or None),
    )


# ---------------------------------------------------------------------------
# Seeding: pre-populate identity_map with all known alias rows
# ---------------------------------------------------------------------------


def seed_identity_map(
    conn: sqlite3.Connection,
    *,
    dry_run: bool = False,
) -> tuple[int, int]:
    """Insert all statically-known team name aliases into identity_map.

    For each canonical team × source combination this also inserts the
    canonical name itself, so the table is a complete lookup for all aliases
    and the primary name in a single pass.

    Returns:
        (inserted, already_existed) — counts of new vs. pre-existing rows.
    """
    rows: list[tuple[str, str, str, str, str, int]] = []

    # Canonical names for every source
    sources = ["football-data", "fbref", "understat", "sofascore"]
    for team in _TEAMS:
        for src in sources:
            name_slug = slug_from_name(team.name)
            rows.append((team.id, "team", src, name_slug, team.name, 1))

    # Named alias entries from _TEAM_NAME_SEEDS
    for canon_slug, source, source_name in _TEAM_NAME_SEEDS:
        name_slug = slug_from_name(source_name)
        rows.append((canon_slug, "team", source, name_slug, source_name, 1))

    if dry_run:
        unique_keys = {(r[1], r[2], r[3]) for r in rows}
        print(f"  [dry-run] would attempt {len(rows)} inserts ({len(unique_keys)} unique keys)")
        return 0, 0

    inserted = 0
    already = 0
    for row in rows:
        try:
            conn.execute(
                """
                INSERT INTO identity_map
                    (canonical_id, entity_type, source, source_id, source_name, verified)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(entity_type, source, source_id) DO UPDATE SET
                    canonical_id = excluded.canonical_id,
                    source_name  = excluded.source_name,
                    verified     = excluded.verified
                """,
                row,
            )
            inserted += 1
        except sqlite3.IntegrityError:
            already += 1

    conn.commit()
    return inserted, already


# ---------------------------------------------------------------------------
# Convenience: join helper for enrichment adapters
# ---------------------------------------------------------------------------


def lookup_team_canonical(
    db_path: Path,
    source: str,
    source_ids: list[str],
) -> dict[str, str]:
    """Bulk-resolve source team IDs to canonical slugs.

    Returns a dict mapping each source_id to its canonical_id.
    Source IDs that cannot be resolved are omitted from the result.

    Intended for enrichment adapters (Sofascore, Understat, FBref) that
    receive batches of team records and need to join them to the backbone.
    """
    if not source_ids:
        return {}
    placeholders = ",".join("?" * len(source_ids))
    with _conn(db_path) as con:
        rows = con.execute(
            f"""
            SELECT source_id, canonical_id FROM identity_map
            WHERE entity_type='team' AND source=? AND source_id IN ({placeholders})
              AND canonical_id != ?
            """,
            [source, *source_ids, SENTINEL],
        ).fetchall()
    return {r["source_id"]: r["canonical_id"] for r in rows}


def lookup_player_canonical(
    db_path: Path,
    source: str,
    source_ids: list[str],
) -> dict[str, str]:
    """Bulk-resolve source player IDs to canonical slugs."""
    if not source_ids:
        return {}
    placeholders = ",".join("?" * len(source_ids))
    with _conn(db_path) as con:
        rows = con.execute(
            f"""
            SELECT source_id, canonical_id FROM identity_map
            WHERE entity_type='player' AND source=? AND source_id IN ({placeholders})
              AND canonical_id != ?
            """,
            [source, *source_ids, SENTINEL],
        ).fetchall()
    return {r["source_id"]: r["canonical_id"] for r in rows}


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def report_unverified(db_path: Path) -> list[dict]:
    """Return all unverified non-sentinel identity_map rows for human review."""
    with _conn(db_path) as con:
        rows = con.execute(
            """
            SELECT id, canonical_id, entity_type, source, source_id, source_name, notes
            FROM identity_map
            WHERE verified = 0 AND canonical_id != ?
            ORDER BY entity_type, source, source_name
            """,
            (SENTINEL,),
        ).fetchall()
    return [dict(r) for r in rows]


def report_unmatched(db_path: Path) -> list[dict]:
    """Return all sentinel rows — entities the system could not resolve."""
    with _conn(db_path) as con:
        rows = con.execute(
            """
            SELECT id, entity_type, source, source_id, source_name, notes
            FROM identity_map
            WHERE canonical_id = ?
            ORDER BY entity_type, source, source_name
            """,
            (SENTINEL,),
        ).fetchall()
    return [dict(r) for r in rows]


def report_coverage(db_path: Path) -> dict[str, dict[str, int]]:
    """Return per-source mapping counts: {source: {verified, unverified, unmatched}}.

    Useful for assessing how complete identity coverage is before running
    downstream enrichment joins.
    """
    with _conn(db_path) as con:
        rows = con.execute(
            """
            SELECT
                source,
                SUM(CASE WHEN canonical_id != ? AND verified = 1 THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN canonical_id != ? AND verified = 0 THEN 1 ELSE 0 END) AS unverified,
                SUM(CASE WHEN canonical_id  = ?                  THEN 1 ELSE 0 END) AS unmatched
            FROM identity_map
            GROUP BY source
            ORDER BY source
            """,
            (SENTINEL, SENTINEL, SENTINEL),
        ).fetchall()
    return {
        r["source"]: {
            "verified": r["verified"],
            "unverified": r["unverified"],
            "unmatched": r["unmatched"],
        }
        for r in rows
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _cmd_seed(args: argparse.Namespace) -> None:
    db_path = Path(args.db_path)
    with _conn(db_path) as con:
        inserted, already = seed_identity_map(con, dry_run=args.dry_run)
    if not args.dry_run:
        print(f"Seeded identity_map: {inserted} rows inserted (or updated), {already} conflicts skipped.")


def _cmd_report(args: argparse.Namespace) -> None:
    db_path = Path(args.db_path)

    coverage = report_coverage(db_path)
    if coverage:
        header = f"\n{'Source':<20} {'Verified':>10} {'Unverified':>12} {'Unmatched':>11}"
        bar = "─" * len(header)
        print(f"\n{bar}")
        print("  Identity map coverage")
        print(bar)
        print(header)
        for src, counts in coverage.items():
            print(
                f"  {src:<18} {counts['verified']:>10} {counts['unverified']:>12} {counts['unmatched']:>11}"
            )
    else:
        print("identity_map is empty — run `python scripts/identity.py seed` first.")

    unmatched = report_unmatched(db_path)
    if unmatched:
        print(f"\n  {len(unmatched)} unmatched entities (canonical_id='{SENTINEL}'):")
        for row in unmatched:
            print(f"    [{row['entity_type']}] {row['source']} / {row['source_id']} → {row['source_name']!r}")
    else:
        print("\n  No unmatched entities.")

    unverified = report_unverified(db_path)
    if unverified:
        print(f"\n  {len(unverified)} unverified (auto-generated) mappings:")
        for row in unverified:
            print(
                f"    [{row['entity_type']}] {row['source']} / {row['source_id']} "
                f"→ {row['canonical_id']!r} (name: {row['source_name']!r})"
            )
    else:
        print("  No unverified mappings.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB),
        metavar="PATH",
        help=f"SQLite database file (default: {DEFAULT_DB})",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    p_seed = sub.add_parser("seed", help="Pre-populate identity_map with known aliases")
    p_seed.add_argument("--dry-run", action="store_true", help="Print summary without writing")
    p_seed.set_defaults(func=_cmd_seed)

    p_report = sub.add_parser("report", help="Print coverage and review report")
    p_report.set_defaults(func=_cmd_report)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
