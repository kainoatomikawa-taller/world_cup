import type { Match, Stage } from './types';

export interface MatchDay {
  date: string;     // YYYY-MM-DD (UTC)
  label: string;    // e.g. "11 June 2026"
  matches: Match[];
}

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

/**
 * Groups all matches into calendar-date buckets (UTC), sorted chronologically.
 * Every stage (group and knockout) is bucketed by date, not stage name.
 */
export function groupMatchDays(matches: Match[]): MatchDay[] {
  const sorted = [...matches].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const dayMap = new Map<string, MatchDay>();

  for (const match of sorted) {
    const date = match.kickoff.slice(0, 10);
    if (!dayMap.has(date)) {
      dayMap.set(date, { date, label: formatDateLabel(date), matches: [] });
    }
    dayMap.get(date)!.matches.push(match);
  }

  return Array.from(dayMap.values());
}

/**
 * Selects the default match day to display:
 *   1. Today's match day when fixtures exist on the current date.
 *   2. The next future match day with fixtures.
 *   3. The final's match day when no future fixtures remain.
 *
 * Accepts an optional `today` Date to keep the function pure and testable.
 */
export function selectDefaultMatchDay(
  matchDays: MatchDay[],
  today: Date = new Date(),
): MatchDay | undefined {
  if (matchDays.length === 0) return undefined;

  const todayStr = today.toISOString().slice(0, 10);

  const todayDay = matchDays.find((d) => d.date === todayStr);
  if (todayDay) return todayDay;

  const nextDay = matchDays.find((d) => d.date > todayStr);
  if (nextDay) return nextDay;

  // Fall back to the match day containing the final; last day if no final found.
  return (
    matchDays.findLast((d) => d.matches.some((m) => m.stage === 'final')) ??
    matchDays[matchDays.length - 1]
  );
}
