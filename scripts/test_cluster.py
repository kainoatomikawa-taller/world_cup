"""
test_cluster.py — unit tests for the Phase 2 clustering module (cluster_news.py).

Tests cover:
- Headline tokenization (stopword removal, punctuation stripping)
- Jaccard similarity
- Entity extraction (players, coaches, venues)
- Union-Find correctness (transitivity, path compression)
- similarity_score with team-overlap bonus
- Full clustering with representative multi-source fixtures:
  - Near-duplicate headlines from different sources → same cluster
  - Unrelated articles → separate clusters
  - Time-window boundary (inside vs. outside 48 h)
  - Transitive clustering: A~B, B~C → A,B,C in one cluster
  - Team-overlap boost: similar teams push borderline articles into same cluster
  - Four sources covering the same match → exactly one cluster
  - Stable cluster_id: earliest URL wins, input order doesn't matter
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from cluster_news import (
    DEFAULT_SIMILARITY_THRESHOLD,
    DEFAULT_WINDOW_HOURS,
    _Article,
    _UnionFind,
    cluster_articles,
    extract_entities,
    jaccard,
    make_cluster_id,
    similarity_score,
    tokenize,
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

_BASE_DT = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)


def _dt(offset_hours: float = 0) -> str:
    return (_BASE_DT + timedelta(hours=offset_hours)).isoformat()


def _art(
    headline: str,
    *,
    url: str = "",
    summary: str = "",
    teams: list[str] | None = None,
    pub_offset_hours: float = 0,
) -> _Article:
    """Build a minimal _Article with tokenization and entity extraction pre-computed."""
    effective_url = url or f"https://test.example/{hashlib.sha256(headline.encode()).hexdigest()[:8]}"
    art = _Article(
        id=hashlib.sha256(effective_url.encode()).hexdigest()[:12],
        url=effective_url,
        headline=headline,
        summary=summary,
        published_at=_dt(pub_offset_hours),
        teams=frozenset(teams or []),
    )
    art.tokens = tokenize(art.headline)
    art.entities = extract_entities(art.headline, art.summary)
    return art


# ---------------------------------------------------------------------------
# tokenize
# ---------------------------------------------------------------------------

class TestTokenize:
    def test_strips_punctuation(self):
        tokens = tokenize("Kane scores! Brazil vs England?")
        assert "kane" in tokens
        assert "scores" in tokens

    def test_lowercases(self):
        assert "argentina" in tokenize("ARGENTINA wins")

    def test_removes_stopwords(self):
        tokens = tokenize("The World Cup football game is on")
        assert "the" not in tokens
        assert "world" not in tokens
        assert "cup" not in tokens
        assert "football" not in tokens

    def test_filters_short_tokens(self):
        tokens = tokenize("a vs b")
        # all tokens are stopwords or length ≤ 2
        assert len(tokens) == 0

    def test_meaningful_content_words_kept(self):
        tokens = tokenize("Messi leads Argentina to victory over Brazil")
        assert "messi" in tokens
        assert "argentina" in tokens
        assert "victory" in tokens
        assert "brazil" in tokens

    def test_empty_string_returns_empty_frozenset(self):
        assert tokenize("") == frozenset()

    def test_returns_frozenset(self):
        assert isinstance(tokenize("hello world"), frozenset)


# ---------------------------------------------------------------------------
# jaccard
# ---------------------------------------------------------------------------

class TestJaccard:
    def test_identical_sets(self):
        s = frozenset({"argentina", "brazil", "goal"})
        assert jaccard(s, s) == 1.0

    def test_disjoint_sets(self):
        assert jaccard(frozenset({"alpha"}), frozenset({"omega"})) == 0.0

    def test_partial_overlap(self):
        a = frozenset({"messi", "argentina", "goal"})
        b = frozenset({"messi", "argentina", "penalty"})
        # intersection=2, union=4
        assert abs(jaccard(a, b) - 0.5) < 1e-9

    def test_empty_sets_return_zero(self):
        assert jaccard(frozenset(), frozenset()) == 0.0

    def test_one_empty_set(self):
        assert jaccard(frozenset({"a"}), frozenset()) == 0.0

    def test_single_common_element(self):
        a = frozenset({"france"})
        b = frozenset({"france"})
        assert jaccard(a, b) == 1.0


# ---------------------------------------------------------------------------
# extract_entities
# ---------------------------------------------------------------------------

class TestExtractEntities:
    def test_extracts_player_by_alias(self):
        assert "lionel-messi" in extract_entities("Messi scores hat-trick", "")

    def test_case_insensitive(self):
        assert "kylian-mbappe" in extract_entities("MBAPPE stars for France", "")

    def test_extracts_coach(self):
        assert "lionel-scaloni" in extract_entities("Scaloni praises Argentina", "")

    def test_extracts_venue(self):
        assert "metlife-stadium" in extract_entities("Final at MetLife", "")

    def test_multiple_entities(self):
        entities = extract_entities("Bellingham and Mbappe duel at Rose Bowl", "")
        assert "jude-bellingham" in entities
        assert "kylian-mbappe" in entities
        assert "rose-bowl" in entities

    def test_cr7_alias(self):
        assert "cristiano-ronaldo" in extract_entities("CR7 outshines Messi", "")

    def test_no_false_positives_generic_headline(self):
        entities = extract_entities("Brazil draw with Colombia in opening match", "")
        # No player/coach/venue should fire for a generic result headline
        assert "lionel-messi" not in entities
        assert "metlife-stadium" not in entities

    def test_scans_summary_too(self):
        entities = extract_entities("France win", "Mbappe scored twice in the match")
        assert "kylian-mbappe" in entities

    def test_no_duplicates(self):
        entities = extract_entities("Messi Messi Messi", "Messi again")
        assert entities.count("lionel-messi") == 1

    def test_returns_list(self):
        assert isinstance(extract_entities("test", ""), list)


# ---------------------------------------------------------------------------
# similarity_score
# ---------------------------------------------------------------------------

class TestSimilarityScore:
    def test_identical_tokens_no_teams(self):
        tokens = frozenset({"argentina", "brazil", "final"})
        assert similarity_score(tokens, tokens, frozenset(), frozenset()) == 1.0

    def test_shared_teams_boost_applied(self):
        a = frozenset({"argentina", "stunning"})
        b = frozenset({"argentina", "triumph"})
        base = jaccard(a, b)              # 1/3 ≈ 0.33
        with_boost = similarity_score(a, b, frozenset({"argentina"}), frozenset({"argentina"}))
        assert with_boost > base
        assert with_boost <= 1.0

    def test_boost_capped_at_1(self):
        tokens = frozenset({"goal"})
        score = similarity_score(tokens, tokens, frozenset({"france"}), frozenset({"france"}))
        assert score == 1.0

    def test_no_shared_teams_no_boost(self):
        a = frozenset({"messi", "argentina"})
        b = frozenset({"messi", "france"})
        score = similarity_score(a, b, frozenset({"argentina"}), frozenset({"france"}))
        assert score == jaccard(a, b)    # no boost: teams don't overlap


# ---------------------------------------------------------------------------
# _UnionFind
# ---------------------------------------------------------------------------

class TestUnionFind:
    def test_single_element_in_own_group(self):
        uf = _UnionFind(["x"])
        assert uf.find("x") == "x"

    def test_union_merges_two(self):
        uf = _UnionFind(["a", "b", "c"])
        uf.union("a", "b")
        assert uf.find("a") == uf.find("b")
        assert uf.find("c") != uf.find("a")

    def test_transitivity(self):
        uf = _UnionFind(["a", "b", "c"])
        uf.union("a", "b")
        uf.union("b", "c")
        assert uf.find("a") == uf.find("b") == uf.find("c")

    def test_groups_correct(self):
        uf = _UnionFind(["a", "b", "c", "d"])
        uf.union("a", "b")
        uf.union("c", "d")
        groups = uf.groups()
        member_sets = {frozenset(v) for v in groups.values()}
        assert frozenset({"a", "b"}) in member_sets
        assert frozenset({"c", "d"}) in member_sets

    def test_union_idempotent(self):
        uf = _UnionFind(["a", "b"])
        uf.union("a", "b")
        uf.union("a", "b")  # second call should be a no-op
        groups = uf.groups()
        assert len(groups) == 1


# ---------------------------------------------------------------------------
# make_cluster_id
# ---------------------------------------------------------------------------

class TestMakeClusterId:
    def test_deterministic(self):
        url = "https://bbc.com/article/123"
        assert make_cluster_id(url) == make_cluster_id(url)

    def test_length(self):
        from cluster_news import CLUSTER_ID_LEN
        assert len(make_cluster_id("https://example.com/x")) == CLUSTER_ID_LEN

    def test_different_urls_differ(self):
        a = make_cluster_id("https://bbc.com/1")
        b = make_cluster_id("https://espn.com/1")
        assert a != b


# ---------------------------------------------------------------------------
# cluster_articles — algorithm-level tests
# ---------------------------------------------------------------------------

class TestClusterArticles:
    def test_empty_input(self):
        assert cluster_articles([]) == {}

    def test_single_article_solo_cluster(self):
        art = _art("France defeat Germany in final", url="https://bbc.com/fra-ger")
        result = cluster_articles([art])
        assert art.id in result
        assert result[art.id] == make_cluster_id(art.url)

    def test_near_duplicate_headlines_same_cluster(self):
        """Two headlines for the same match from different outlets → one cluster."""
        art1 = _art(
            "Argentina beat Brazil 2-1 in group opener",
            url="https://bbc.com/arg-bra",
            teams=["argentina", "brazil"],
        )
        art2 = _art(
            "Argentina beat Brazil 2-1 in opening match",
            url="https://espn.com/arg-bra",
            teams=["argentina", "brazil"],
            pub_offset_hours=1,
        )
        result = cluster_articles([art1, art2])
        assert result[art1.id] == result[art2.id]

    def test_unrelated_articles_separate_clusters(self):
        art1 = _art(
            "France defeat Germany in quarter-final thriller",
            url="https://bbc.com/fra-ger",
            teams=["france", "germany"],
        )
        art2 = _art(
            "Brazil penalty heartbreak against Spain",
            url="https://bbc.com/bra-esp",
            teams=["brazil", "spain"],
            pub_offset_hours=3,
        )
        result = cluster_articles([art1, art2])
        assert result[art1.id] != result[art2.id]

    def test_outside_time_window_not_clustered(self):
        """Same-story headlines published > window_hours apart → separate clusters."""
        art1 = _art(
            "Messi scores wonder goal to win match",
            url="https://bbc.com/messi-goal",
            teams=["argentina"],
        )
        art2 = _art(
            "Messi scores wonder goal to win match for Argentina",
            url="https://espn.com/messi-goal",
            teams=["argentina"],
            pub_offset_hours=49,   # outside the default 48 h window
        )
        result = cluster_articles([art1, art2], window_hours=48)
        assert result[art1.id] != result[art2.id]

    def test_inside_time_window_clustered(self):
        """Same-story headlines published < window_hours apart → same cluster."""
        art1 = _art(
            "Messi scores wonder goal to win match",
            url="https://bbc.com/messi-inside",
            teams=["argentina"],
        )
        art2 = _art(
            "Messi scores wonder goal to win for Argentina",
            url="https://espn.com/messi-inside",
            teams=["argentina"],
            pub_offset_hours=47,   # just inside 48 h window
        )
        result = cluster_articles([art1, art2], window_hours=48)
        assert result[art1.id] == result[art2.id]

    def test_transitive_clustering(self):
        """A~B, B~C → A,B,C all in the same cluster via union-find transitivity."""
        art_a = _art(
            "England beat United States in group stage",
            url="https://bbc.com/eng-usa",
            teams=["england", "united-states"],
        )
        art_b = _art(
            "England defeat USA in group stage clash",
            url="https://sky.com/eng-usa",
            teams=["england", "united-states"],
            pub_offset_hours=1,
        )
        art_c = _art(
            "USA fall to England in group phase result",
            url="https://espn.com/eng-usa",
            teams=["england", "united-states"],
            pub_offset_hours=2,
        )
        result = cluster_articles([art_a, art_b, art_c])
        assert result[art_a.id] == result[art_b.id] == result[art_c.id]

    def test_team_overlap_boost_clusters_borderline_pair(self):
        """Articles with low token Jaccard but shared teams should cluster."""
        # 'Portugal stunning comeback' vs 'Portugal comeback victory stadium'
        # token intersection ≈ {portugal, comeback} = 2; union ≈ 5 → J ≈ 0.4
        # Even without boost, this should cluster, but the boost ensures it.
        art1 = _art(
            "Portugal stunning comeback against Morocco",
            url="https://bbc.com/por-mar",
            teams=["portugal", "morocco"],
        )
        art2 = _art(
            "Portugal comeback victory over Morocco stadium",
            url="https://sky.com/por-mar",
            teams=["portugal", "morocco"],
            pub_offset_hours=2,
        )
        result = cluster_articles([art1, art2])
        assert result[art1.id] == result[art2.id]

    def test_stable_cluster_id_is_earliest_url_hash(self):
        """cluster_id equals make_cluster_id(earliest_url) regardless of input order."""
        early = _art(
            "Argentina win 3-0 over Brazil",
            url="https://bbc.com/arg-bra-early",
            teams=["argentina", "brazil"],
        )
        late = _art(
            "Argentina thrash Brazil three nil to advance",
            url="https://espn.com/arg-bra-late",
            teams=["argentina", "brazil"],
            pub_offset_hours=2,
        )
        expected_cid = make_cluster_id(early.url)   # early is published first

        # Pass in reversed order — algorithm should still pick the earliest URL.
        result = cluster_articles([late, early])
        assert result[early.id] == expected_cid
        assert result[late.id] == expected_cid

    def test_four_sources_same_match_one_cluster(self):
        """BBC, Sky, ESPN, Fox all cover the same fixture → exactly one cluster."""
        fixtures = [
            ("bbc-sport",  "France beat Germany 2-1 in quarter-final",         0.0),
            ("sky-sports", "France defeat Germany 2-1 to reach World Cup semis",0.5),
            ("espn",       "France edge Germany 2-1 in quarter-final thriller", 1.0),
            ("fox-sports", "France through to semis after 2-1 win over Germany",1.5),
        ]
        arts = [
            _art(
                headline,
                url=f"https://{source}.com/fra-ger",
                teams=["france", "germany"],
                pub_offset_hours=offset,
            )
            for source, headline, offset in fixtures
        ]
        result = cluster_articles(arts)
        cids = {result[a.id] for a in arts}
        assert len(cids) == 1, f"Expected 1 cluster, got {len(cids)}: {cids}"

    def test_two_separate_stories_same_day(self):
        """Two different matches on the same day stay in separate clusters."""
        match1_bbc  = _art("Spain beat Morocco in round of 16",
                           url="https://bbc.com/esp-mar",  teams=["spain",   "morocco"])
        match1_espn = _art("Spain edge Morocco to reach quarters",
                           url="https://espn.com/esp-mar", teams=["spain",   "morocco"],
                           pub_offset_hours=1)
        match2_bbc  = _art("Brazil overcome Colombia penalty thriller",
                           url="https://bbc.com/bra-col",  teams=["brazil",  "colombia"],
                           pub_offset_hours=5)
        match2_espn = _art("Brazil beat Colombia on penalties to advance",
                           url="https://espn.com/bra-col", teams=["brazil",  "colombia"],
                           pub_offset_hours=6)

        result = cluster_articles([match1_bbc, match1_espn, match2_bbc, match2_espn])
        assert result[match1_bbc.id] == result[match1_espn.id]
        assert result[match2_bbc.id] == result[match2_espn.id]
        assert result[match1_bbc.id] != result[match2_bbc.id]

    def test_all_articles_assigned_cluster_id(self):
        """Every article in the input must appear in the result dict."""
        arts = [_art(f"Article number {i}", pub_offset_hours=float(i)) for i in range(5)]
        result = cluster_articles(arts)
        for a in arts:
            assert a.id in result, f"Article {a.id!r} missing from cluster_map"
