import type { Match, Stage } from './types';

export interface FixtureGroup {
  /** Formatted date (group stage) or round name (knockout). */
  label: string;
  matches: Match[];
}

const STAGE_ORDER: Record<Stage, number> = {
  group: 0,
  round32: 1,
  round16: 2,
  quarter: 3,
  semi: 4,
  thirdPlacePlayoff: 5,
  final: 6,
};

const KNOCKOUT_LABEL: Partial<Record<Stage, string>> = {
  round32: 'Round of 32',
  round16: 'Round of 16',
  quarter: 'Quarter-finals',
  semi: 'Semi-finals',
  thirdPlacePlayoff: 'Third-Place Play-off',
  final: 'Final',
};

function formatDateLabel(utcDateStr: string): string {
  const [year, month, day] = utcDateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Groups and sorts fixtures for the Fixtures tab.
 * Group-stage matches bucket by UTC calendar date; knockout matches
 * bucket by stage, in tournament order.
 */
export function groupFixtures(matches: Match[]): FixtureGroup[] {
  const sorted = [...matches].sort((a, b) => {
    const stageDiff = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (stageDiff !== 0) return stageDiff;
    return a.kickoff.localeCompare(b.kickoff);
  });

  const groupMap = new Map<string, FixtureGroup>();

  for (const match of sorted) {
    let key: string;
    let label: string;

    if (match.stage === 'group') {
      const dateStr = match.kickoff.slice(0, 10);
      key = `date:${dateStr}`;
      label = formatDateLabel(dateStr);
    } else {
      key = `stage:${match.stage}`;
      label = KNOCKOUT_LABEL[match.stage] ?? match.stage;
    }

    if (!groupMap.has(key)) {
      groupMap.set(key, { label, matches: [] });
    }
    groupMap.get(key)!.matches.push(match);
  }

  return Array.from(groupMap.values());
}
