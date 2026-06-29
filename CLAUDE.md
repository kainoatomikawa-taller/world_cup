# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Frontend (Node)**
- `npm run dev` — start the Vite dev server.
- `npm run build` — type-check (`tsc -b`) and build for production.
- `npm test` — run the Vitest suite once.
- `npm run test:watch` — Vitest in watch mode. A single file: `npx vitest run src/domain/standings.test.ts`.
- `npm run lint` — ESLint.

**Data pipeline (Python — run from `scripts/`)**
- `python scripts/init_db.py` — create/re-apply schema to `db/world_cup.db` (idempotent).
- `python scripts/ingest_api.py` — pull football-data.org data into SQLite (needs `FOOTBALL_API_KEY` in `.env.local`).
- `python scripts/identity.py seed` — pre-populate `identity_map` with all known name aliases (football-data.org, FBref, Understat, Sofascore). Run after `init_db` and before enrichment scripts.
- `python scripts/identity.py report` — print identity coverage and surface entities needing manual review.
- `python scripts/query.py` — demo the read-only query functions (upcoming fixtures, group table, top scorers).
- `cd scripts && .venv/bin/python -m pytest` — run all Python tests (73 tests across `test_query.py` and `test_identity.py`).

## Architecture

This is a React + TypeScript + Vite app for exploring FIFA World Cup 2026 scenarios. See `README.md` for the product vision and `PROJECT_STRUCTURE.md` for the full architecture rationale.

The central design rule: **the rules engine is separate from the UI.**

**Frontend (TypeScript)**
- `src/domain/` — pure TypeScript, **no React and no network access**. Tiebreakers, group standings, mathematical-elimination logic, third-place ranking, bracket seeding, and knockout propagation live here. This is where the real complexity and the tests are. Keep it pure.
- `src/data/` — static tournament facts (`schedule2026.ts`, `assignmentTable.ts`) kept separate from live results (`api.ts` client + `adapter.ts` mapping). The `adapter` is the only place that knows the upstream API's shape.
- `src/store/tournamentStore.ts` — a single Zustand store is the source of truth shared by all three screens, so a locked group result constrains the third-place screen and the bracket automatically.
- `src/features/` — feature screens plus `shared/`. Drag-and-drop uses **dnd-kit**.
- `api/` — serverless proxy functions. The football API key lives **only** here (server-side), never in client code; the browser calls `/api/*`.

**Data pipeline (Python — `scripts/`)**
- `schema.sql` / `init_db.py` — SQLite schema at `db/world_cup.db`. Tables: `competitions`, `teams`, `matches`, `standings`, `scorers`, `player_stats`, `player_ratings`, `identity_map`. Schema is idempotent (safe to re-run).
- `ingest_api.py` — fetches football-data.org data (competition, teams, matches, standings, scorers) and upserts into SQLite. Rate-limited to the free tier (10 req/min). Requires `FOOTBALL_API_KEY` in `.env.local`.
- `identity.py` — cross-source identity reconciliation. Resolves team and player names from football-data.org, FBref, Understat, and Sofascore to canonical slugs used across the whole pipeline. **All future enrichment scripts must use `resolve_team()` / `resolve_player()` from this module** rather than writing their own name matching. Unresolved entities are written to `identity_map` as sentinel rows (`canonical_id='__unmatched__'`) so they surface in `identity.py report`.
- `query.py` — read-only pandas query functions over the SQLite store: `upcoming_fixtures()`, `competition_table()`, `top_scorers()`, `identity_coverage()`, `enriched_player_stats()`, `unmatched_entities()`.

The Python `team.id` slugs and the TypeScript `team.id` slugs are **identical by design** — both layers reference the same 48 canonical slugs so data can flow between them without translation.

### Navigation hierarchy

The app has two levels of navigation:

1. **`AppNav`** (`src/features/shared/AppNav.tsx`) — top-level platform tabs (`AppTab` type). Currently:
   - `possibilities` — the full scenario tool (group stage → third-place → bracket)
   - `fixtures` / `insights` / `lineups` / `ratings` — placeholder tabs for future sections
2. **`StageNav`** (`src/features/shared/StageNav.tsx`) — inner segmented control rendered *only* within the Possibilities tab (`StageKey`: `fixtures | groups | thirdPlace | bracket`).

The two levels are visually distinct: `AppNav` uses an underline-style indicator; `StageNav` uses a pill/segmented-control shape.

New placeholder tabs use the shared `PlaceholderTab` component (`src/features/shared/PlaceholderTab.tsx`).

## Key domain facts

- 2026 format: 48 teams → 12 groups of 4 → top 2 (24) + best 8 of 12 third-place teams = 32 in the Round of 32.
- The Round-of-32 slot for each third-place team is set by FIFA's fixed assignment table, keyed by *which* groups the 8 qualifiers came from (`data/assignmentTable.ts`).

## FIFA 2026 Group-Stage Tiebreaker Order (Art. 32)

Implemented in `src/domain/tiebreakers.ts`. The sequence below is applied strictly in order — move to the next criterion only when all preceding ones leave teams still equal.

1. **Points** in all group matches (primary sort; groups rows into tied blocks).

   Head-to-head criteria (applied only among the teams in the tied block):

2. **H2H points** — points earned in matches played only among the tied teams.
3. **H2H goal difference** — goal difference in those same head-to-head matches.
4. **H2H goals scored** — goals scored in those same head-to-head matches.

   If still equal after the head-to-head pass:

5. **Overall goal difference** in all group matches.
6. **Overall goals scored** in all group matches.
7. **Fair-play points** (yellow/red cards) — not modeled; no card data available.
8. **FIFA/Coca-Cola World Ranking** — not modeled.
9. **Drawing of lots** — represented deterministically by lexicographic team ID.

### How the algorithm handles sub-blocks

`breakTie` first sorts the tied block by H2H criteria (steps 2–4). Within any sub-group that remains equal on all H2H metrics (e.g. a perfect circular tie where every team wins once 1-0), it falls back to overall GD → overall GF → team ID (steps 5–6 + lots proxy). This means steps 2–4 are not re-applied recursively inside a sub-group — once H2H criteria are exhausted the algorithm advances directly to step 5.

## Conventions

- Intentionally-unused stub parameters are prefixed with `_` (ESLint is configured to ignore that pattern).
- The TypeScript `domain/` and `data/` modules are fully implemented — do not treat them as stubs.
- Python enrichment scripts must import from `identity.py` for all name resolution rather than writing ad-hoc matching. Call `register_unmatched()` for any entity that fails resolution so it appears in the review report.
- The Python venv lives at `scripts/.venv`. Run Python commands with `scripts/.venv/bin/python` or activate with `source scripts/.venv/bin/activate`.
