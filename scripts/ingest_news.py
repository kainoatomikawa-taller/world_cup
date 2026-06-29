#!/usr/bin/env python3
"""
ingest_news.py — pull football/World Cup news from RSS feeds into the news table.

Fetches 3–4 named RSS feeds via feedparser, normalises each entry (headline,
link, published_at, summary ≤ 280 chars, thumbnail), dedupes by canonical-URL
hash, filters to football/World Cup relevance, and upserts into the news table.

Phase 1 scope
-------------
- Recency order only.  priority = 0 for all articles.
- Team mentions are extracted by keyword scan of headline + summary.
- entities = [] (player/coach/venue NER is Phase 2).
- cluster_id = NULL (clustering is Phase 2).

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
Each feed is fetched and processed in an independent try/except block.
A broken feed does not abort the others or touch backbone tables.

Usage:
    python scripts/ingest_news.py
    python scripts/ingest_news.py --dry-run
    python scripts/ingest_news.py --db-path /custom/path/world_cup.db
    python scripts/ingest_news.py --limit 50    # cap rows written per feed

Prerequisites:
    python scripts/init_db.py    # news table must exist
    python scripts/ingest_api.py # competition row must exist (FK: competition_id)
"""

from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
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

from config import COMPETITION_ID, DEFAULT_DB

# ---------------------------------------------------------------------------
# Feed registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class FeedConfig:
    source: str       # machine slug used in the news.source column
    source_name: str  # display name used in the news.source_name column (attribution)
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

# Maximum characters for the summary excerpt (aggregator contract: never full text).
MAX_SUMMARY_CHARS = 280

# Seconds to wait between feed fetches (polite crawling; not a rate-limit like the API).
INTER_FEED_DELAY = 1.0

# ---------------------------------------------------------------------------
# Team name → canonical slug lookup (mirrors schedule2026.ts)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _TeamDef:
    id: str
    name: str


_TEAMS: tuple[_TeamDef, ...] = (
    _TeamDef("mexico",                 "Mexico"),
    _TeamDef("south-africa",           "South Africa"),
    _TeamDef("south-korea",            "South Korea"),
    _TeamDef("czech-republic",         "Czech Republic"),
    _TeamDef("canada",                 "Canada"),
    _TeamDef("bosnia-and-herzegovina", "Bosnia and Herzegovina"),
    _TeamDef("qatar",                  "Qatar"),
    _TeamDef("switzerland",            "Switzerland"),
    _TeamDef("brazil",                 "Brazil"),
    _TeamDef("morocco",                "Morocco"),
    _TeamDef("haiti",                  "Haiti"),
    _TeamDef("scotland",               "Scotland"),
    _TeamDef("united-states",          "United States"),
    _TeamDef("paraguay",               "Paraguay"),
    _TeamDef("australia",              "Australia"),
    _TeamDef("turkey",                 "Turkey"),
    _TeamDef("germany",                "Germany"),
    _TeamDef("curacao",                "Curacao"),
    _TeamDef("ivory-coast",            "Ivory Coast"),
    _TeamDef("ecuador",                "Ecuador"),
    _TeamDef("netherlands",            "Netherlands"),
    _TeamDef("japan",                  "Japan"),
    _TeamDef("sweden",                 "Sweden"),
    _TeamDef("tunisia",                "Tunisia"),
    _TeamDef("belgium",                "Belgium"),
    _TeamDef("egypt",                  "Egypt"),
    _TeamDef("iran",                   "Iran"),
    _TeamDef("new-zealand",            "New Zealand"),
    _TeamDef("spain",                  "Spain"),
    _TeamDef("cape-verde",             "Cape Verde"),
    _TeamDef("saudi-arabia",           "Saudi Arabia"),
    _TeamDef("uruguay",                "Uruguay"),
    _TeamDef("france",                 "France"),
    _TeamDef("senegal",                "Senegal"),
    _TeamDef("iraq",                   "Iraq"),
    _TeamDef("norway",                 "Norway"),
    _TeamDef("argentina",              "Argentina"),
    _TeamDef("algeria",                "Algeria"),
    _TeamDef("austria",                "Austria"),
    _TeamDef("jordan",                 "Jordan"),
    _TeamDef("portugal",               "Portugal"),
    _TeamDef("dr-congo",               "DR Congo"),
    _TeamDef("uzbekistan",             "Uzbekistan"),
    _TeamDef("colombia",               "Colombia"),
    _TeamDef("england",                "England"),
    _TeamDef("croatia",                "Croatia"),
    _TeamDef("ghana",                  "Ghana"),
    _TeamDef("panama",                 "Panama"),
)

