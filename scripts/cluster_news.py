#!/usr/bin/env python3
"""
cluster_news.py — Phase 2: assign cluster_id and extract entity mentions.

Reads all articles from the news table, groups near-duplicate stories from
different outlets by headline similarity + shared teams, then writes back:
  • cluster_id — stable hex ID shared by all articles in a cluster.
  • entities   — JSON array of player/coach/venue slugs extracted from text.

A cluster_id is stable across re-runs: it is the first 16 hex chars of the
SHA-256 of the URL of the *earliest* article in the cluster, so adding new
articles to an existing story does not change the identifier.

Algorithm
---------
1. Load all articles from the news table (id, headline, url, teams, published_at).
2. Tokenize each headline into a frozenset of meaningful words.
3. Extract entity slugs (players, coaches, venues) by keyword scan.
4. Use a time-windowed union-find pass to merge articles that are:
   - Published within WINDOW_HOURS of each other, AND
   - Have headline Jaccard ≥ SIMILARITY_THRESHOLD (optionally boosted by
     shared team mentions, which lifts the score by 0.2).
5. Derive cluster_id: first CLUSTER_ID_LEN hex chars of SHA-256(earliest_url).
6. UPDATE news SET cluster_id = ?, entities = ? for every row (idempotent).

Usage:
    python scripts/cluster_news.py
    python scripts/cluster_news.py --dry-run
    python scripts/cluster_news.py --threshold 0.25 --window-hours 48
    python scripts/cluster_news.py --db-path /path/to.db
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import DEFAULT_DB

# ---------------------------------------------------------------------------
# Tuning constants
# ---------------------------------------------------------------------------

DEFAULT_SIMILARITY_THRESHOLD: float = 0.25
DEFAULT_WINDOW_HOURS: int = 48
CLUSTER_ID_LEN: int = 16   # hex chars of SHA-256 (64 bits); collision-proof for ~400 articles

# ---------------------------------------------------------------------------
# Stopwords — removed before Jaccard similarity to focus on content words
# ---------------------------------------------------------------------------

_STOPWORDS: frozenset[str] = frozenset({
    "the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or",
    "with", "is", "are", "was", "were", "be", "been", "will", "would",
    "could", "should", "by", "from", "as", "its", "his", "her", "their",
    "this", "that", "these", "those", "it", "he", "she", "they", "we",
    "has", "have", "had", "not", "but", "so", "up", "out", "if", "do",
    "did", "does", "get", "got", "after", "before", "into", "over",
    "about", "how", "who", "what", "when", "where", "which", "than",
    "more", "can", "just", "also", "new", "may", "no", "vs", "v",
    "world", "cup", "fifa", "2026", "soccer", "football", "match",
    "game", "says", "say", "said", "ahead", "set", "win", "wins",
    "report", "live", "preview", "latest", "update", "all",
})

# ---------------------------------------------------------------------------
# Entity keyword registry — player / coach / venue slugs
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _EntityDef:
    slug: str
    kind: str            # 'player' | 'coach' | 'venue'
    aliases: tuple[str, ...]


_ENTITIES: tuple[_EntityDef, ...] = (
    # ── Players ──────────────────────────────────────────────────────────────
    _EntityDef("lionel-messi",          "player", ("messi",)),
    _EntityDef("cristiano-ronaldo",     "player", ("ronaldo", "cr7")),
    _EntityDef("kylian-mbappe",         "player", ("mbappé", "mbappe")),
    _EntityDef("neymar",                "player", ("neymar",)),
    _EntityDef("robert-lewandowski",    "player", ("lewandowski",)),
    _EntityDef("mohamed-salah",         "player", ("salah",)),
    _EntityDef("harry-kane",            "player", ("harry kane",)),
    _EntityDef("kevin-de-bruyne",       "player", ("de bruyne", "kevin de bruyne")),
    _EntityDef("luka-modric",           "player", ("modric", "modrić")),
    _EntityDef("pedri",                 "player", ("pedri",)),
    _EntityDef("jude-bellingham",       "player", ("bellingham",)),
    _EntityDef("vinicius-junior",       "player", ("vinicius", "vinícius", "vini jr")),
    _EntityDef("victor-osimhen",        "player", ("osimhen",)),
    _EntityDef("bukayo-saka",           "player", ("saka",)),
    _EntityDef("declan-rice",           "player", ("declan rice",)),
    _EntityDef("marcus-rashford",       "player", ("rashford",)),
    _EntityDef("antoine-griezmann",     "player", ("griezmann",)),
    _EntityDef("ousmane-dembele",       "player", ("dembélé", "dembele")),
    _EntityDef("lamine-yamal",          "player", ("yamal",)),
    _EntityDef("rafael-leao",           "player", ("leao", "leão")),
    _EntityDef("casemiro",              "player", ("casemiro",)),
    _EntityDef("federico-valverde",     "player", ("valverde",)),
    _EntityDef("alphonso-davies",       "player", ("alphonso davies",)),
    _EntityDef("christian-pulisic",     "player", ("pulisic",)),
    _EntityDef("erling-haaland",        "player", ("haaland",)),
    _EntityDef("phil-foden",            "player", ("foden",)),
    _EntityDef("jamal-musiala",         "player", ("musiala",)),
    _EntityDef("florian-wirtz",         "player", ("wirtz",)),
    _EntityDef("gavi",                  "player", ("gavi",)),
    _EntityDef("rodri",                 "player", ("rodri",)),
    _EntityDef("thiago-silva",          "player", ("thiago silva",)),
    _EntityDef("alisson-becker",        "player", ("alisson",)),
    _EntityDef("thibaut-courtois",      "player", ("courtois",)),
    _EntityDef("manuel-neuer",          "player", ("neuer",)),
    _EntityDef("virgil-van-dijk",       "player", ("van dijk",)),
    _EntityDef("ruben-dias",            "player", ("rúben dias", "ruben dias")),
    _EntityDef("achraf-hakimi",         "player", ("hakimi",)),
    _EntityDef("sadio-mane",            "player", ("mané", "sadio mane")),
    _EntityDef("richarlison",           "player", ("richarlison",)),
    _EntityDef("lucas-paqueta",         "player", ("paquetá", "paqueta")),
    _EntityDef("gabriel-martinelli",    "player", ("martinelli",)),
    _EntityDef("darwin-nunez",          "player", ("núñez", "darwin nunez")),
    _EntityDef("tim-weah",              "player", ("tim weah",)),
    _EntityDef("weston-mckennie",       "player", ("mckennie",)),
    _EntityDef("tyler-adams",           "player", ("tyler adams",)),
    # ── Coaches ──────────────────────────────────────────────────────────────
    _EntityDef("lionel-scaloni",        "coach",  ("scaloni",)),
    _EntityDef("didier-deschamps",      "coach",  ("deschamps",)),
    _EntityDef("hansi-flick",           "coach",  ("hansi flick",)),
    _EntityDef("luis-de-la-fuente",     "coach",  ("de la fuente",)),
    _EntityDef("thomas-tuchel",         "coach",  ("tuchel",)),
    _EntityDef("roberto-martinez",      "coach",  ("roberto martínez", "roberto martinez")),
    _EntityDef("carlo-ancelotti",       "coach",  ("ancelotti",)),
    _EntityDef("pep-guardiola",         "coach",  ("guardiola",)),
    _EntityDef("jurgen-klopp",          "coach",  ("klopp",)),
    # ── Venues ───────────────────────────────────────────────────────────────
    _EntityDef("metlife-stadium",       "venue",  ("metlife",)),
    _EntityDef("att-stadium",           "venue",  ("at&t stadium", "arlington")),
    _EntityDef("sofi-stadium",          "venue",  ("sofi stadium",)),
    _EntityDef("levis-stadium",         "venue",  ("levi's stadium", "levis stadium")),
    _EntityDef("rose-bowl",             "venue",  ("rose bowl",)),
    _EntityDef("hard-rock-stadium",     "venue",  ("hard rock stadium",)),
    _EntityDef("arrowhead-stadium",     "venue",  ("arrowhead stadium",)),
    _EntityDef("nrg-stadium",           "venue",  ("nrg stadium",)),
    _EntityDef("estadio-azteca",        "venue",  ("estadio azteca", "azteca")),
    _EntityDef("estadio-akron",         "venue",  ("estadio akron",)),
    _EntityDef("bmo-field",             "venue",  ("bmo field",)),
    _EntityDef("bc-place",              "venue",  ("bc place",)),
    _EntityDef("commonwealth-stadium",  "venue",  ("commonwealth stadium",)),
)

# Build alias → slug lookup (longest-first so longer aliases win substring checks).
_ENTITY_LOOKUP: list[tuple[str, str]] = sorted(
    ((alias.lower(), ent.slug) for ent in _ENTITIES for alias in ent.aliases),
    key=lambda kv: -len(kv[0]),
)


def extract_entities(headline: str, summary: str) -> list[str]:
    """Return deduplicated entity slugs (players/coaches/venues) mentioned in text.

    Uses longest-match-first substring scanning (same strategy as team extraction
    in ingest_news.py) so multi-word aliases like 'declan rice' beat single-word
    fragments that could appear as substrings of unrelated words.
    """
    combined = (headline + " " + (summary or "")).lower()
    found: list[str] = []
    seen: set[str] = set()
    for alias, slug in _ENTITY_LOOKUP:
        if slug not in seen and alias in combined:
            found.append(slug)
            seen.add(slug)
    return found


# ---------------------------------------------------------------------------
# Headline tokenization
# ---------------------------------------------------------------------------

def tokenize(text: str) -> frozenset[str]:
    """Lowercase → strip non-alphanumeric → split → remove stopwords and short tokens."""
    words = re.sub(r"[^a-z0-9 ]", " ", text.lower()).split()
    return frozenset(w for w in words if w not in _STOPWORDS and len(w) > 2)


# ---------------------------------------------------------------------------
# Similarity
# ---------------------------------------------------------------------------

def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    """Jaccard similarity |A∩B| / |A∪B|; 0 for two empty sets."""
    union_size = len(a | b)
    if union_size == 0:
        return 0.0
    return len(a & b) / union_size


def similarity_score(
    tokens_a: frozenset[str],
    tokens_b: frozenset[str],
    teams_a: frozenset[str],
    teams_b: frozenset[str],
) -> float:
    """Headline Jaccard plus a +0.20 bonus when the articles share at least one team."""
    score = jaccard(tokens_a, tokens_b)
    if teams_a & teams_b:
        score = min(1.0, score + 0.20)
    return score


# ---------------------------------------------------------------------------
# Union-Find (disjoint-set union) — handles transitive clustering
# ---------------------------------------------------------------------------

class _UnionFind:
    """Path-compressed, union-by-rank disjoint set union."""

    def __init__(self, keys: list[str]) -> None:
        self._parent: dict[str, str] = {k: k for k in keys}
        self._rank: dict[str, int] = {k: 0 for k in keys}

    def find(self, x: str) -> str:
        while self._parent[x] != x:
            self._parent[x] = self._parent[self._parent[x]]   # path halving
            x = self._parent[x]
        return x

    def union(self, x: str, y: str) -> None:
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return
        if self._rank[rx] < self._rank[ry]:
            rx, ry = ry, rx
        self._parent[ry] = rx
        if self._rank[rx] == self._rank[ry]:
            self._rank[rx] += 1

    def groups(self) -> dict[str, list[str]]:
        """Return {root_id: [member_id, ...]} for all groups."""
        result: dict[str, list[str]] = defaultdict(list)
        for k in self._parent:
            result[self.find(k)].append(k)
        return dict(result)


# ---------------------------------------------------------------------------
# Article data class
# ---------------------------------------------------------------------------

@dataclass
class _Article:
    id: str
    url: str
    headline: str
    summary: str
    published_at: str           # ISO 8601
    teams: frozenset[str]
    tokens: frozenset[str] = field(default_factory=frozenset)
    entities: list[str] = field(default_factory=list)

    def published_dt(self) -> datetime:
        """Parse published_at to an aware UTC datetime (best-effort)."""
        s = self.published_at
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except (ValueError, OverflowError):
            try:
                return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
            except ValueError:
                return datetime.min.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Cluster ID derivation
# ---------------------------------------------------------------------------

def make_cluster_id(url: str) -> str:
    """Return the first CLUSTER_ID_LEN hex chars of SHA-256(url).

    Stable: the same URL always produces the same cluster_id, and cluster_id
    is derived from the *earliest* article's URL so adding later articles to a
    cluster does not change the identifier.
    """
    return hashlib.sha256(url.encode()).hexdigest()[:CLUSTER_ID_LEN]


# ---------------------------------------------------------------------------
# Core clustering
# ---------------------------------------------------------------------------

def cluster_articles(
    articles: list[_Article],
    threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    window_hours: int = DEFAULT_WINDOW_HOURS,
) -> dict[str, str]:
    """Return {article_id: cluster_id} for every article.

    Articles with no near-duplicate get a solo cluster (cluster_id derived from
    their own URL).

    Algorithm:
    1. Sort by published_at ascending.
    2. For each article i, scan backwards through j < i while the time gap stays
       within window_hours.  If similarity_score ≥ threshold: union(i, j).
    3. After all comparisons, derive cluster_id for each group from the URL of
       the earliest article in that group.
    """
    if not articles:
        return {}

    arts = sorted(articles, key=lambda a: a.published_at)
    window_secs = window_hours * 3600
    uf = _UnionFind([a.id for a in arts])
    id_to_art: dict[str, _Article] = {a.id: a for a in arts}

    for i, art_i in enumerate(arts):
        dt_i = art_i.published_dt()
        for j in range(i - 1, -1, -1):
            art_j = arts[j]
            gap = (dt_i - art_j.published_dt()).total_seconds()
            if gap > window_secs:
                break   # arts are sorted; earlier articles can't be in window
            score = similarity_score(art_i.tokens, art_j.tokens, art_i.teams, art_j.teams)
            if score >= threshold:
                uf.union(art_i.id, art_j.id)

    groups = uf.groups()
    result: dict[str, str] = {}
    for _root, members in groups.items():
        earliest_id = min(members, key=lambda aid: id_to_art[aid].published_at)
        cid = make_cluster_id(id_to_art[earliest_id].url)
        for aid in members:
            result[aid] = cid

    return result


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _load_articles(conn: sqlite3.Connection) -> list[_Article]:
    """Read all news rows and return as _Article objects with tokens + entities computed."""
    rows = conn.execute(
        "SELECT id, url, headline, summary, published_at, teams FROM news"
    ).fetchall()
    arts: list[_Article] = []
    for row in rows:
        _id, url, headline, summary, published_at, teams_json = row
        try:
            teams: frozenset[str] = frozenset(json.loads(teams_json or "[]"))
        except (json.JSONDecodeError, TypeError):
            teams = frozenset()
        art = _Article(
            id=_id,
            url=url or "",
            headline=headline or "",
            summary=summary or "",
            published_at=published_at or "",
            teams=teams,
        )
        art.tokens = tokenize(art.headline)
        art.entities = extract_entities(art.headline, art.summary)
        arts.append(art)
    return arts


def _update_articles(
    conn: sqlite3.Connection,
    articles: list[_Article],
    cluster_map: dict[str, str],
    dry_run: bool,
) -> tuple[int, int]:
    """UPDATE news SET cluster_id = ?, entities = ? for each article.

    Returns (updated, unchanged) counts based on rows whose cluster_id actually changed.
    """
    before: dict[str, str | None] = {
        row[0]: row[1]
        for row in conn.execute("SELECT id, cluster_id FROM news").fetchall()
    }

    rows = [
        (cluster_map[a.id], json.dumps(a.entities, ensure_ascii=False), a.id)
        for a in articles
        if a.id in cluster_map
    ]

    if dry_run:
        changed = sum(1 for a in articles if before.get(a.id) != cluster_map.get(a.id))
        print(f"  [dry-run] would update {changed} row(s) ({len(rows)} total)")
        return 0, len(rows)

    conn.executemany(
        "UPDATE news SET cluster_id = ?, entities = ? WHERE id = ?",
        rows,
    )
    conn.commit()

    updated = sum(
        1 for a in articles
        if a.id in cluster_map and before.get(a.id) != cluster_map[a.id]
    )
    return updated, len(rows) - updated


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run(
    db_path: Path,
    threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    window_hours: int = DEFAULT_WINDOW_HOURS,
    dry_run: bool = False,
) -> None:
    """Load news, cluster, and write cluster_id + entities back to the database."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        articles = _load_articles(conn)
        if not articles:
            print("No articles to cluster — news table is empty.")
            return

        print(f"Loaded {len(articles)} article(s).")

        cluster_map = cluster_articles(articles, threshold=threshold, window_hours=window_hours)

        clusters_by_id: dict[str, list[str]] = defaultdict(list)
        for aid, cid in cluster_map.items():
            clusters_by_id[cid].append(aid)

        n_multi = sum(1 for members in clusters_by_id.values() if len(members) > 1)
        n_solo = len(clusters_by_id) - n_multi
        print(
            f"  Formed {len(clusters_by_id)} cluster(s): "
            f"{n_multi} multi-article, {n_solo} solo."
        )

        updated, unchanged = _update_articles(conn, articles, cluster_map, dry_run)
        tag = "[dry-run] " if dry_run else ""
        print(f"{tag}Done — {updated} row(s) updated, {unchanged} already current.")
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
                        help="Compute clusters but do not write to the database")
    parser.add_argument("--threshold", type=float, default=DEFAULT_SIMILARITY_THRESHOLD,
                        metavar="FLOAT",
                        help=f"Jaccard similarity threshold (default: {DEFAULT_SIMILARITY_THRESHOLD})")
    parser.add_argument("--window-hours", type=int, default=DEFAULT_WINDOW_HOURS,
                        metavar="N",
                        help=f"Maximum hours between articles in the same cluster (default: {DEFAULT_WINDOW_HOURS})")
    args = parser.parse_args()
    run(args.db_path, threshold=args.threshold, window_hours=args.window_hours, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
