#!/usr/bin/env python3
"""
ingest_news.py — pull football/World Cup news from RSS feeds and GNews into
the news table.

Phase 1 (RSS feeds)
-------------------
Fetches BBC Sport, Sky Sports, ESPN, and Fox Sports RSS feeds via feedparser,
normalises each entry (headline, link, published_at, summary ≤ 280 chars,
thumbnail), dedupes by canonical-URL hash, filters to football/World Cup
relevance, and upserts into the news table.

Phase 3 (GNews API)
--------------------
Optionally layers GNews search results on top of the RSS feeds to fill coverage
gaps (e.g. FIFA.com, DAZN, Reuters, AP) and strengthen the cross-source
coverage signal.  Requires GNEWS_API_KEY in .env.local.  Responses are cached
for CACHE_TTL_HOURS (default 6 h) so daily API usage stays well under the
free-tier limit of 100 req/day.

See scripts/gnews_client.py for the GNews commercial-use caveat.

Aggregator contract (enforced here)
------------------------------------
- Link-out only.  Full article text is never stored.
- summary is truncated to MAX_SUMMARY_CHARS; HTML is stripped.
- source_name is mandatory on every row.
- url must be the canonical link from the feed item.

Deduplication
-------------
- id = SHA-256 hex of the canonical url.
- INSERT OR IGNORE on id; a re-fetched article is never overwritten.

Failure isolation
-----------------
Each feed (and the GNews block) is wrapped in an independent try/except.
A broken source does not abort the others or touch backbone tables.

Usage:
    python scripts/ingest_news.py
    python scripts/ingest_news.py --dry-run
    python scripts/ingest_news.py --db-path /custom/path/world_cup.db
    python scripts/ingest_news.py --limit 50    # cap rows written per RSS feed
    python scripts/ingest_news.py --skip-gnews  # skip GNews even if key is set

Prerequisites:
    python scripts/init_db.py    # news table must exist
    python scripts/ingest_api.py # competition row must exist (FK: competition_id)
    GNEWS_API_KEY in .env.local  # optional; enables Phase 3 GNews ingest
"""

from __future__ import annotations

import argparse
import calendar
import json
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    import feedparser
except ImportError:
    sys.exit(
        "ERROR: feedparser is not installed.\n"
        "Run: pip install feedparser\n"
        "Or: pip install -r scripts/requirements.txt"
    )

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import COMPETITION_ID, DEFAULT_DB, load_gnews_api_key
from gnews_client import fetch_gnews_articles
from news_utils import (
    MAX_SUMMARY_CHARS,
    Article,
    _extract_teams,
    _is_relevant,
    _strip_html,
    _url_hash,
)

# ---------------------------------------------------------------------------
# Feed registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class FeedConfig:
    source: str       # machine slug used in the news.source column
    source_name: str  # display name for attribution (shown on every card)
    url: str


_FEEDS: tuple[FeedConfig, ...] = (
    FeedConfig(
        source="bbc-sport",
        source_name="BBC Sport",
        url="https://feeds.bbci.co.uk/sport/football/rss.xml",
    ),
    FeedConfig(
        source="sky-sports",
        source_name="Sky Sports",
        url="https://www.skysports.com/rss/12040",
    ),
    FeedConfig(
        source="espn",
        source_name="ESPN",
        url="https://www.espn.com/espn/rss/soccer/news",
    ),
    FeedConfig(
        source="fox-sports",
        source_name="Fox Sports",
        url="https://api.foxsports.com/v2/content/optimized-rss?uri=fs/soccer",
    ),
)

# Seconds to wait between feed fetches (polite crawling).
INTER_FEED_DELAY = 1.0

# ---------------------------------------------------------------------------
# Date helpers (RSS-specific; GNews timestamps are already ISO 8601)
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _struct_time_to_iso(st: time.struct_time | None) -> str | None:
    """Convert a feedparser struct_time (UTC) to ISO 8601, or None."""
    if st is None:
        return None
    try:
        ts = calendar.timegm(st)
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")
    except (OverflowError, OSError):
        return None


# ---------------------------------------------------------------------------
# Thumbnail extraction (RSS-specific; GNews supplies a direct image URL)
# ---------------------------------------------------------------------------

def _looks_like_image(url: str) -> bool:
    path = url.split("?")[0].lower()
    return path.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"))


def _extract_thumbnail(entry: object) -> str | None:
    """Return the first usable image URL from a feedparser entry, or None.

    Checks (in priority order):
    1. media:content — de-facto standard for RSS images.
    2. media:thumbnail — common fallback.
    3. enclosures — filtered to image/* MIME types.
    """
    for item in getattr(entry, "media_content", None) or []:
        url = (item or {}).get("url", "")
        if url and _looks_like_image(url):
            return url

    for item in getattr(entry, "media_thumbnail", None) or []:
        url = (item or {}).get("url", "")
        if url:
            return url

    for enc in getattr(entry, "enclosures", None) or []:
        mime = (enc or {}).get("type", "")
        url = (enc or {}).get("url", "")
        if url and mime.startswith("image/"):
            return url

    return None