# Additional name aliases not covered by canonical names.
_TEAM_ALIASES: dict[str, str] = {
    "usa":                             "united-states",
    "us soccer":                       "united-states",
    "usmnt":                           "united-states",
    "uswnt":                           "united-states",
    "republic of korea":               "south-korea",
    "korea republic":                  "south-korea",
    "czechia":                         "czech-republic",
    "turkiye":                         "turkey",
    "cote d'ivoire":                   "ivory-coast",
    "côte d'ivoire":                   "ivory-coast",
    "ir iran":                         "iran",
    "democratic republic of congo":    "dr-congo",
    "congo dr":                        "dr-congo",
    "drc":                             "dr-congo",
    "the netherlands":                 "netherlands",
    "holland":                         "netherlands",
    "south africa":                    "south-africa",
    "new zealand":                     "new-zealand",
    "saudi":                           "saudi-arabia",
    "ksa":                             "saudi-arabia",
    "cape verde":                      "cape-verde",
    "cape verdean":                    "cape-verde",
    "ivory coast":                     "ivory-coast",
}

# Build a combined lookup: lowercase term → slug.
_TEAM_LOOKUP: dict[str, str] = {}
for _t in _TEAMS:
    _TEAM_LOOKUP[_t.name.lower()] = _t.id
    _slug_as_words = _t.id.replace("-", " ")
    if _slug_as_words != _t.name.lower():
        _TEAM_LOOKUP[_slug_as_words] = _t.id
_TEAM_LOOKUP.update(_TEAM_ALIASES)

# ---------------------------------------------------------------------------
# Relevance filter keywords
# ---------------------------------------------------------------------------

# An article must contain at least one of these terms (case-insensitive) to
# pass the relevance filter.  Team names are appended dynamically below.
_BASE_RELEVANCE: frozenset[str] = frozenset([
    "world cup",
    "worldcup",
    "wc 2026",
    "wc2026",
    "fifa",
    "2026",
    "international",
    "national team",
    "qualifier",
    "knockout",
    "group stage",
    "round of",
    "soccer",
    "football",
])

# Merge in all team-name terms so any article that names a WC team passes.
_RELEVANCE_TERMS: frozenset[str] = _BASE_RELEVANCE | frozenset(_TEAM_LOOKUP.keys())

# ---------------------------------------------------------------------------
# HTML stripping
# ---------------------------------------------------------------------------

class _HTMLStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def get_text(self) -> str:
        return "".join(self._parts)


def _strip_html(raw: str) -> str:
    """Remove HTML tags and collapse whitespace.  Returns plain text."""
    stripper = _HTMLStripper()
    try:
        stripper.feed(raw)
    except Exception:
        # Malformed HTML is handled by returning whatever was accumulated.
        pass
    return re.sub(r"\s+", " ", stripper.get_text()).strip()


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _struct_time_to_iso(st: time.struct_time | None) -> str | None:
    """Convert a feedparser struct_time (UTC) to an ISO 8601 string, or None."""
    if st is None:
        return None
    try:
        ts = calendar.timegm(st)
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")
    except (OverflowError, OSError):
        return None


# ---------------------------------------------------------------------------
# Thumbnail extraction
# ---------------------------------------------------------------------------

def _extract_thumbnail(entry: object) -> str | None:
    """Return the first usable image URL from a feedparser entry, or None.

    Checks (in priority order):
    1. media:content — the de-facto standard for RSS images.
    2. media:thumbnail — common fallback.
    3. enclosures — used by some podcast-style feeds; filtered to image/* types.
    """
    # 1. media:content
    for item in getattr(entry, "media_content", None) or []:
        url = (item or {}).get("url", "")
        if url and _looks_like_image(url):
            return url

    # 2. media:thumbnail
    for item in getattr(entry, "media_thumbnail", None) or []:
        url = (item or {}).get("url", "")
        if url:
            return url

    # 3. enclosures with image mime type
    for enc in getattr(entry, "enclosures", None) or []:
        mime = (enc or {}).get("type", "")
        url = (enc or {}).get("url", "")
        if url and mime.startswith("image/"):
            return url

    return None


def _looks_like_image(url: str) -> bool:
    """Heuristic: does the URL path end with a common image extension?"""
    path = url.split("?")[0].lower()
    return path.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"))


# ---------------------------------------------------------------------------
# Relevance filter
# ---------------------------------------------------------------------------

def _is_relevant(headline: str, summary: str) -> bool:
    """Return True if the article is football/World Cup relevant.

    Matches against a combined lowercase string of headline and summary.
    Requires at least one term from the relevance set to be present as a
    substring (not necessarily a word boundary — team names are specific enough).
    """
    combined = (headline + " " + summary).lower()
    return any(term in combined for term in _RELEVANCE_TERMS)


# ---------------------------------------------------------------------------
# Team mention extraction
# ---------------------------------------------------------------------------

