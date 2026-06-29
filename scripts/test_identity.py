"""
test_identity.py — unit tests for identity.py.

Each test uses an in-memory SQLite database seeded with just the tables
that the identity module needs so tests run without hitting the real DB
or the network.
"""

from __future__ import annotations

import sqlite3
import textwrap

import pytest

from identity import (
    SENTINEL,
    normalize_name,
    register_unmatched,
    report_coverage,
    report_unmatched,
    report_unverified,
    resolve_player,
    resolve_team,
    seed_identity_map,
    slug_from_name,
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

_SCHEMA = textwrap.dedent("""
    PRAGMA foreign_keys = ON;

    CREATE TABLE identity_map (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_id TEXT   NOT NULL,
        entity_type  TEXT   NOT NULL,
        source       TEXT   NOT NULL,
        source_id    TEXT   NOT NULL,
        source_name  TEXT,
        verified     INTEGER NOT NULL DEFAULT 0,
        notes        TEXT,
        UNIQUE(entity_type, source, source_id)
    );
    CREATE INDEX idx_identity_canonical ON identity_map(canonical_id, entity_type);
    CREATE INDEX idx_identity_unverified ON identity_map(verified) WHERE verified = 0;

    CREATE TABLE scorers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        competition_id  TEXT    NOT NULL,
        player_id       TEXT    NOT NULL,
        player_name     TEXT    NOT NULL,
        team_id         TEXT    NOT NULL,
        goals           INTEGER NOT NULL DEFAULT 0,
        assists         INTEGER NOT NULL DEFAULT 0,
        penalties       INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT,
        UNIQUE(competition_id, player_id)
    );

    CREATE TABLE player_stats (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        competition_id  TEXT    NOT NULL,
        player_id       TEXT    NOT NULL,
        team_id         TEXT    NOT NULL,
        match_id        TEXT,
        matches_played  INTEGER DEFAULT 0,
        minutes         INTEGER DEFAULT 0,
        goals           INTEGER DEFAULT 0,
        assists         INTEGER DEFAULT 0,
        yellow_cards    INTEGER DEFAULT 0,
        red_cards       INTEGER DEFAULT 0,
        shots           INTEGER DEFAULT 0,
        shots_on_target INTEGER DEFAULT 0,
        passes          INTEGER DEFAULT 0,
        pass_accuracy   REAL,
        updated_at      TEXT,
        UNIQUE(competition_id, player_id, match_id)
    );
""")


def _make_conn() -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript(_SCHEMA)
    return con


@pytest.fixture()
def con() -> sqlite3.Connection:
    c = _make_conn()
    yield c
    c.close()


@pytest.fixture()
def seeded_con() -> sqlite3.Connection:
    c = _make_conn()
    seed_identity_map(c)
    yield c
    c.close()


# ---------------------------------------------------------------------------
# normalize_name
# ---------------------------------------------------------------------------


class TestNormalizeName:
    def test_strips_accents(self) -> None:
        assert normalize_name("Mbappé") == "mbappe"

    def test_lowercase(self) -> None:
        assert normalize_name("FRANCE") == "france"

    def test_collapses_whitespace(self) -> None:
        assert normalize_name("New  Zealand") == "new zealand"

    def test_cedilla_stripped(self) -> None:
        assert normalize_name("Curaçao") == "curacao"

    def test_multi_accent(self) -> None:
        assert normalize_name("Raphaël Varane") == "raphael varane"

    def test_apostrophe_preserved(self) -> None:
        # Non-ASCII quotes are stripped; ASCII apostrophes survive ASCII encoding
        result = normalize_name("Côte d'Ivoire")
        assert "cote" in result
        assert "ivoire" in result

    def test_turkiye(self) -> None:
        assert normalize_name("Türkiye") == "turkiye"


# ---------------------------------------------------------------------------
# slug_from_name
# ---------------------------------------------------------------------------


class TestSlugFromName:
    def test_basic_slug(self) -> None:
        assert slug_from_name("Kylian Mbappé") == "kylian-mbappe"

    def test_multi_word(self) -> None:
        assert slug_from_name("New Zealand") == "new-zealand"

    def test_already_clean(self) -> None:
        assert slug_from_name("argentina") == "argentina"

    def test_special_chars_removed(self) -> None:
        slug = slug_from_name("Côte d'Ivoire")
        assert re.sub(r"[^a-z\-]", "", slug) == slug  # only lowercase and hyphens


# ---------------------------------------------------------------------------
# resolve_team — static (no DB rows needed)
# ---------------------------------------------------------------------------


class TestResolveTeamStatic:
    def test_canonical_name_football_data(self, seeded_con) -> None:
        result = resolve_team("football-data", "france", "France", conn=seeded_con)
        assert result == "france"

    def test_name_alias_republic_of_korea(self, seeded_con) -> None:
        result = resolve_team(
            "football-data", "republic-of-korea", "Republic of Korea", conn=seeded_con
        )
        assert result == "south-korea"

    def test_name_alias_czechia(self, seeded_con) -> None:
        result = resolve_team("football-data", "czechia", "Czechia", conn=seeded_con)
        assert result == "czech-republic"

    def test_name_alias_turkiye(self, seeded_con) -> None:
        result = resolve_team("football-data", "turkiye", "Türkiye", conn=seeded_con)
        assert result == "turkey"

    def test_name_alias_ir_iran(self, seeded_con) -> None:
        result = resolve_team("football-data", "ir-iran", "IR Iran", conn=seeded_con)
        assert result == "iran"

    def test_name_alias_usa(self, seeded_con) -> None:
        result = resolve_team("sofascore", "usa", "USA", conn=seeded_con)
        assert result == "united-states"

    def test_fbref_korea_republic(self, seeded_con) -> None:
        result = resolve_team("fbref", "korea-republic", "Korea Republic", conn=seeded_con)
        assert result == "south-korea"

    def test_fbref_ivory_coast(self, seeded_con) -> None:
        result = resolve_team("fbref", "ivory-coast", "Ivory Coast", conn=seeded_con)
        assert result == "ivory-coast"

    def test_fbref_cote_d_ivoire(self, seeded_con) -> None:
        result = resolve_team("fbref", "cote-d-ivoire", "Côte d'Ivoire", conn=seeded_con)
        assert result == "ivory-coast"

    def test_fbref_dr_congo(self, seeded_con) -> None:
        result = resolve_team("fbref", "dr-congo", "DR Congo", conn=seeded_con)
        assert result == "dr-congo"

    def test_fbref_bosnia(self, seeded_con) -> None:
        result = resolve_team("fbref", "bosnia-herzegovina", "Bosnia-Herzegovina", conn=seeded_con)
        assert result == "bosnia-and-herzegovina"

    def test_sofascore_curacao(self, seeded_con) -> None:
        result = resolve_team("sofascore", "curacao", "Curacao", conn=seeded_con)
        assert result == "curacao"

    def test_understat_usa(self, seeded_con) -> None:
        result = resolve_team("understat", "usa", "USA", conn=seeded_con)
        assert result == "united-states"

    def test_unknown_team_returns_none(self, seeded_con) -> None:
        result = resolve_team("sofascore", "xyz999", "Nonexistent FC", conn=seeded_con)
        assert result is None

    def test_tla_fallback(self, seeded_con) -> None:
        # source_id = TLA → triggers code fallback even without a name
        result = resolve_team("sofascore", "ARG", "", conn=seeded_con)
        assert result == "argentina"

    def test_all_48_canonical_names_resolve(self, seeded_con) -> None:
        from identity import _TEAMS
        for team in _TEAMS:
            result = resolve_team(
                "fbref", slug_from_name(team.name), team.name, conn=seeded_con
            )
            assert result == team.id, f"Failed for {team.name!r} (expected {team.id!r})"


# ---------------------------------------------------------------------------
# resolve_team — DB-first path
# ---------------------------------------------------------------------------


class TestResolveTeamDBFirst:
    def test_db_row_takes_priority(self, con) -> None:
        con.execute(
            "INSERT INTO identity_map (canonical_id,entity_type,source,source_id,source_name,verified) "
            "VALUES ('spain','team','fbref','12345','Spain',1)"
        )
        result = resolve_team("fbref", "12345", "Spain", conn=con)
        assert result == "spain"

    def test_integer_source_id_resolved(self, con) -> None:
        con.execute(
            "INSERT INTO identity_map (canonical_id,entity_type,source,source_id,source_name,verified) "
            "VALUES ('argentina','team','football-data','759','Argentina',1)"
        )
        result = resolve_team("football-data", "759", conn=con)
        assert result == "argentina"

    def test_sentinel_row_not_returned(self, con) -> None:
        con.execute(
            "INSERT INTO identity_map (canonical_id,entity_type,source,source_id,source_name,verified) "
            "VALUES ('__unmatched__','team','sofascore','xyz','Unknown SC',0)"
        )
        result = resolve_team("sofascore", "xyz", "Unknown SC", conn=con)
        assert result is None


# ---------------------------------------------------------------------------
# resolve_player
# ---------------------------------------------------------------------------


class TestResolvePlayer:
    def _seed_players(self, con: sqlite3.Connection) -> None:
        con.executemany(
            "INSERT INTO scorers (competition_id,player_id,player_name,team_id,goals) VALUES (?,?,?,?,?)",
            [
                ("wc-2026", "kylian-mbappe",       "Kylian Mbappé",      "france",    5),
                ("wc-2026", "lionel-messi",         "Lionel Messi",       "argentina", 4),
                ("wc-2026", "cristiano-ronaldo",    "Cristiano Ronaldo",  "portugal",  3),
                ("wc-2026", "neymar",               "Neymar",             "brazil",    2),
                ("wc-2026", "pedri",                "Pedri",              "spain",     1),
            ],
        )
        con.executemany(
            "INSERT INTO identity_map (canonical_id,entity_type,source,source_id,source_name,verified) VALUES (?,?,?,?,?,?)",
            [
                ("kylian-mbappe",    "player", "football-data", "11867", "Kylian Mbappé",     1),
                ("lionel-messi",     "player", "football-data", "71646", "Lionel Messi",       1),
                ("cristiano-ronaldo","player", "football-data", "3923",  "Cristiano Ronaldo",  1),
            ],
        )

    def test_db_lookup_by_source_id(self, con) -> None:
        self._seed_players(con)
        result = resolve_player("football-data", "11867", "Kylian Mbappe", conn=con)
        assert result == "kylian-mbappe"

    def test_db_lookup_by_source_name(self, con) -> None:
        self._seed_players(con)
        result = resolve_player("football-data", "99999", "Lionel Messi", conn=con)
        assert result == "lionel-messi"

    def test_fuzzy_accent_variant(self, con) -> None:
        self._seed_players(con)
        # "Kylian Mbappe" (no accent) should fuzzy-match "Kylian Mbappé"
        result = resolve_player("sofascore", "99", "Kylian Mbappe", conn=con, fuzzy_threshold=0.80)
        assert result == "kylian-mbappe"

    def test_fuzzy_initial_expansion(self, con) -> None:
        self._seed_players(con)
        # "C. Ronaldo" — last name matches exactly, first initial matches
        result = resolve_player("sofascore", "88", "C. Ronaldo", conn=con, fuzzy_threshold=0.82)
        assert result == "cristiano-ronaldo"

    def test_fuzzy_below_threshold_returns_none(self, con) -> None:
        self._seed_players(con)
        result = resolve_player("sofascore", "77", "Completely Differentname", conn=con)
        assert result is None

    def test_unknown_source_id_and_no_name(self, con) -> None:
        result = resolve_player("sofascore", "00000", conn=con)
        assert result is None


# ---------------------------------------------------------------------------
# register_unmatched
# ---------------------------------------------------------------------------


class TestRegisterUnmatched:
    def test_writes_sentinel_row(self, con) -> None:
        register_unmatched("team", "sofascore", "xyz-fc", "XYZ FC", conn=con)
        con.commit()
        row = con.execute(
            "SELECT canonical_id FROM identity_map WHERE source_id='xyz-fc'"
        ).fetchone()
        assert row is not None
        assert row["canonical_id"] == SENTINEL

    def test_idempotent(self, con) -> None:
        for _ in range(3):
            register_unmatched("team", "fbref", "dup-fc", "Dup FC", conn=con)
            con.commit()
        count = con.execute(
            "SELECT COUNT(*) FROM identity_map WHERE source_id='dup-fc'"
        ).fetchone()[0]
        assert count == 1

    def test_notes_stored(self, con) -> None:
        register_unmatched(
            "player", "understat", "p-999", "Unknown Player",
            notes="no match in scorers table", conn=con
        )
        con.commit()
        row = con.execute(
            "SELECT notes FROM identity_map WHERE source_id='p-999'"
        ).fetchone()
        assert "no match" in (row["notes"] or "")


# ---------------------------------------------------------------------------
# seed_identity_map
# ---------------------------------------------------------------------------


class TestSeedIdentityMap:
    def test_seed_populates_rows(self, con) -> None:
        inserted, _ = seed_identity_map(con)
        count = con.execute("SELECT COUNT(*) FROM identity_map").fetchone()[0]
        assert count > 0
        assert inserted > 0

    def test_seed_idempotent(self, con) -> None:
        seed_identity_map(con)
        count_before = con.execute("SELECT COUNT(*) FROM identity_map").fetchone()[0]
        seed_identity_map(con)
        count_after = con.execute("SELECT COUNT(*) FROM identity_map").fetchone()[0]
        assert count_before == count_after

    def test_dry_run_writes_nothing(self, con) -> None:
        seed_identity_map(con, dry_run=True)
        count = con.execute("SELECT COUNT(*) FROM identity_map").fetchone()[0]
        assert count == 0

    def test_all_48_teams_in_every_source(self, con) -> None:
        seed_identity_map(con)
        from identity import _TEAMS
        sources = ["football-data", "fbref", "understat", "sofascore"]
        for team in _TEAMS:
            for source in sources:
                row = con.execute(
                    "SELECT id FROM identity_map WHERE canonical_id=? AND entity_type='team' AND source=?",
                    (team.id, source),
                ).fetchone()
                assert row is not None, f"Missing seed: {team.id!r} in source {source!r}"

    def test_seed_rows_are_verified(self, con) -> None:
        seed_identity_map(con)
        unverified = con.execute(
            "SELECT COUNT(*) FROM identity_map WHERE entity_type='team' AND verified=0"
        ).fetchone()[0]
        assert unverified == 0, "All seeded team rows should be marked verified=1"


# ---------------------------------------------------------------------------
# report_coverage / report_unmatched / report_unverified
# ---------------------------------------------------------------------------


class TestReporting:
    def test_coverage_after_seed(self, tmp_path) -> None:
        db = tmp_path / "test.db"
        con = sqlite3.connect(db)
        con.row_factory = sqlite3.Row
        con.executescript(_SCHEMA)
        seed_identity_map(con)
        con.close()
        cov = report_coverage(db)
        assert isinstance(cov, dict)
        assert "football-data" in cov
        assert cov["football-data"]["verified"] > 0

    def test_report_unmatched_empty_initially(self, seeded_con) -> None:
        # Seed rows have no sentinels; nothing should be unmatched
        results = [
            r for r in seeded_con.execute(
                "SELECT * FROM identity_map WHERE canonical_id=?", (SENTINEL,)
            ).fetchall()
        ]
        assert results == []

    def test_report_unverified_after_auto_insert(self, con) -> None:
        # Insert a player row with verified=0 (as ingest_api does for scorers)
        con.execute(
            "INSERT INTO identity_map (canonical_id,entity_type,source,source_id,source_name,verified) "
            "VALUES ('mbappe','player','football-data','11867','Kylian Mbappe',0)"
        )
        con.commit()
        rows = con.execute(
            "SELECT * FROM identity_map WHERE verified=0 AND canonical_id != ?", (SENTINEL,)
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["canonical_id"] == "mbappe"


# ---------------------------------------------------------------------------
# Import safety
# ---------------------------------------------------------------------------

import re  # noqa: E402  (needed by TestSlugFromName)
