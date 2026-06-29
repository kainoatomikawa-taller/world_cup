#!/usr/bin/env python3
"""
news_utils.py — shared types and utilities for news ingest scripts.

Extracted from ingest_news.py so that gnews_client.py and any future ingest
source modules can import common code without creating circular dependencies.

Modules that use this:
    ingest_news.py   — RSS feed ingest
    gnews_client.py  — GNews API ingest (Phase 3)
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Optional

# Maximum characters for the summary excerpt.
# Aggregator contract: never store full article text.
MAX_SUMMARY_CHARS = 280


# ---------------------------------------------------------------------------
# Article data class (shared across all ingest sources)
# ---------------------------------------------------------------------------

@dataclass
class Article:
    id: str                          # SHA-256 hex of canonical url
    competition_id: Optional[str]
    source: str                      # machine slug, e.g. 'bbc-sport', 'gnews'
    source_name: str                 # display name, e.g. 'BBC Sport'
    headline: str
    url: str
    thumbnail_url: Optional[str]
    summary: Optional[str]           # ≤ MAX_SUMMARY_CHARS; never full text
    published_at: str                # ISO 8601
    teams: list[str]                 # canonical team slugs
    entities: list[str]              # player/coach/venue slugs (Phase 2+)
    cluster_id: Optional[str]        # assigned by cluster_news.py
    priority: int                    # 0–1000; assigned by rank_news.py
    fetched_at: str                  # ISO 8601 ingest timestamp


def _url_hash(url: str) -> str:
    """SHA-256 hex digest of the canonical URL — used as news.id primary key."""
    return hashlib.sha256(url.encode()).hexdigest()


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
    """Remove HTML tags and collapse whitespace; return plain text."""
    stripper = _HTMLStripper()
    try:
        stripper.feed(raw)
    except Exception:
        pass
    return re.sub(r"\s+", " ", stripper.get_text()).strip()


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

# Combined lookup: lowercase term → canonical slug.
# Longer terms must win over shorter ones (e.g. "south korea" before "korea").
_TEAM_LOOKUP: dict[str, str] = {}
for _t in _TEAMS:
    _TEAM_LOOKUP[_t.name.lower()] = _t.id
    _slug_as_words = _t.id.replace("-", " ")
    if _slug_as_words != _t.name.lower():
        _TEAM_LOOKUP[_slug_as_words] = _t.id
_TEAM_LOOKUP.update(_TEAM_ALIASES)


# ---------------------------------------------------------------------------
# Relevance filter
# ---------------------------------------------------------------------------

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

# Merge in all team-name terms so any article naming a WC team passes.
_RELEVANCE_TERMS: frozenset[str] = _BASE_RELEVANCE | frozenset(_TEAM_LOOKUP.keys())

# Terms that definitively indicate a non-football sport.  An article matching
# any of these is excluded even if it also names a World Cup team (e.g. an
# England cricket article mentions "England" which is a WC team slug).
_SPORT_BLOCKLIST: frozenset[str] = frozenset([
    "cricket",
    "wicket",
    "innings",
    "ashes",
    "test match",
    " nfl ",
    "nfl draft",
    "super bowl",
    " nba ",
    " nhl ",
    " mlb ",
    "basketball",
    "baseball",
    "ice hockey",
    "formula 1",
    "formula one",
    " f1 grand",
    "motogp",
    "le mans",
    " golf ",
    "pga tour",
    "masters tournament",
    "wimbledon",
    "tennis",
    " ufc ",
    " mma ",
    "boxing match",
    "heavyweight",
    "rugby union",
    "rugby league",
    "six nations",
    "super rugby",
    "cycling race",
    "tour de france",
])


def _is_relevant(headline: str, summary: str) -> bool:
    """Return True if the article is football/World Cup relevant.

    First rejects articles that mention a sport-specific term from
    _SPORT_BLOCKLIST, then requires at least one term from _RELEVANCE_TERMS.
    """
    combined = (headline + " " + summary).lower()
    if any(term in combined for term in _SPORT_BLOCKLIST):
        return False
    return any(term in combined for term in _RELEVANCE_TERMS)


def _extract_teams(headline: str, summary: str) -> list[str]:
    """Return a deduplicated list of canonical team slugs mentioned in the text.

    Uses substring matching (case-insensitive) against the team lookup table.
    Longer terms are checked first so 'South Korea' matches before a shorter
    alias could shadow it.
    """
    combined = (headline + " " + summary).lower()
    found: list[str] = []
    seen_slugs: set[str] = set()
    for term, slug in sorted(_TEAM_LOOKUP.items(), key=lambda kv: -len(kv[0])):
        if slug not in seen_slugs and term in combined:
            found.append(slug)
            seen_slugs.add(slug)
    return found
