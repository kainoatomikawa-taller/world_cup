// Rank the 12 third-place teams and pick the best 8 that advance.
//
// FIFA 2026 third-place comparison criteria (same priority as group standings):
//   1) points, 2) goal difference, 3) goals scored, 4) deterministic tiebreak
//   (team id alphabetical) standing in for fair-play / drawing of lots.
//
// The qualifying 8's group letters are what drives bracket seeding later —
// see data/assignmentTable.ts.
import type { GroupId, Match, Standing } from './types';
import { GROUP_IDS } from './types';

export interface ThirdPlaceEntry {
  teamId: string;
  groupId: GroupId;
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

// ---------------------------------------------------------------------------
// Joint-feasibility engine
// ---------------------------------------------------------------------------
//
// A proposed third-place ranking is "jointly feasible" if there exists some
// combination of remaining match outcomes (across all 12 groups) that produces
// stats for each team consistent with that ordering.
//
// Because each third-place team comes from a different, independent group,
// joint feasibility reduces to independent pairwise checks: for every adjacent
// pair (rank i, rank i+1) we ask whether higher's achievable stats can be ≥
// lower's achievable stats in at least one scenario. Groups being independent
// means those scenarios can be chosen simultaneously without conflict.
//
// GD/GF are treated as freely tunable via scoreline choices whenever a team
// still has remaining matches (same optimistic/pessimistic treatment used in
// elimination.ts), so the primary constraint is points.

/**
 * The range of total points the third-place team can still reach.
 * For a complete group (no remaining matches) min === max === current points.
 * For an incomplete group: min = current points, max = current + 3 × remaining.
 */
export function achievablePointRange(
  entry: ThirdPlaceEntry,
  matches: Match[],
): { min: number; max: number } {
  const remaining = matches.filter(
    (m) =>
      m.groupId === entry.groupId &&
      !m.played &&
      (m.homeId === entry.teamId || m.awayId === entry.teamId),
  );
  return {
    min: entry.points,
    max: entry.points + 3 * remaining.length,
  };
}

/**
 * True if there is a feasible scenario where `higher` finishes with
 * better-or-equal FIFA third-place stats than `lower`.
 *
 * Checks points first; when either team still has remaining matches their
 * GD/GF is freely tunable via scoreline, so the only hard infeasibility is
 * a points ceiling below the opponent's points floor. When both groups are
 * complete the full points → GD → GF → teamId criteria are compared exactly.
 */
export function canRankAbove(
  higher: ThirdPlaceEntry,
  lower: ThirdPlaceEntry,
  matches: Match[],
): boolean {
  const hi = achievablePointRange(higher, matches);
  const lo = achievablePointRange(lower, matches);

  // Primary: higher can never reach lower's worst-case points.
  if (hi.max < lo.min) return false;

  // Higher can beat lower on points in at least one scenario.
  if (hi.max > lo.min) return true;

  // hi.max === lo.min: the only boundary where they could meet on points.
  // If either team has remaining matches GD/GF is freely tunable → feasible.
  const higherFixed = hi.min === hi.max;
  const lowerFixed = lo.min === lo.max;
  if (!higherFixed || !lowerFixed) return true;

  // Both groups complete — compare by full FIFA criteria.
  if (higher.goalDifference !== lower.goalDifference)
    return higher.goalDifference > lower.goalDifference;
  if (higher.goalsFor !== lower.goalsFor)
    return higher.goalsFor > lower.goalsFor;
  // Deterministic tiebreak: alphabetically earlier teamId ranks higher.
  return higher.teamId < lower.teamId;
}

/**
 * Returns the index of the first entry whose position makes the ranking
 * jointly infeasible (i.e. the first rank i where ranked[i] cannot be above
 * ranked[i+1]), or null if every adjacent pair is feasible.
 */
export function firstIllegalThirdPlaceRank(
  ranked: ThirdPlaceEntry[],
  matches: Match[],
): number | null {
  for (let i = 0; i < ranked.length - 1; i++) {
    if (!canRankAbove(ranked[i], ranked[i + 1], matches)) return i;
  }
  return null;
}

/** True when the proposed ranking is jointly feasible across all remaining outcomes. */
export function isLegalThirdPlaceRanking(
  ranked: ThirdPlaceEntry[],
  matches: Match[],
): boolean {
  return firstIllegalThirdPlaceRank(ranked, matches) === null;
}
