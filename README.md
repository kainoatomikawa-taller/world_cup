# World Cup 2026

An interactive platform for following and exploring the FIFA World Cup 2026. The app is structured as a multi-tab shell; the **Possibilities** and **Insights** tabs are fully built, and Fixtures and Stats tabs are placeholders for future sections.

## Possibilities tab

The Possibilities tool lets users build their own road through the tournament — setting group stage finishes, ranking third-place teams, and picking knockout winners — while keeping every choice consistent with what is still mathematically possible given real results so far.

The experience flows in the same order the tournament does:

### 1. Fixtures
A read-only schedule view of all group-stage and knockout matches, with kickoff times and results once played.

### 2. Group stage
- The 48 teams are split across 12 groups of 4.
- The user **drags and drops teams within a group** to set the final standings (1st through 4th).
- The top 2 teams in every group advance automatically (24 teams).

### 3. Third-place ranking
- 8 of the 12 third-place teams advance to the knockout stage.
- The user **drags and drops the 12 third-place teams** to rank them, deciding which 8 move on.

### 4. Knockout bracket
- The app **seeds the bracket** the way the tournament actually does it: the eight qualifying third-place teams are slotted into specific Round-of-32 matchups according to FIFA's predetermined assignment table, which depends on *which* groups the qualifying third-place teams came from.
- The user then **picks the winner of each match**, round by round, until the full bracket is filled out and a champion is crowned.

### 5. Respect real-world results
The app pulls in **current, real tournament results** and constrains the user's choices accordingly:
- A team that is **mathematically eliminated** from reaching the knockout stage cannot be placed in an advancing position.
- A team that **cannot finish third** (or cannot place high enough to be one of the 8 qualifying third-place teams) cannot be ranked there.
- Once a group's matches are **all played**, its standings lock and the user simply moves on — group order is fixed.
- Knockout matchups that have **already been played** are locked into the bracket with their real results.

## Core concepts to get right

- **2026 format:** 48 teams → 12 groups of 4 → top 2 (24) + best 8 of 12 third-place teams = 32 teams in the Round of 32.
- **Third-place assignment table:** The Round-of-32 slot each third-place team occupies is *not* arbitrary — it is determined by the combination of groups the 8 qualifiers come from. This mapping must be implemented exactly.
- **Mathematical elimination:** Before allowing a placement, the app must compute whether a team can still reach that position given remaining fixtures and current points/tiebreakers.
- **Tiebreakers:** Group and third-place rankings use FIFA's official tiebreaker rules (points, goal difference, goals scored, head-to-head, fair play, etc.).

## Insights tab

A live dashboard that surfaces the tournament at a glance:

- **Latest News** — prioritised, deduplicated feed from BBC Sport, Sky Sports, ESPN, Fox Sports, and GNews. Stories are clustered across sources and ranked by a four-signal score (cross-outlet coverage, recency, source tier, fixture proximity).
- **Upcoming Fixtures** — next matches grouped by date with kickoff times.
- **Group Standings** — all 12 groups with P/W/D/L/GD/Pts; top-2 rows highlighted.
- **Top Scorers** — goals, assists, and penalties from the live data pipeline.

The Insights tab reads static JSON from `public/data/` (written by `export_json.py`). Run the news pipeline to refresh it:

```bash
bash scripts/run_news.sh
```

## Status

**Possibilities and Insights tabs fully built. Python data pipeline built and wired to the frontend via static JSON export.**

Stack: React + TypeScript + Vite · dnd-kit (drag-and-drop) · Zustand (state, with localStorage persistence) · Vitest (173 passing tests) · Python 3.11 + SQLite (data pipeline). See `CLAUDE.md` and `PROJECT_STRUCTURE.md` for architecture.

