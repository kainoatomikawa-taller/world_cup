// Map external data sources into our domain types.
// This is the only file that knows upstream shapes — everything else in the
// app depends only on our own Match/Team types.
import type { Match, GroupId, Stage } from '../domain/types';
import { TEAMS } from './schedule2026';
import type { StaticFixture } from './staticTypes';

// ---- Internal upstream types (football-data.org v4) ----
// Non-exported so no other file can take a dependency on the upstream schema.

interface FdTeam {
  id: number;
  name: string;
  shortName: string;
  tla: string;
}

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;  // 'SCHEDULED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | ...
  stage: string;   // 'GROUP_STAGE' | 'LAST_32' | 'LAST_16' | 'QUARTER_FINALS' | ...
  group: string | null; // 'GROUP_A' … 'GROUP_L' | null
  venue?: string | null;
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: {
    fullTime: { home: number | null; away: number | null };
  };
}

// ---- Team identity resolution ----
// Build lookup tables from our TEAMS list once at module load.

const byCode = new Map<string, string>(); // TLA.toUpperCase() → team id
const byName = new Map<string, string>(); // normalised name     → team id

for (const t of TEAMS) {
  byCode.set(t.code.toUpperCase(), t.id);
  byName.set(normalizeName(t.name), t.id);
}

// Add entries here when a real API response reveals a TLA mismatch between
// our `code` values and football-data.org's TLA field.
// e.g. 'SAU': 'saudi-arabia' if upstream uses SAU instead of our KSA.
const TLA_OVERRIDES: Record<string, string> = {};

function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function resolveTeamId(fd: FdTeam): string | undefined {
  const override = TLA_OVERRIDES[fd.tla.toUpperCase()];
  if (override) return override;

  const byTla = byCode.get(fd.tla.toUpperCase());
  if (byTla) return byTla;

  // Fall back to normalised name / shortName in case the TLA differs.
  return (
    byName.get(normalizeName(fd.name)) ??
    byName.get(normalizeName(fd.shortName ?? ''))
  );
}

// ---- Group id parsing ----

function parseGroupId(group: string | null): GroupId | undefined {
  if (!group) return undefined;
  const letter = group.replace(/^GROUP_/, '');
  if (/^[A-L]$/.test(letter)) return letter as GroupId;
  return undefined;
}

// ---- Public API ----

export function toMatches(raw: unknown): Match[] {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as { matches?: unknown }).matches)
  ) {
    console.warn('[adapter] unexpected payload shape', raw);
    return [];
  }

  const matches = (raw as { matches: FdMatch[] }).matches;
  const result: Match[] = [];

  for (const m of matches) {
    // Phase 1: group-stage results only. Knockout matches are user-pick-driven.
    if (m.stage !== 'GROUP_STAGE') continue;

    const homeId = resolveTeamId(m.homeTeam);
    const awayId = resolveTeamId(m.awayTeam);

    if (!homeId || !awayId) {
      console.warn(
        '[adapter] could not resolve team(s), skipping match',
        m.id,
        m.homeTeam?.tla,
        m.awayTeam?.tla,
      );
      continue;
    }

    const played = m.status === 'FINISHED';
    const { home, away } = m.score?.fullTime ?? { home: null, away: null };

    result.push({
      id: String(m.id),
      stage: 'group',
      groupId: parseGroupId(m.group),
      homeId,
      awayId,
      // Guard `!= null` (not just falsy) so a 0-0 scoreline isn't discarded.
      homeGoals: played && home != null ? home : undefined,
      awayGoals: played && away != null ? away : undefined,
      kickoff: m.utcDate,
      played,
      ...(m.venue ? { venue: m.venue } : {}),
    });
  }

  return result;
}

// ---- Static JSON path (public/data/fixtures.json) ----

export function staticFixtureToMatch(f: StaticFixture): Match {
  const played = f.played === 1;
  return {
    id: f.match_id,
    stage: f.stage as Stage,
    groupId: f.group_id ? (f.group_id as GroupId) : undefined,
    homeId: f.home_team_id,
    awayId: f.away_team_id,
    homeGoals: played && f.home_goals != null ? f.home_goals : undefined,
    awayGoals: played && f.away_goals != null ? f.away_goals : undefined,
    kickoff: f.kickoff,
    played,
    ...(f.venue ? { venue: f.venue } : {}),
  };
}
