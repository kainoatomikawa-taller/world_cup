// Rank the 12 third-place teams and pick the best 8 that advance.
//
// FIFA 2026 third-place comparison criteria (same priority as group standings):
//   1) points, 2) goal difference, 3) goals scored, 4) deterministic tiebreak
//   (team id alphabetical) standing in for fair-play / drawing of lots.
//
// The qualifying 8's group letters are what drives bracket seeding later —
// see data/assignmentTable.ts.
import type { GroupId, Standing } from './types';
import { GROUP_IDS } from './types';

export interface ThirdPlaceEntry {
  teamId: string;
  groupId: GroupId;
  played: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
}

/**
 * Extract the third-place team from each group's standings and return a
 * ThirdPlaceEntry for it. Groups whose order is not yet set (empty array)
 * produce an entry with zero stats — they will rank last by default.
 */
export function buildThirdPlaceEntries(
  groupOrder: Record<GroupId, string[]>,
  standingsByGroup: Record<GroupId, Standing[]>,
): ThirdPlaceEntry[] {
  const entries: ThirdPlaceEntry[] = [];
  for (const g of GROUP_IDS) {
    const order = groupOrder[g];
    if (!order || order.length < 3) continue;
    const thirdId = order[2];
    const standing = standingsByGroup[g]?.find((s) => s.teamId === thirdId);
    entries.push({
      teamId: thirdId,
      groupId: g,
      played: standing?.played ?? 0,
      points: standing?.points ?? 0,
      goalDifference: standing?.goalDifference ?? 0,
      goalsFor: standing?.goalsFor ?? 0,
    });
  }
  return entries;
}

/**
 * Sort ThirdPlaceEntry[] best-first by FIFA criteria.
 * Returns a new array; does not mutate the input.
 */
export function rankThirdPlaceEntries(entries: ThirdPlaceEntry[]): ThirdPlaceEntry[] {
  return [...entries].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    // Deterministic stand-in for fair-play / drawing of lots.
    return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
  });
}

/** The 8 advancing third-place team ids, in ranked order (best first). */
export function qualifyingThirdPlace(ranked: ThirdPlaceEntry[]): string[] {
  return ranked.slice(0, 8).map((e) => e.teamId);
}

/** The group ids of the 8 qualifying third-place teams (feeds bracket seeding). */
export function qualifyingThirdPlaceGroups(ranked: ThirdPlaceEntry[]): GroupId[] {
  return ranked.slice(0, 8).map((e) => e.groupId);
}