def _extract_teams(headline: str, summary: str) -> list[str]:
    """Return a deduplicated list of canonical team slugs mentioned in the text.

    Uses simple substring matching (case-insensitive) against the team lookup
    table.  Longer terms are checked first so 'South Korea' matches before
    'Korea' could theoretically clobber it (though 'Korea' is not a key).
    """
    combined = (headline + " " + summary).lower()
    found: list[str] = []
    seen_slugs: set[str] = set()
    # Sort by term length descending so longer matches win.
    for term, slug in sorted(_TEAM_LOOKUP.items(), key=lambda kv: -len(kv[0])):
        if slug not in seen_slugs and term in combined:
            found.append(slug)
            seen_slugs.add(slug)
    return found


# ---------------------------------------------------------------------------
# Article data class
# ---------------------------------------------------------------------------

@dataclass
class Article:
    id: str
    competition_id: Optional[str]
    source: str
    source_name: str
    headline: str
    url: str
    thumbnail_url: Optional[str]
    summary: Optional[str]
    published_at: str
    teams: list[str]
    entities: list[str]
    cluster_id: Optional[str]
    priority: int
    fetched_at: str


def _url_hash(url: str) -> str:
    """SHA-256 hex digest of the canonical URL — used as the news.id primary key."""
    return hashlib.sha256(url.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Entry normalisation
# ---------------------------------------------------------------------------

def _normalise_entry(
    entry: object,
    cfg: FeedConfig,
    fetched_at: str,
    competition_id: str | None,
) -> Article | None:
    """Convert a feedparser entry to an Article, or return None if unusable.

    An entry is unusable when it has no URL, no headline, or fails the
    relevance filter.  All other missing fields are handled gracefully.
    """
    url: str = (getattr(entry, "link", None) or "").strip()
    if not url:
        return None

    headline: str = _strip_html(getattr(entry, "title", None) or "").strip()
    if not headline:
        return None

    # Summary: strip HTML, truncate, enforce aggregator contract (≤ MAX_SUMMARY_CHARS).
    raw_summary: str = (
        getattr(entry, "summary", None)
        or getattr(entry, "description", None)
        or ""
    )
    summary_text = _strip_html(raw_summary).strip()
    # Remove the headline if it appears verbatim at the start of the summary
    # (some feeds duplicate the title into the description field).
    if summary_text.lower().startswith(headline.lower()):
        summary_text = summary_text[len(headline):].lstrip(" :-—")
    summary: str | None = (
        (summary_text[:MAX_SUMMARY_CHARS] + "…")
        if len(summary_text) > MAX_SUMMARY_CHARS
        else summary_text or None
    )

    if not _is_relevant(headline, summary or ""):
        return None

    published_at: str = (
        _struct_time_to_iso(getattr(entry, "published_parsed", None))
        or _struct_time_to_iso(getattr(entry, "updated_parsed", None))
        or fetched_at  # fallback: use ingest time so the row is never NULL
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
        entities=[],        # Phase 2: named entity recognition
        cluster_id=None,    # Phase 2: clustering
        priority=0,
        fetched_at=fetched_at,
    )


# ---------------------------------------------------------------------------
# Feed fetch
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


def _fetch_feed(cfg: FeedConfig, limit: int | None, competition_id: str | None) -> list[Article]:
    """Fetch and parse one RSS feed; return normalised Article list.

    Uses requests for the HTTP layer (handles SSL via certifi) and feedparser
    for XML parsing.  Errors (network, parse, per-entry) are caught and logged
    without raising, so a broken feed never aborts the overall run.
    """
    print(f"  Fetching {cfg.url} …")
    try:
        resp = _get_session().get(cfg.url, timeout=20)
        resp.raise_for_status()
    except Exception as exc:
        print(f"  ERROR fetching {cfg.source}: {exc}")
        return []

    try:
        # Build the headers dict feedparser needs for encoding detection and
        # relative-URL resolution.  Supply a fallback content-type so feeds
        # that omit it (e.g. Fox Sports) are still parsed rather than rejected.
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
    """Abort with an instructive message if the news table doesn't exist."""
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


def _resolve_competition_id(conn: sqlite3.Connection) -> str | None:
    """Return COMPETITION_ID if the row exists in competitions, else None.

    competition_id is nullable in the news table; ingest_news.py can run
    standalone (before ingest_api.py has populated the competition row) by
    storing NULL and backfilling later.
    """
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

def run(db_path: Path, dry_run: bool, limit: int | None = None) -> None:
    """Fetch all configured RSS feeds and write to the news table.

    Each feed is isolated: a failure in one does not prevent the others.
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
                # Per-feed isolation: log and continue.
                print(f"  ERROR processing {cfg.source}: {exc}")
                total_feeds_err += 1

    finally:
        conn.close()

    tag = "[dry-run] " if dry_run else ""
    print(
        f"\n{tag}Done — {total_feeds_ok}/{len(_FEEDS)} feed(s) succeeded"
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
        help="Process at most N entries per feed (useful for testing)",
    )
    args = parser.parse_args()
    run(args.db_path, args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