# ---------------------------------------------------------------------------
# Entry normalisation (RSS)
# ---------------------------------------------------------------------------

def _normalise_entry(
    entry: object,
    cfg: FeedConfig,
    fetched_at: str,
    competition_id: Optional[str],
) -> Optional[Article]:
    """Convert a feedparser entry to an Article, or None if unusable.

    An entry is unusable when it has no URL, no headline, or fails the
    relevance filter.  All other missing fields are handled gracefully.
    """
    url: str = (getattr(entry, "link", None) or "").strip()
    if not url:
        return None

    headline: str = _strip_html(getattr(entry, "title", None) or "").strip()
    if not headline:
        return None

    raw_summary: str = (
        getattr(entry, "summary", None)
        or getattr(entry, "description", None)
        or ""
    )
    summary_text = _strip_html(raw_summary).strip()
    if summary_text.lower().startswith(headline.lower()):
        summary_text = summary_text[len(headline):].lstrip(" :-—")
    summary: Optional[str] = (
        (summary_text[:MAX_SUMMARY_CHARS] + "…")
        if len(summary_text) > MAX_SUMMARY_CHARS
        else summary_text or None
    )

    if not _is_relevant(headline, summary or ""):
        return None

    published_at: str = (
        _struct_time_to_iso(getattr(entry, "published_parsed", None))
        or _struct_time_to_iso(getattr(entry, "updated_parsed", None))
        or fetched_at
    )

    thumbnail_url = _extract_thumbnail(entry)
    teams = _extract_teams(headline, summary or "")

    return Article(
        id=_url_hash(url),
        competition_id=competition_id,
        source=cfg.source,
        source_name=cfg.source_name,
        headline=headline,
        url=url,
        thumbnail_url=thumbnail_url,
        summary=summary,
        published_at=published_at,
        teams=teams,
        entities=[],
        cluster_id=None,
        priority=0,
        fetched_at=fetched_at,
    )


# ---------------------------------------------------------------------------
# Feed fetch (RSS)
# ---------------------------------------------------------------------------

_SESSION: requests.Session | None = None

