#!/usr/bin/env python3
"""
gnews_client.py — Phase 3: thin GNews API client for World Cup 2026 news.

Queries the GNews /search endpoint for tournament-related articles, normalises
results to the same Article shape used by ingest_news.py, and caches responses
in a local JSON file so the free-tier daily request limit is respected across
hourly pipeline runs.

COMMERCIAL CAVEAT
-----------------
The GNews API **free tier** permits only **personal, non-commercial** use.
Before deploying this pipeline to a publicly accessible or revenue-generating
service you must either:

  • Upgrade to a GNews paid or enterprise plan — see https://gnews.io/pricing/
  • Replace GNews with a self-hosted news aggregator (e.g. FreshRSS) or a
    commercial news API that explicitly permits redistribution.

This constraint also applies to the content GNews aggregates:
  • Source attribution MUST always be shown (the ``source_name`` column is
    displayed on every card; ``"[Outlet] (via GNews)"`` format preserves it).
  • Full article text MUST NEVER be stored — ``summary`` is capped at
    MAX_SUMMARY_CHARS characters and is a teaser only.
  • The link-out URL must point to the originating publication.

Caching strategy
----------------
Responses are cached in ``db/gnews_cache.json`` with a TTL of
CACHE_TTL_HOURS (default: 6 h).  The hourly ``run_news.sh`` pipeline
therefore makes GNews API calls at most ``24 / CACHE_TTL_HOURS`` times per
day.  With MAX_QUERIES_PER_REFRESH = 10 queries per refresh cycle:

    max daily requests ≤ (24 h / 6 h) × 10 = 40   (free-tier cap: 100/day)

Configuration
-------------
Add ``GNEWS_API_KEY=<your-key>`` to ``.env.local`` — sign up at
https://gnews.io/.  If the key is absent the pipeline skips GNews silently
and only RSS feeds are used (graceful degradation).
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from news_utils import (
    Article,
    MAX_SUMMARY_CHARS,
    _extract_teams,
    _is_relevant,
    _strip_html,
    _url_hash,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GNEWS_API_BASE = "https://gnews.io/api/v4/search"

# Source slug written to news.source for GNews-ingested articles.
# Distinct from RSS slugs so it contributes a unique signal to sourceCoverageSignal.
GNEWS_SOURCE = "gnews"

# Refresh the cache at most once per CACHE_TTL_HOURS to conserve daily quota.
CACHE_TTL_HOURS: float = 6.0

# Number of search queries executed per refresh cycle (= number of HTTP requests).
MAX_QUERIES_PER_REFRESH = 10

# GNews free tier returns at most 10 articles per request.
MAX_RESULTS_PER_QUERY = 10

# Seconds to wait between successive GNews API calls (polite pacing).
INTER_REQUEST_DELAY: float = 1.5

# World Cup 2026 search queries — diverse angles to maximise coverage breadth
# and surface articles from sources not included in the RSS feed list (e.g.
# FIFA.com, DAZN, AP, Reuters, The Guardian).
_QUERIES: tuple[str, ...] = (
    "FIFA World Cup 2026",
    "World Cup 2026 match result",
    "World Cup 2026 group stage",
    "World Cup 2026 knockout round",
    "World Cup 2026 goal scorer",
    "World Cup 2026 squad injury",
    "World Cup 2026 FIFA highlights",
    "World Cup 2026 referee VAR",
    "DAZN FIFA World Cup 2026",
    "FIFA 2026 tournament news",
)

assert len(_QUERIES) == MAX_QUERIES_PER_REFRESH, (
    "Update MAX_QUERIES_PER_REFRESH when adding or removing queries"
)

_REQUEST_HEADERS = {
    "User-Agent": "WorldCupInsights/1.0 (news aggregator; link-out only)",
    "Accept": "application/json",
}

# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------


def _load_cache(cache_path: Path) -> dict | None:
    """Load the cache JSON file; return None on missing file or parse error."""
    try:
        if cache_path.is_file():
            return json.loads(cache_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        pass
    return None


def _save_cache(cache_path: Path, data: dict) -> None:
    """Atomically write cache data to disk.

    Writes to a sibling .tmp file then renames — so a crash mid-write leaves
    the previous file intact rather than producing a truncated one.
    """
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(cache_path)


def _is_cache_fresh(cached_data: dict | None, now: datetime, ttl_hours: float) -> bool:
    """Return True when cached_data exists and its fetched_at is within ttl_hours of now."""
    if not cached_data or "fetched_at" not in cached_data:
        return False
    try:
        ts = cached_data["fetched_at"]
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        fetched = datetime.fromisoformat(ts)
        if not fetched.tzinfo:
            fetched = fetched.replace(tzinfo=timezone.utc)
        age_hours = (now - fetched.astimezone(timezone.utc)).total_seconds() / 3600
        return age_hours < ttl_hours
    except (ValueError, AttributeError, OverflowError):
        return False


# ---------------------------------------------------------------------------
# Article normalisation
# ---------------------------------------------------------------------------


def _normalize_gnews_article(
    raw: dict,
    fetched_at: str,
    competition_id: Optional[str],
) -> Optional[Article]:
    """Convert a raw GNews article dict to an Article, or None if unusable.

    GNews article shape::

        {
          "title":       str,
          "description": str,
          "content":     str,   # NEVER stored — aggregator contract
          "url":         str,
          "image":       str | null,
          "publishedAt": "2026-06-29T12:00:00Z",
          "source":      {"name": str, "url": str}
        }
    """
    url = (raw.get("url") or "").strip()
    if not url:
        return None

    headline = _strip_html(raw.get("title") or "").strip()
    if not headline:
        return None

    # GNews description is already a short excerpt; strip HTML and enforce contract.
    raw_desc = raw.get("description") or ""
    summary_text = _strip_html(raw_desc).strip()
    # Remove headline when it appears verbatim at the start of the description.
    if summary_text.lower().startswith(headline.lower()):
        summary_text = summary_text[len(headline):].lstrip(" :-—")
    summary: Optional[str] = (
        (summary_text[:MAX_SUMMARY_CHARS] + "…")
        if len(summary_text) > MAX_SUMMARY_CHARS
        else summary_text or None
    )

    if not _is_relevant(headline, summary or ""):
        return None

    # Normalise "Z" suffix to "+00:00" for consistency with RSS articles.
    published_at = (raw.get("publishedAt") or fetched_at).strip()
    if published_at.endswith("Z"):
        published_at = published_at[:-1] + "+00:00"

    thumbnail_url: Optional[str] = raw.get("image") or None

    source_info = raw.get("source") or {}
    outlet_name = (source_info.get("name") or "Unknown").strip()
    # Show originating publication for attribution; mark intermediary.
    source_name = f"{outlet_name} (via GNews)"

    teams = _extract_teams(headline, summary or "")

    return Article(
        id=_url_hash(url),
        competition_id=competition_id,
        source=GNEWS_SOURCE,
        source_name=source_name,
        headline=headline,
        url=url,
        thumbnail_url=thumbnail_url,
        summary=summary,
        published_at=published_at,
        teams=teams,
        entities=[],     # Phase 2 NER is handled by cluster_news.py post-ingest
        cluster_id=None,
        priority=0,
        fetched_at=fetched_at,
    )


# ---------------------------------------------------------------------------
# API layer
# ---------------------------------------------------------------------------

_SESSION: requests.Session | None = None


def _get_session() -> requests.Session:
    global _SESSION
    if _SESSION is None:
        _SESSION = requests.Session()
        _SESSION.headers.update(_REQUEST_HEADERS)
    return _SESSION


def _call_gnews_api(query: str, api_key: str) -> list[dict]:
    """Call GNews /search for one query; return raw article dicts on success.

    Returns an empty list on any error so a single bad query never aborts the
    rest of the refresh cycle.
    """
    params = {
        "q": query,
        "lang": "en",
        "max": MAX_RESULTS_PER_QUERY,
        "sortby": "publishedAt",
        "apikey": api_key,
    }
    try:
        resp = _get_session().get(GNEWS_API_BASE, params=params, timeout=20)
        resp.raise_for_status()
        return resp.json().get("articles", [])
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        if status == 403:
            print(f"  [GNews] 403 for {query!r} — check GNEWS_API_KEY")
        elif status == 429:
            print(f"  [GNews] 429 for {query!r} — daily cap likely reached")
        else:
            print(f"  [GNews] HTTP {status} for {query!r}: {exc}")
        return []
    except Exception as exc:
        print(f"  [GNews] Request failed for {query!r}: {exc}")
        return []


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def fetch_gnews_articles(
    api_key: str,
    cache_path: Path,
    competition_id: Optional[str],
    now: Optional[datetime] = None,
) -> list[Article]:
    """Fetch GNews World Cup articles, using the TTL cache to cap API calls.

    Returns a deduplicated list of Article objects ready to INSERT OR IGNORE
    into the news table.  Idempotent — re-running with a fresh cache returns
    the same articles without additional HTTP requests.

    Args:
        api_key:        GNews API key from GNEWS_API_KEY in .env.local.
        cache_path:     Path to the JSON cache file (e.g. db/gnews_cache.json).
        competition_id: FK value for news.competition_id; may be None.
        now:            Current UTC datetime; defaults to datetime.now(utc).
    """
    if not api_key:
        return []

    if now is None:
        now = datetime.now(timezone.utc)

    fetched_at = now.isoformat(timespec="seconds")

    # Serve from cache when still within TTL.
    cached = _load_cache(cache_path)
    if _is_cache_fresh(cached, now, CACHE_TTL_HOURS):
        print(f"  [GNews] Cache hit (fetched {cached['fetched_at']}, TTL {CACHE_TTL_HOURS} h)")
        raw_by_query: dict[str, list[dict]] = cached.get("articles_by_query", {})
    else:
        print(f"  [GNews] Cache stale/missing — fetching {len(_QUERIES)} queries …")
        raw_by_query = {}
        for i, query in enumerate(_QUERIES):
            if i > 0:
                time.sleep(INTER_REQUEST_DELAY)
            articles_raw = _call_gnews_api(query, api_key)
            raw_by_query[query] = articles_raw
            print(f"  [GNews]   {query!r}: {len(articles_raw)} article(s)")
        _save_cache(cache_path, {"fetched_at": fetched_at, "articles_by_query": raw_by_query})
        print(f"  [GNews] Cache written → {cache_path}")

    # Normalise and deduplicate across all queries.
    # The same URL may appear in multiple query results; dedup by id (URL hash).
    seen_ids: set[str] = set()
    articles: list[Article] = []
    skipped_irrelevant = 0
    for raw_list in raw_by_query.values():
        for raw in raw_list:
            art = _normalize_gnews_article(raw, fetched_at, competition_id)
            if art is None:
                skipped_irrelevant += 1
                continue
            if art.id in seen_ids:
                continue
            seen_ids.add(art.id)
            articles.append(art)

    skipped_msg = f", {skipped_irrelevant} irrelevant/unusable" if skipped_irrelevant else ""
    print(f"  [GNews] {len(articles)} unique relevant article(s){skipped_msg}")
    return articles
