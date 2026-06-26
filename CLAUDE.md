# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server.
- `npm run build` — type-check (`tsc -b`) and build for production.
- `npm test` — run the Vitest suite once.
- `npm run test:watch` — Vitest in watch mode. A single file: `npx vitest run src/domain/standings.test.ts`.
- `npm run lint` — ESLint.

## Architecture

This is a React + TypeScript + Vite app for exploring FIFA World Cup 2026 scenarios. See `README.md` for the product vision and `PROJECT_STRUCTURE.md` for the full architecture rationale.

The central design rule: **the rules engine is separate from the UI.**

- `src/domain/` — pure TypeScript, **no React and no network access**. Tiebreakers, group standings, mathematical-elimination logic, third-place ranking, bracket seeding, and knockout propagation live here. This is where the real complexity and the tests are. Keep it pure.
- `src/data/` — static tournament facts (`schedule2026.ts`, `assignmentTable.ts`) kept separate from live results (`api.ts` client + `adapter.ts` mapping). The `adapter` is the only place that knows the upstream API's shape.
- `src/store/tournamentStore.ts` — a single Zustand store is the source of truth shared by all three screens, so a locked group result constrains the third-place screen and the bracket automatically.
- `src/features/` — the three screens (`GroupStage`, `ThirdPlace`, `Bracket`) plus `shared/`. Drag-and-drop uses **dnd-kit**.
- `api/` — serverless proxy functions. The football API key lives **only** here (server-side), never in client code; the browser calls `/api/*`.

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

- The `domain/` and `data/` modules are currently stubs that `throw 'not implemented'`. Implement them following the build order in `PROJECT_STRUCTURE.md` (standings/tiebreakers first, then elimination, then bracket).
- Intentionally-unused stub parameters are prefixed with `_` (ESLint is configured to ignore that pattern).