_HEADERS = {
    "User-Agent": "WorldCupInsights/1.0 (news aggregator; link-out only)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}


def _get_session() -> requests.Session:
    global _SESSION
    if _SESSION is None:
        _SESSION = requests.Session()
        _SESSION.headers.update(_HEADERS)
    return _SESSION


def _fetch_feed(cfg: FeedConfig, limit: int | None, competition_id: Optional[str]) -> list[Article]:
    """Fetch and parse one RSS feed; return normalised Article list."""
    print(f"  Fetching {cfg.url} …")
    try:
        resp = _get_session().get(cfg.url, timeout=20)
        resp.raise_for_status()
    except Exception as exc:
        print(f"  ERROR fetching {cfg.source}: {exc}")
        return []

    try:
        resp_headers: dict[str, str] = {
            "content-location": cfg.url,
            "content-type": (
                resp.headers.get("content-type") or "application/rss+xml; charset=utf-8"
            ),
        }
        parsed = feedparser.parse(resp.content, response_headers=resp_headers)
    except Exception as exc:
        print(f"  ERROR parsing {cfg.source} feed: {exc}")
        return []

    if parsed.get("bozo") and not parsed.get("entries"):
        exc = parsed.get("bozo_exception", "unknown parse error")
        print(f"  WARNING {cfg.source} feed malformed: {exc} — skipping")
        return []

    entries = parsed.get("entries", [])
    if limit is not None:
        entries = entries[:limit]

    fetched_at = _now_iso()
    articles: list[Article] = []
    skipped = 0

    for entry in entries:
        try:
            article = _normalise_entry(entry, cfg, fetched_at, competition_id)
        except Exception as exc:
            print(f"  WARNING could not normalise entry from {cfg.source}: {exc}")
            skipped += 1
            continue

        if article is None:
            skipped += 1
            continue

        articles.append(article)

    print(
        f"  {cfg.source}: {len(articles)} relevant article(s)"
        + (f", {skipped} skipped (no URL / irrelevant / error)" if skipped else "")
    )
    return articles


# ---------------------------------------------------------------------------
# Database write
# ---------------------------------------------------------------------------

def _write_articles(
    conn: sqlite3.Connection,
    articles: list[Article],
    dry_run: bool,
) -> tuple[int, int]:
    """Insert articles; return (inserted, skipped_duplicate) counts.

    Uses INSERT OR IGNORE so re-fetched URLs are silently skipped
    (id = SHA-256 of url is the dedup key).
    """
    if not articles:
        return 0, 0

    rows = [
        (
            a.id,
            a.competition_id,
            a.source,
            a.source_name,
            a.headline,
            a.url,
            a.thumbnail_url,
            a.summary,
            a.published_at,
            json.dumps(a.teams, ensure_ascii=False),
            json.dumps(a.entities, ensure_ascii=False),
            a.cluster_id,
            a.priority,
            a.fetched_at,
        )
        for a in articles
    ]

    if dry_run:
        print(f"  [dry-run] would write {len(rows)} article(s) to news table")
        return 0, 0

    before = conn.execute("SELECT COUNT(*) FROM news").fetchone()[0]
    conn.executemany(
        """
        INSERT OR IGNORE INTO news
            (id, competition_id, source, source_name, headline, url,
             thumbnail_url, summary, published_at, teams, entities,
             cluster_id, priority, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    after = conn.execute("SELECT COUNT(*) FROM news").fetchone()[0]
    inserted = after - before
    skipped_dup = len(rows) - inserted
    return inserted, skipped_dup


# ---------------------------------------------------------------------------
# Schema check
# ---------------------------------------------------------------------------

def _check_schema(conn: sqlite3.Connection) -> None:
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "news" not in tables:
        raise SystemExit(
            "ERROR: 'news' table is missing.\n"
            "Run `python scripts/init_db.py` to apply the schema."
        )


def _resolve_competition_id(conn: sqlite3.Connection) -> Optional[str]:
    try:
        row = conn.execute(
            "SELECT 1 FROM competitions WHERE id = ? LIMIT 1", (COMPETITION_ID,)
        ).fetchone()
        return COMPETITION_ID if row else None
    except sqlite3.OperationalError:
        return None


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run(
    db_path: Path,
    dry_run: bool,
    limit: int | None = None,
    skip_gnews: bool = False,
) -> None:
    """Fetch all configured RSS feeds (and optionally GNews) and write to news.

    Each source is isolated: a failure in one does not prevent the others.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")

    try:
        _check_schema(conn)
        competition_id = _resolve_competition_id(conn)
        if competition_id is None:
            print(
                "  NOTE: competition row not found — news.competition_id will be NULL.\n"
                "  Run `python scripts/ingest_api.py` to populate it, then re-run this script."
            )

        total_inserted = 0
        total_dup = 0
        total_feeds_ok = 0
        total_feeds_err = 0

        # ── RSS feeds ──────────────────────────────────────────────────────
        for i, cfg in enumerate(_FEEDS):
            print(f"\n[{i + 1}/{len(_FEEDS)}] {cfg.source_name} ({cfg.source})")

            if i > 0:
                time.sleep(INTER_FEED_DELAY)

            try:
                articles = _fetch_feed(cfg, limit, competition_id)
                inserted, skipped_dup = _write_articles(conn, articles, dry_run)
                total_inserted += inserted
                total_dup += skipped_dup
                total_feeds_ok += 1
                if not dry_run:
                    print(f"  → {inserted} new, {skipped_dup} already known")
            except Exception as exc:
                print(f"  ERROR processing {cfg.source}: {exc}")
                total_feeds_err += 1

        # ── GNews API (Phase 3) ────────────────────────────────────────────
        # Fills coverage gaps left by RSS (e.g. FIFA.com, DAZN, AP, Reuters).
        # Skipped gracefully when GNEWS_API_KEY is absent or --skip-gnews is set.
        gnews_key = load_gnews_api_key() if not skip_gnews else None
        print(f"\n[{len(_FEEDS) + 1}/{len(_FEEDS) + 1}] GNews API")
        if not gnews_key:
            reason = "--skip-gnews flag" if skip_gnews else "GNEWS_API_KEY not set in .env.local"
            print(f"  Skipped ({reason})")
        else:
            try:
                cache_path = db_path.parent / "gnews_cache.json"
                gnews_articles = fetch_gnews_articles(
                    api_key=gnews_key,
                    cache_path=cache_path,
                    competition_id=competition_id,
                )
                inserted, skipped_dup = _write_articles(conn, gnews_articles, dry_run)
                total_inserted += inserted
                total_dup += skipped_dup
                total_feeds_ok += 1
                if not dry_run:
                    print(f"  → {inserted} new, {skipped_dup} already known")
            except Exception as exc:
                print(f"  ERROR processing GNews: {exc}")
                total_feeds_err += 1

    finally:
        conn.close()

    n_sources = len(_FEEDS) + 1  # RSS feeds + GNews
    tag = "[dry-run] " if dry_run else ""
    print(
        f"\n{tag}Done — {total_feeds_ok}/{n_sources} source(s) succeeded"
        + (f", {total_feeds_err} failed" if total_feeds_err else "")
        + (f"\n{tag}Total: {total_inserted} new article(s), {total_dup} duplicate(s) skipped"
           if not dry_run else "")
    )


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
        help="Fetch and normalise articles without writing to the database",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process at most N entries per RSS feed (useful for testing)",
    )
    parser.add_argument(
        "--skip-gnews",
        action="store_true",
        help="Skip the GNews API step even when GNEWS_API_KEY is set",
    )
    args = parser.parse_args()
    run(args.db_path, args.dry_run, limit=args.limit, skip_gnews=args.skip_gnews)


if __name__ == "__main__":
    main()
