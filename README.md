# World Cup Possibilities

An interactive website for exploring different outcomes and scenarios of the FIFA World Cup. Users build their own version of the tournament — deciding group stage finishes, ranking third-place teams, and picking knockout winners — while the app keeps every choice consistent with what is still mathematically possible given the real results so far.

## What it does

The experience flows in the same order the tournament does:

### 1. Group stage
- The 48 teams are split across 12 groups of 4.
- The user **drags and drops teams within a group** to set the final standings (1st through 4th).
- The top 2 teams in every group advance automatically (24 teams).

### 2. Third-place ranking
- 8 of the 12 third-place teams advance to the knockout stage.
- The user **drags and drops the 12 third-place teams** to rank them, deciding which 8 move on.

### 3. Knockout bracket
- The app **seeds the bracket the correct way** the tournament actually does it: the eight qualifying third-place teams are slotted into specific Round-of-32 matchups according to FIFA's predetermined assignment table, which depends on *which* groups the qualifying third-place teams came from.
- The user then **picks the winner of each match**, round by round, until the full bracket is filled out and a champion is crowned.

### 4. Respect real-world results
The app pulls in **current, real tournament results** and constrains the user's choices accordingly:
- A team that is **mathematically eliminated** from reaching the knockout stage cannot be placed in an advancing position.
- A team that **cannot finish third** (or cannot place high enough to be one of the 8 qualifying third-place teams) cannot be ranked there.
- Once a group's matches are **all played**, its standings lock and the user simply moves on — group order is fixed.
- Knockout matchups that have **already been played** are locked into the bracket with their real results.

Ideally this real-time data is sourced via web search / live data feeds rather than manual entry.

## Core concepts to get right

- **2026 format:** 48 teams → 12 groups of 4 → top 2 (24) + best 8 of 12 third-place teams = 32 teams in the Round of 32.
- **Third-place assignment table:** The Round-of-32 slot each third-place team occupies is *not* arbitrary — it is determined by the combination of groups the 8 qualifiers come from. This mapping must be implemented exactly.
- **Mathematical elimination:** Before allowing a placement, the app must compute whether a team can still reach that position given remaining fixtures and current points/tiebreakers.
- **Tiebreakers:** Group and third-place rankings use FIFA's official tiebreaker rules (points, goal difference, goals scored, head-to-head, fair play, etc.).

## Status

**Functionally complete for hypothetical exploration; live data not yet wired.**

Stack: React + TypeScript + Vite · dnd-kit (drag-and-drop) · Zustand (state, with
localStorage persistence) · Vitest (54 passing tests). See `CLAUDE.md` and
`PROJECT_STRUCTURE.md` for architecture.

### Done
- [x] Frontend stack + drag-and-drop library chosen (React/Vite/dnd-kit/Zustand).
- [x] FIFA tiebreaker logic (`src/domain/tiebreakers.ts`).
- [x] Group standings (`src/domain/standings.ts`).
- [x] Mathematical-elimination engine for group + third-place positions (`src/domain/elimination.ts`, `groupOrder.ts`, `thirdPlace.ts`).
- [x] Third-place → Round-of-32 assignment table, computed as a bipartite matching (`src/data/assignmentTable.ts`).
- [x] Bracket template, seeding, and knockout propagation (`src/data/bracketTemplate.ts`, `src/domain/bracketSeeding.ts`, `src/domain/knockout.ts`).
- [x] All three screens: Group stage, Third place, Knockout bracket (`src/features/`).
- [x] Pick winner / advance interaction with auto re-seeding + champion banner.
- [x] localStorage persistence of all user picks; team flags.
- [x] Full visual design system (`src/index.css` tokens + `src/App.css` components).

### Remaining
- [ ] **Live results integration** — the big one. `FIXTURES` in `src/data/schedule2026.ts` is empty and `api/` + `src/data/adapter.ts` are stubs. Needs a serverless proxy holding the football-API key (never client-side) and `adapter.ts` mapping the upstream shape to `Match[]`. All constraint logic already works the moment real `Match[]` data flows in — it's just inert today.
- [ ] **Partial per-group third-place locking** — `allGroupsComplete` is all-or-nothing today; lock each group's 3rd-place rank position as soon as that group finishes.

### How to resume
- `npm run dev` (server), `npm test` (54 tests), `npm run build`, `npm run lint`.
- Logic lives in `src/domain/` (pure, tested). Data/results in `src/data/`. UI in `src/features/`. Shared state in `src/store/tournamentStore.ts`.
- Next session almost certainly starts with the live-data integration above.