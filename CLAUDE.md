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

## Conventions

- The `domain/` and `data/` modules are currently stubs that `throw 'not implemented'`. Implement them following the build order in `PROJECT_STRUCTURE.md` (standings/tiebreakers first, then elimination, then bracket).
- Intentionally-unused stub parameters are prefixed with `_` (ESLint is configured to ignore that pattern).