### Done
- [x] Frontend stack + drag-and-drop library chosen (React/Vite/dnd-kit/Zustand).
- [x] FIFA tiebreaker logic (`src/domain/tiebreakers.ts`).
- [x] Group standings (`src/domain/standings.ts`).
- [x] Mathematical-elimination engine for group + third-place positions (`src/domain/elimination.ts`, `groupOrder.ts`, `thirdPlace.ts`).
- [x] Third-place → Round-of-32 assignment table, computed as a bipartite matching (`src/data/assignmentTable.ts`).
- [x] Bracket template, seeding, and knockout propagation (`src/data/bracketTemplate.ts`, `src/domain/bracketSeeding.ts`, `src/domain/knockout.ts`).
- [x] All three scenario screens: Group stage, Third place, Knockout bracket (`src/features/`).
- [x] Pick winner / advance interaction with auto re-seeding + champion banner.
- [x] localStorage persistence of all user picks; team flags.
- [x] Full visual design system (`src/index.css` tokens + `src/App.css` components).
- [x] Multi-tab app shell — `AppNav` with Possibilities, Insights, Fixtures, Stats tabs; Insights live, others placeholder.
- [x] SQLite schema (`scripts/schema.sql`) — tables: competitions, teams, matches, standings, scorers, player_stats, player_ratings, identity_map, news.
- [x] football-data.org ingest pipeline (`scripts/ingest_api.py`) — fetches and upserts competition, teams, matches, standings, and top scorers.
- [x] Read-only query layer (`scripts/query.py`) — pandas DataFrames for fixtures, standings, scorers, identity coverage, enriched player stats, and recent news.
- [x] Cross-source identity mapping (`scripts/identity.py`) — reconciles team and player names across football-data.org, FBref, Understat, and Sofascore; 287 seed aliases, fuzzy player matching, unmatched surfacing for manual review.
- [x] News ingest pipeline (`scripts/ingest_news.py`) — RSS feeds (BBC, Sky, ESPN, Fox) + GNews API; SHA-256 dedup, HTML stripping, link-out only.
- [x] Story clustering (`scripts/cluster_news.py`) — time-windowed Jaccard similarity on headline tokens; stable `cluster_id` across re-runs.
- [x] Priority scoring (`scripts/rank_news.py`) — four-signal score (source coverage 40%, recency decay 25%, source weight 15%, fixture relevance 20%); integer 0–1000.
- [x] Static JSON export (`scripts/export_json.py`) — atomic write to `public/data/*.json`; `manifest.json` with content hash. Frontend reads from here.
- [x] News pipeline wrapper (`scripts/run_news.sh`) — PID-lock, logging, runs all four news stages in sequence.
- [x] Insights dashboard (`src/features/Insights/InsightsDashboard.tsx`) — Latest News, Upcoming Fixtures, Group Standings, Top Scorers panels wired to static JSON hooks.

### Remaining
- [ ] **Possibilities live-data wiring** — `FIXTURES` in `src/data/schedule2026.ts` is empty and `api/matches.ts` + `src/data/adapter.ts` are stubs. The Python pipeline already has the data in SQLite; this step is connecting the serverless proxy to that store and mapping the response to `Match[]`. All constraint logic already works the moment real `Match[]` data flows in.
- [ ] **Partial per-group third-place locking** — `allGroupsComplete` is all-or-nothing today; lock each group's 3rd-place rank position as soon as that group finishes.
- [ ] **Fixtures tab** — full schedule and results view (top-level tab, distinct from the Fixtures sub-view inside Possibilities).
- [ ] **Stats tab** — future platform section; identity mapping foundation exists.

### How to resume
- `npm run dev` (server), `npm test` (173 tests), `npm run build`, `npm run lint`.
- Logic lives in `src/domain/` (pure, tested). Data/results in `src/data/`. UI in `src/features/`. Shared state in `src/store/tournamentStore.ts`.
- Navigation: top-level `AppNav` (platform tabs) → inner `StageNav` (within Possibilities only).
- Football pipeline: `python scripts/init_db.py` → `python scripts/ingest_api.py` → `python scripts/identity.py seed` → `python scripts/export_json.py`.
- News pipeline: `bash scripts/run_news.sh` (runs ingest → cluster → rank → export in one shot). See `CLAUDE.md` for individual commands and `scripts/SCHEDULING.md` for cron/launchd setup.

## Data pipeline setup

### 1. Create the Python venv and install dependencies

```bash
python -m venv scripts/.venv
source scripts/.venv/bin/activate        # Windows: scripts\.venv\Scripts\activate
pip install -r scripts/requirements.txt
# Packages: python-dotenv  requests  pandas  soccerdata  feedparser
```

### 2. Add your API keys

Create `.env.local` in the repository root (already gitignored):

```
FOOTBALL_API_KEY=<your-football-data.org-key>
GNEWS_API_KEY=<your-gnews.io-key>        # optional — enables Phase 3 GNews ingest
```

Free keys:
- football-data.org: <https://www.football-data.org/client/register>
- GNews: <https://gnews.io> (100 req/day on the free tier; cached for 6 h)

### 3. Bootstrap — create the database and verify the key

```bash
python scripts/setup.py
```

This creates `db/world_cup.db` with the full schema (competitions, teams, matches,
standings, scorers, player_stats, player_ratings, identity_map) and confirms the
API key is accepted with a single competitions endpoint call.

### 4. Run the ingest pipeline

```bash
python scripts/ingest_api.py          # fetch competition, teams, matches, standings, scorers
python scripts/identity.py seed       # populate cross-source identity aliases
python scripts/export_json.py         # write public/data/*.json for the frontend
```

Refresh the news feed (run daily or on demand):

```bash
bash scripts/run_news.sh              # ingest_news → cluster → rank → export
```

Enrichment (FBref xG / Sofascore ratings — requires headless Chrome):

```bash
python scripts/ingest_stats.py
```

See `scripts/SCHEDULING.md` for cron and macOS launchd setup to automate ingestion.
