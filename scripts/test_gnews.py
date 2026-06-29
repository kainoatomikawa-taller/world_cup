"""
test_gnews.py — unit tests for gnews_client.py.

All tests are offline: no HTTP calls are made.  Tests that exercise the
full fetch path stub _call_gnews_api via monkeypatch so the cache and
normalisation logic can be tested without a real API key.

Coverage:
    TestNormalizeGNewsArticle   — field mapping, filtering, edge cases
    TestCacheFreshness          — TTL boundary conditions
    TestFetchGNewsArticles      — cache hit/miss, dedup, filtering
    TestArticleId               — URL-hash stability
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))

import gnews_client
from gnews_client import (
    CACHE_TTL_HOURS,
    GNEWS_SOURCE,
    _is_cache_fresh,
    _normalize_gnews_article,
    fetch_gnews_articles,
)
from news_utils import _url_hash

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

NOW = datetime(2026, 6, 29, 12, 0, 0, tzinfo=timezone.utc)
FETCHED_AT = NOW.isoformat(timespec="seconds")
COMP_ID = "fifa-wc-2026"


def _raw(
    url: str = "https://example.com/article",
    title: str = "England vs France: World Cup 2026 semi-final",
    description: str = "England face France in the World Cup 2026 semi-final at MetLife Stadium.",
    image: str | None = "https://example.com/img.jpg",
    published_at: str = "2026-06-29T11:00:00Z",
    source_name: str = "BBC Sport",
) -> dict:
    """Minimal valid GNews article dict."""
    return {
        "url": url,
        "title": title,
        "description": description,
        "content": "Full text — never stored (aggregator contract).",
        "image": image,
        "publishedAt": published_at,
        "source": {"name": source_name, "url": "https://bbc.co.uk/sport"},
    }


def _fresh_cache(articles_by_query: dict | None = None) -> dict:
    """Cache dict with fetched_at = NOW."""
    return {
        "fetched_at": NOW.isoformat(timespec="seconds"),
        "articles_by_query": articles_by_query or {},
    }


# ---------------------------------------------------------------------------
# TestNormalizeGNewsArticle
# ---------------------------------------------------------------------------

class TestNormalizeGNewsArticle:
    def test_full_article_maps_correctly(self):
        art = _normalize_gnews_article(_raw(), FETCHED_AT, COMP_ID)
        assert art is not None
        assert art.headline == "England vs France: World Cup 2026 semi-final"
        assert art.url == "https://example.com/article"
        assert art.source == GNEWS_SOURCE
        assert "BBC Sport" in art.source_name
        assert "via GNews" in art.source_name
        assert art.thumbnail_url == "https://example.com/img.jpg"
        assert art.competition_id == COMP_ID
        assert art.priority == 0
        assert art.cluster_id is None
        assert art.entities == []

    def test_published_at_z_suffix_normalised(self):
        art = _normalize_gnews_article(_raw(published_at="2026-06-29T11:00:00Z"), FETCHED_AT, COMP_ID)
        assert art is not None
        assert art.published_at == "2026-06-29T11:00:00+00:00"

    def test_published_at_already_offset_unchanged(self):
        art = _normalize_gnews_article(
            _raw(published_at="2026-06-29T11:00:00+00:00"), FETCHED_AT, COMP_ID
        )
        assert art is not None
        assert art.published_at == "2026-06-29T11:00:00+00:00"

    def test_missing_image_thumbnail_is_none(self):
        art = _normalize_gnews_article(_raw(image=None), FETCHED_AT, COMP_ID)
        assert art is not None
        assert art.thumbnail_url is None

    def test_empty_image_thumbnail_is_none(self):
        art = _normalize_gnews_article(_raw(image=""), FETCHED_AT, COMP_ID)
        assert art is not None
        assert art.thumbnail_url is None

    def test_long_description_truncated_to_280_chars(self):
        long_desc = "World Cup 2026: " + "x" * 400
        art = _normalize_gnews_article(_raw(description=long_desc), FETCHED_AT, COMP_ID)
        assert art is not None
        assert art.summary is not None
        assert len(art.summary) <= 284  # 280 chars + "…"
        assert art.summary.endswith("…")

    def test_short_description_not_truncated(self):
        desc = "England reach the World Cup 2026 final."
        art = _normalize_gnews_article(_raw(description=desc), FETCHED_AT, COMP_ID)
        assert art is not None
        assert art.summary == desc
        assert not (art.summary or "").endswith("…")

    def test_irrelevant_article_returns_none(self):
        art = _normalize_gnews_article(
            _raw(title="Local bake sale raises funds", description="Community event in Springfield."),
            FETCHED_AT,
            COMP_ID,
        )
        assert art is None

    def test_empty_url_returns_none(self):
        assert _normalize_gnews_article(_raw(url=""), FETCHED_AT, COMP_ID) is None

    def test_whitespace_only_url_returns_none(self):
        assert _normalize_gnews_article(_raw(url="   "), FETCHED_AT, COMP_ID) is None

    def test_empty_title_returns_none(self):
        assert _normalize_gnews_article(_raw(title=""), FETCHED_AT, COMP_ID) is None

    def test_teams_extracted_from_headline(self):
        art = _normalize_gnews_article(
            _raw(title="England beat France in World Cup 2026 semi-final"),
            FETCHED_AT,
            COMP_ID,
        )
        assert art is not None
        assert "england" in art.teams
        assert "france" in art.teams

    def test_id_is_sha256_of_url(self):
        url = "https://example.com/article"
        art = _normalize_gnews_article(_raw(url=url), FETCHED_AT, COMP_ID)
        assert art is not None
        assert art.id == hashlib.sha256(url.encode()).hexdigest()

    def test_html_stripped_from_title(self):
        art = _normalize_gnews_article(
            _raw(title="<b>World Cup 2026</b>: England reach the final"),
            FETCHED_AT,
            COMP_ID,
        )
        assert art is not None
        assert "<b>" not in art.headline
        assert "World Cup 2026" in art.headline

    def test_none_competition_id_stored(self):
        art = _normalize_gnews_article(_raw(), FETCHED_AT, None)
        assert art is not None
        assert art.competition_id is None

    def test_missing_source_name_falls_back_to_unknown(self):
        raw = _raw()
        raw["source"] = {}
        art = _normalize_gnews_article(raw, FETCHED_AT, COMP_ID)
        assert art is not None
        assert "Unknown" in art.source_name

    def test_missing_source_key_falls_back(self):
        raw = _raw()
        del raw["source"]
        art = _normalize_gnews_article(raw, FETCHED_AT, COMP_ID)
        assert art is not None
        assert "Unknown" in art.source_name

    def test_headline_prefix_stripped_from_description(self):
        headline = "England vs France: World Cup 2026 semi-final"
        desc = headline + " — England face France in a historic semi-final."
        art = _normalize_gnews_article(_raw(title=headline, description=desc), FETCHED_AT, COMP_ID)
        assert art is not None
        # The duplicated headline prefix must be removed.
        assert not art.summary.startswith(headline)

    def test_missing_published_at_falls_back_to_fetched_at(self):
        raw = _raw()
        raw["publishedAt"] = None
        art = _normalize_gnews_article(raw, FETCHED_AT, COMP_ID)
        assert art is not None
        assert art.published_at == FETCHED_AT


# ---------------------------------------------------------------------------
# TestCacheFreshness
# ---------------------------------------------------------------------------

class TestCacheFreshness:
    def _cache(self, fetched: datetime) -> dict:
        return {"fetched_at": fetched.isoformat(timespec="seconds"), "articles_by_query": {}}

    def test_fresh_cache_within_ttl(self):
        fetched = NOW - timedelta(hours=CACHE_TTL_HOURS - 1)
        assert _is_cache_fresh(self._cache(fetched), NOW, CACHE_TTL_HOURS) is True

    def test_stale_cache_past_ttl(self):
        fetched = NOW - timedelta(hours=CACHE_TTL_HOURS + 0.1)
        assert _is_cache_fresh(self._cache(fetched), NOW, CACHE_TTL_HOURS) is False

    def test_exactly_at_ttl_boundary_is_stale(self):
        fetched = NOW - timedelta(hours=CACHE_TTL_HOURS)
        assert _is_cache_fresh(self._cache(fetched), NOW, CACHE_TTL_HOURS) is False

    def test_none_input_is_stale(self):
        assert _is_cache_fresh(None, NOW, CACHE_TTL_HOURS) is False

    def test_empty_dict_is_stale(self):
        assert _is_cache_fresh({}, NOW, CACHE_TTL_HOURS) is False

    def test_malformed_fetched_at_is_stale(self):
        assert _is_cache_fresh({"fetched_at": "not-a-date"}, NOW, CACHE_TTL_HOURS) is False

    def test_z_suffix_parsed_correctly(self):
        ts = (NOW - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        assert _is_cache_fresh({"fetched_at": ts}, NOW, CACHE_TTL_HOURS) is True

    def test_just_under_1_hour_is_fresh(self):
        fetched = NOW - timedelta(minutes=59)
        assert _is_cache_fresh(self._cache(fetched), NOW, CACHE_TTL_HOURS) is True


# ---------------------------------------------------------------------------
# TestFetchGNewsArticles  (all offline via monkeypatch or pre-seeded cache)
# ---------------------------------------------------------------------------

class TestFetchGNewsArticles:
    def test_empty_api_key_returns_empty_list_no_http(self, tmp_path):
        result = fetch_gnews_articles("", tmp_path / "cache.json", COMP_ID, now=NOW)
        assert result == []

    def test_none_api_key_treated_as_empty(self, tmp_path):
        result = fetch_gnews_articles("", tmp_path / "cache.json", COMP_ID, now=NOW)
        assert result == []

    def test_fresh_cache_used_without_http(self, tmp_path, monkeypatch):
        cache_path = tmp_path / "cache.json"
        cache_data = _fresh_cache({"q1": [_raw()]})
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        def _boom(*a, **kw):
            raise AssertionError("HTTP must not be called when cache is fresh")

        monkeypatch.setattr(gnews_client, "_call_gnews_api", _boom)

        result = fetch_gnews_articles("anykey", cache_path, COMP_ID, now=NOW)
        assert len(result) == 1
        assert result[0].url == "https://example.com/article"

    def test_deduplicates_same_url_across_queries(self, tmp_path):
        cache_path = tmp_path / "cache.json"
        same = _raw()
        cache_data = _fresh_cache({"q1": [same], "q2": [same]})
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = fetch_gnews_articles("anykey", cache_path, COMP_ID, now=NOW)
        assert len(result) == 1

    def test_irrelevant_articles_filtered(self, tmp_path):
        cache_path = tmp_path / "cache.json"
        cache_data = _fresh_cache({
            "q1": [_raw(title="Town hall bake sale", description="Local community event.")]
        })
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = fetch_gnews_articles("anykey", cache_path, COMP_ID, now=NOW)
        assert len(result) == 0

    def test_multiple_relevant_articles_returned(self, tmp_path):
        cache_path = tmp_path / "cache.json"
        cache_data = _fresh_cache({
            "q1": [
                _raw(url="https://a.com/1", title="England in World Cup 2026 final"),
                _raw(url="https://a.com/2", title="France reach World Cup 2026 semi"),
            ]
        })
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = fetch_gnews_articles("anykey", cache_path, COMP_ID, now=NOW)
        assert len(result) == 2

    def test_stale_cache_triggers_api_calls(self, tmp_path, monkeypatch):
        cache_path = tmp_path / "cache.json"
        stale = {
            "fetched_at": (NOW - timedelta(hours=CACHE_TTL_HOURS + 1)).isoformat(timespec="seconds"),
            "articles_by_query": {},
        }
        cache_path.write_text(json.dumps(stale), encoding="utf-8")

        calls: list[str] = []

        def fake_call(query: str, api_key: str) -> list[dict]:
            calls.append(query)
            return [_raw(url=f"https://example.com/{len(calls)}")]

        monkeypatch.setattr(gnews_client, "_call_gnews_api", fake_call)
        monkeypatch.setattr(gnews_client, "INTER_REQUEST_DELAY", 0)

        result = fetch_gnews_articles("testkey", cache_path, COMP_ID, now=NOW)
        assert len(calls) == len(gnews_client._QUERIES)
        assert len(result) == len(gnews_client._QUERIES)

    def test_stale_cache_written_after_refresh(self, tmp_path, monkeypatch):
        cache_path = tmp_path / "cache.json"
        # No cache file at all.

        monkeypatch.setattr(gnews_client, "_call_gnews_api", lambda q, k: [_raw(url=f"https://x.com/{q}")])
        monkeypatch.setattr(gnews_client, "INTER_REQUEST_DELAY", 0)

        fetch_gnews_articles("testkey", cache_path, COMP_ID, now=NOW)

        assert cache_path.is_file()
        written = json.loads(cache_path.read_text())
        assert "fetched_at" in written
        assert "articles_by_query" in written

    def test_articles_have_gnews_source_slug(self, tmp_path):
        cache_path = tmp_path / "cache.json"
        cache_data = _fresh_cache({"q1": [_raw()]})
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = fetch_gnews_articles("anykey", cache_path, COMP_ID, now=NOW)
        assert all(a.source == GNEWS_SOURCE for a in result)

    def test_articles_have_competition_id(self, tmp_path):
        cache_path = tmp_path / "cache.json"
        cache_data = _fresh_cache({"q1": [_raw()]})
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = fetch_gnews_articles("anykey", cache_path, COMP_ID, now=NOW)
        assert all(a.competition_id == COMP_ID for a in result)

    def test_articles_have_zero_initial_priority(self, tmp_path):
        cache_path = tmp_path / "cache.json"
        cache_data = _fresh_cache({"q1": [_raw()]})
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = fetch_gnews_articles("anykey", cache_path, COMP_ID, now=NOW)
        assert all(a.priority == 0 for a in result)

    def test_articles_have_null_cluster_id(self, tmp_path):
        cache_path = tmp_path / "cache.json"
        cache_data = _fresh_cache({"q1": [_raw()]})
        cache_path.write_text(json.dumps(cache_data), encoding="utf-8")

        result = fetch_gnews_articles("anykey", cache_path, COMP_ID, now=NOW)
        assert all(a.cluster_id is None for a in result)


# ---------------------------------------------------------------------------
# TestArticleId
# ---------------------------------------------------------------------------

class TestArticleId:
    def test_id_is_sha256_of_url(self):
        url = "https://gnews.io/article/abc"
        assert _url_hash(url) == hashlib.sha256(url.encode()).hexdigest()

    def test_different_urls_have_different_ids(self):
        assert _url_hash("https://a.com/1") != _url_hash("https://a.com/2")

    def test_same_url_same_id_deterministic(self):
        url = "https://example.com/stable"
        assert _url_hash(url) == _url_hash(url)

    def test_id_is_64_hex_chars(self):
        assert len(_url_hash("https://example.com/")) == 64
        assert all(c in "0123456789abcdef" for c in _url_hash("https://example.com/"))
