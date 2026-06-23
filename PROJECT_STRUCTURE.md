# Project Structure

Architecture and folder plan for **World Cup Possibilities**. See [README.md](./README.md) for the product vision.

## Stack

| Concern            | Choice                          | Why |
|--------------------|---------------------------------|-----|
| Framework          | React + TypeScript + Vite       | The whole UX is drag-and-drop and a live bracket — React's strength. |
| Drag and drop      | dnd-kit                         | Modern, accessible; handles sortable lists (group order, third-place ranking) and free-form drag. |
| State              | Zustand                         | One interconnected tournament state tree shared across screens; lightweight, no prop-drilling. |
| Rules engine       | Pure TypeScript modules         | Framework-agnostic, unit-testable in isolation — where the real logic and bugs live. |
| Testing            | Vitest                          | Fast, Vite-native; focused on the rules engine. |
| Live data          | Free football API (e.g. football-data.org / API-Football) | Structured data instead of scraping. |
| Backend            | Serverless proxy (Vercel/Netlify functions) | Hides the API key server-side and avoids CORS. |

## Guiding principle: separate the rules engine from the UI

The hardest parts of this project are not visual:

1. **Tiebreaker logic** — who actually finishes where in a group.
2. **Mathematical elimination** — which placements are still possible given remaining fixtures.
3. **Third-place → Round-of-32 assignment table** — FIFA's fixed mapping from the combination of qualifying third-place groups to bracket slots.

These live in `src/domain/` as pure functions with no React and no network access. The UI renders state and asks the engine "is this drop legal?".

## Directory layout

```
worldcup-possibilities/
├── api/                          # Serverless functions (Vercel-style) — the proxy
│   ├── matches.ts                #   GET live fixtures+results, hides API key
│   └── standings.ts              #   GET group standings (or computed client-side)
│
├── src/
│   ├── domain/                   # Pure logic, no React, no fetch — fully unit-tested
│   │   ├── types.ts              #   Team, Group, Match, Standing, BracketSlot, TournamentState
│   │   ├── tiebreakers.ts        #   FIFA group tiebreaker ordering
│   │   ├── standings.ts          #   match results → group table
│   │   ├── elimination.ts        #   "can team X still finish 1st/2nd/3rd?" math engine
│   │   ├── thirdPlace.ts         #   rank 12 third-place teams → best 8
│   │   ├── bracketSeeding.ts     #   FIFA 3rd-place→R32 assignment table + build bracket
│   │   ├── knockout.ts           #   propagate winners R32→R16→QF→SF→Final
│   │   └── *.test.ts             #   Vitest — most of the project's tests live here
│   │
│   ├── data/
│   │   ├── schedule2026.ts       #   static: 48 teams, 12 groups, full fixture list
│   │   ├── assignmentTable.ts    #   static: 3rd-place group-combo → R32 slot mapping
│   │   ├── api.ts                #   client calls to /api/* proxy
│   │   └── adapter.ts            #   external API shape → domain types
│   │
│   ├── store/
│   │   └── tournamentStore.ts    #   Zustand: live data + user picks, validated actions
│   │
│   ├── features/
│   │   ├── GroupStage/           #   drag-drop standings; locks when matches complete
│   │   ├── ThirdPlace/           #   drag-drop ranking; eliminated teams pinned/disabled
│   │   ├── Bracket/              #   seeded bracket + pick-a-winner
│   │   └── shared/               #   TeamCard, DragHandle, StageNav
│   │
│   ├── App.tsx                   #   stage router: Groups → Third place → Bracket
│   └── main.tsx
│
├── .env.local                    # API key (never committed) — read only by api/*
├── vite.config.ts
├── vitest.config.ts
├── package.json
└── README.md
```

## Why this shape

- **`domain/` knows nothing about React or the network.** Drop a match in, get standings/legality out. This makes the tricky rules testable and is where to write tests first.
- **`api/` is the only thing that touches the API key.** The browser calls `/api/matches`; the function adds the key server-side and returns clean JSON. Hides the secret, sidesteps CORS.
- **`store/` is the single source of truth** the three feature screens share, so a locked group result automatically constrains the third-place screen and the bracket.
- **`data/` separates static tournament facts** (fixture list, assignment table — these don't change) **from live results** (which do).

## Data flow

```
/api/matches  →  data/adapter  →  store (live results)
                                      │
              domain/standings ───────┤→ current group tables
              domain/elimination ─────┤→ which placements are locked / impossible
                                      ▼
   GroupStage ──user drags──▶ store validates ──▶ ThirdPlace ──▶ bracketSeeding ──▶ Bracket
```

## Suggested build order

1. `domain/types.ts` + `data/schedule2026.ts` — model the tournament with hard-coded data.
2. `domain/standings.ts` + `tiebreakers.ts` + tests — get group tables correct.
3. `GroupStage` feature with dnd-kit — first interactive screen, no live data yet.
4. `domain/elimination.ts` + tests — the constraint engine.
5. `thirdPlace.ts` + `ThirdPlace` screen.
6. `assignmentTable.ts` + `bracketSeeding.ts` + `knockout.ts` + `Bracket` screen.
7. `api/` proxy + `data/api.ts` — swap hard-coded data for live results last.

Building the rules engine against static data first means there is a fully working app before the live-data integration ever touches it.

## 2026 format reference

- 48 teams → 12 groups of 4.
- Top 2 of each group advance (24) + the best 8 of 12 third-place teams = **32 teams in the Round of 32**.
- The Round-of-32 slot each third-place team occupies is determined by the **combination of groups** the 8 qualifiers come from — see `assignmentTable.ts`.
