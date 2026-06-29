#!/usr/bin/env python3
"""
export_json.py — final pipeline stage: materialize SQLite data to static JSON.

Opens the database read-only, calls each query.py function, and writes one
JSON file per dataset into an export/ directory.  Also writes one file per
match under export/matches/<match_id>.json, then writes manifest.json last
with a UTC timestamp, schema version, and a content hash that changes whenever
any exported payload changes.

Re-runnable at any time; never writes to the database.

Usage:
    python scripts/export_json.py
    python scripts/export_json.py --db-path /path/to.db
    python scripts/export_json.py --out-dir /path/to/export
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import COMPETITION_ID, DEFAULT_DB
from query import (
    all_competitions,
    all_fixtures,
    all_player_ratings,
    competition_table,
    enriched_player_stats,
    recent_news,
    top_scorers,
)

# Bump when the shape of any exported file changes.
SCHEMA_VERSION = "2"

DEFAULT_OUT: Path = REPO_ROOT / "export"
DEFAULT_FRONTEND: Path = REPO_ROOT / "public" / "data"

# Files that belong in the front-end static assets directory.
# Manifest is always included so the browser can detect stale data.
_FRONTEND_FILES = (
    "fixtures.json",
    "standings.json",
    "scorers.json",
    "player_stats.json",
    "player_ratings.json",
    "news.json",
    "manifest.json",
)


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _to_records(df) -> list[dict]:
    """Convert a DataFrame to a JSON-serialisable list of dicts."""
    return json.loads(df.to_json(orient="records"))


def _write_json(path: Path, data: object) -> str:
    """Write *data* as pretty-printed JSON atomically; return its SHA-256 hex digest.

    Writes to a sibling .tmp file first, then renames — so a crash mid-write
    leaves the previous file intact rather than producing a truncated one.
    """
    text = json.dumps(data, ensure_ascii=False, indent=2)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)  # atomic on POSIX (same filesystem)
    return hashlib.sha256(text.encode()).hexdigest()


def _content_hash(digests: list[str]) -> str:
    """Stable hash of an arbitrary collection of SHA-256 digests."""
    joined = "|".join(sorted(digests))
    return hashlib.sha256(joined.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Per-match export
# ---------------------------------------------------------------------------


def _export_matches(fixtures: list[dict], matches_dir: Path) -> dict[str, str]:
    """Write one JSON file per match; return {match_id: sha256}."""
    matches_dir.mkdir(parents=True, exist_ok=True)
    hashes: dict[str, str] = {}
    for match in fixtures:
        mid = str(match["match_id"])
        digest = _write_json(matches_dir / f"{mid}.json", match)
        hashes[mid] = digest
    return hashes


# ---------------------------------------------------------------------------
# Main export
# ---------------------------------------------------------------------------


def _sync_frontend(out_dir: Path, frontend_dir: Path) -> None:
    """Atomically sync frontend-relevant files from out_dir to frontend_dir.

    Each file is written to a sibling .tmp file then renamed into place, so the
    last-good version of every file survives a mid-sync crash.  The matches/
    directory is staged in matches.new, then renamed atomically; the old tree is
    only removed after the new one is in place.
    """
    frontend_dir.mkdir(parents=True, exist_ok=True)

    for fname in _FRONTEND_FILES:
        src = out_dir / fname
        if src.exists():
            dst = frontend_dir / fname
            tmp = dst.with_suffix(dst.suffix + ".tmp")
            shutil.copy2(src, tmp)
            tmp.replace(dst)  # atomic on POSIX

    # Atomic matches-directory swap: copy to matches.new → rename old out →
    # rename new in → delete old.  A crash at any point leaves either the old
    # or the new directory intact, never an empty slot.
    src_matches = out_dir / "matches"
    if src_matches.is_dir():
        dst_matches = frontend_dir / "matches"
        staging = frontend_dir / "matches.new"
        retired = frontend_dir / "matches.old"

        if staging.exists():
            shutil.rmtree(staging)
        shutil.copytree(src_matches, staging)

        if retired.exists():
            shutil.rmtree(retired)
        if dst_matches.exists():
            dst_matches.rename(retired)   # atomic rename (same fs)
        staging.rename(dst_matches)       # atomic rename (same fs)
        if retired.exists():
            shutil.rmtree(retired)

    print(f"\nFrontend assets synced → {frontend_dir}")


def export(
    db_path: Path,
    out_dir: Path,
    competition_id: str = COMPETITION_ID,
    frontend_dir: Path | None = DEFAULT_FRONTEND,
) -> None:
    """Run all queries and write JSON to *out_dir*. Never writes to the database.

    After the main export, copies frontend-relevant files to *frontend_dir* so
    the Vite dev server and the production build can serve them as static assets.

    Upgrade path — object storage:
      Replace *frontend_dir* with a call to upload each file to a CDN bucket
      (S3, Cloudflare R2, GCS, etc.).  The ``useFixtures`` hook in the front-end
      needs only a URL change — the JSON schema is stable.  Cache-bust via
      ``manifest.json``'s ``content_hash`` as a query parameter:
        ``/data/fixtures.json?v=<content_hash>``
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    file_manifest: dict[str, dict] = {}
    all_digests: list[str] = []

    # ── 1 ── competitions ─────────────────────────────────────────────────
    print("[1/8] Exporting competitions …")
    comps = _to_records(all_competitions(db_path))
    digest = _write_json(out_dir / "competitions.json", comps)
    file_manifest["competitions.json"] = {"rows": len(comps), "sha256": digest}
    all_digests.append(digest)
    print(f"       {len(comps)} competition(s)")

    # ── 2 ── fixtures (all matches, played + unplayed) ────────────────────
    print("[2/8] Exporting fixtures …")
    fixtures = _to_records(all_fixtures(db_path, competition_id))
    digest = _write_json(out_dir / "fixtures.json", fixtures)
    file_manifest["fixtures.json"] = {"rows": len(fixtures), "sha256": digest}
    all_digests.append(digest)
    played = sum(1 for f in fixtures if f.get("played"))
    print(f"       {len(fixtures)} fixture(s) ({played} played, {len(fixtures) - played} unplayed)")

    # ── 3 ── standings ────────────────────────────────────────────────────
    print("[3/8] Exporting standings …")
    standings = _to_records(competition_table(db_path, competition_id))
    digest = _write_json(out_dir / "standings.json", standings)
    file_manifest["standings.json"] = {"rows": len(standings), "sha256": digest}
    all_digests.append(digest)
    print(f"       {len(standings)} standing row(s)")

    # ── 4 ── scorers ──────────────────────────────────────────────────────
    print("[4/8] Exporting scorers …")
    scorers = _to_records(top_scorers(db_path, competition_id, limit=200))
    digest = _write_json(out_dir / "scorers.json", scorers)
    file_manifest["scorers.json"] = {"rows": len(scorers), "sha256": digest}
    all_digests.append(digest)
    print(f"       {len(scorers)} scorer(s)")

    # ── 5 ── player stats ─────────────────────────────────────────────────
    print("[5/8] Exporting player stats …")
    player_stats = _to_records(enriched_player_stats(db_path, competition_id, limit=500))
    digest = _write_json(out_dir / "player_stats.json", player_stats)
    file_manifest["player_stats.json"] = {"rows": len(player_stats), "sha256": digest}
    all_digests.append(digest)
    print(f"       {len(player_stats)} player stat row(s)")

    # ── 6 ── player ratings ───────────────────────────────────────────────
    print("[6/8] Exporting player ratings …")
    ratings = _to_records(all_player_ratings(db_path, competition_id))
    digest = _write_json(out_dir / "player_ratings.json", ratings)
    file_manifest["player_ratings.json"] = {"rows": len(ratings), "sha256": digest}
    all_digests.append(digest)
    print(f"       {len(ratings)} player rating(s)")

    # ── 7 ── per-match files ──────────────────────────────────────────────
    print("[7/8] Exporting per-match files …")
    matches_dir = out_dir / "matches"
    match_hashes = _export_matches(fixtures, matches_dir)
    all_digests.extend(match_hashes.values())
    file_manifest["matches/"] = {
        "count": len(match_hashes),
        "sha256_by_id": match_hashes,
    }
    print(f"       {len(match_hashes)} match file(s) → {matches_dir}")

    # ── 8 ── news ─────────────────────────────────────────────────────────
    print("[8/8] Exporting news …")
    _NEWS_TOP_N = 100  # Phase 1: most-recent N articles, recency-ordered
    raw_news = _to_records(recent_news(db_path, competition_id, limit=_NEWS_TOP_N))
    for _article in raw_news:
        for _col in ("teams", "entities"):
            _val = _article.get(_col)
            if isinstance(_val, str):
                try:
                    _article[_col] = json.loads(_val)
                except (json.JSONDecodeError, ValueError):
                    _article[_col] = []
    digest = _write_json(out_dir / "news.json", raw_news)
    file_manifest["news.json"] = {"rows": len(raw_news), "sha256": digest}
    all_digests.append(digest)
    print(f"       {len(raw_news)} article(s)")

    # ── manifest ──────────────────────────────────────────────────────────
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema_version": SCHEMA_VERSION,
        "competition_id": competition_id,
        "content_hash": _content_hash(all_digests),
        "files": file_manifest,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nDone — manifest.json written → {out_dir}")
    print(f"  content_hash: {manifest['content_hash']}")

    if frontend_dir is not None:
        _sync_frontend(out_dir, frontend_dir)


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
        "--out-dir",
        default=DEFAULT_OUT,
        type=Path,
        metavar="DIR",
        help=f"Output directory (default: {DEFAULT_OUT})",
    )
    parser.add_argument(
        "--frontend-dir",
        default=DEFAULT_FRONTEND,
        type=Path,
        metavar="DIR",
        help=f"Copy frontend-relevant files here after export (default: {DEFAULT_FRONTEND}). "
             "Pass an empty string to skip.",
    )
    args = parser.parse_args()
    frontend_dir = args.frontend_dir if str(args.frontend_dir) else None
    export(args.db_path, args.out_dir, frontend_dir=frontend_dir)


if __name__ == "__main__":
    main()
