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
// A proposed third-place ranking is "jointly feasible" if there exists a
// SINGLE combination of remaining-match outcomes (across all 12 groups) where
// every adjacent pair (rank i, rank i+1) is simultaneously consistent.
//
// The pairwise `firstIllegalThirdPlaceRank` below misses correlated cases such
// as: Senegal (0 pts, 1 remaining) ranked below Scotland (2 pts, fixed) but
// still in the top 8.  The pairwise check says this is fine because Scotland
// can be above Senegal (draw → 1 pt < 2) AND Senegal can be above the 9th
// team (win → 3 pts > 2), but those two scenarios are incompatible — there is
// no single outcome where Senegal is in the top 8 AND below Scotland.
//
// `firstJointlyIllegalThirdPlaceRank` fixes this by enumerating all 3^n
// outcome combinations (n = # of third-place teams with a remaining match,
// max 12 → 531,441 iterations) and checking every adjacent pair under the
// same scenario.
//
// Because each third-place team is from a different group, the remaining
// matches are fully independent — no correlated constraints across groups.
//
// GD direction constraint: a win can push GD arbitrarily high (any margin),
// a draw leaves GD fixed (net 0), a loss reduces GD by at least 1.  GF is
// freely tunable for any remaining-match outcome (choose the scoreline).
// So for a tied-points pair the only hard constraint beyond points is whether
// the higher team's achievable GD can exceed the lower team's minimum GD.

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

// ---------------------------------------------------------------------------
// Joint scenario enumeration
// ---------------------------------------------------------------------------

type MatchOutcome = 'win' | 'draw' | 'loss' | 'none';

/**
 * Can `higher` achieve a better GD (and if tied, GF) than `lower` when both
 * have the same points in a specific scenario?
 *
 * Outcome-aware ranges:
 *   win  → GD can be as high as desired (win by any margin)
 *   draw → GD is unchanged (net 0 per draw); GF is tunable (0-0, 1-1, …)
 *   loss → GD decreases by at least 1 (minimum 0-1 loss)
 *   none → GD and GF are fixed at current values
 */
function canRankAboveByGDGF(
  higher: ThirdPlaceEntry, outHi: MatchOutcome,
  lower: ThirdPlaceEntry, outLo: MatchOutcome,
): boolean {
  const hiMaxGD =
    outHi === 'win'  ? Infinity
    : outHi === 'loss' ? higher.goalDifference - 1
    : higher.goalDifference; // draw or none

  const loMinGD =
    outLo === 'win'  ? lower.goalDifference + 1
    : outLo === 'loss' ? -Infinity
    : lower.goalDifference; // draw or none

  if (hiMaxGD > loMinGD) return true;
  if (hiMaxGD < loMinGD) return false;

  // GD tied exactly at the boundary — fall to GF tiebreaker.
  // GF is tunable whenever a team has a remaining match (choose any scoreline).
  if (outHi !== 'none' || outLo !== 'none') return true;

  // Both have no remaining match: compare fixed GF, then group letter.
  if (higher.goalsFor !== lower.goalsFor) return higher.goalsFor > lower.goalsFor;
  return higher.groupId < lower.groupId;
}

/**
 * Joint scenario enumeration: returns the index of the first entry whose
 * position makes the ranking jointly infeasible, or null if there exists at
 * least one combination of remaining-match outcomes where the full ordering
 * is achievable.
 *
 * Replaces the pairwise `firstIllegalThirdPlaceRank` used in the UI so that
 * correlated constraints (e.g. "Senegal in the top 8" and "Senegal below
 * Scotland" require incompatible outcomes) are correctly rejected.
 */
export function firstJointlyIllegalThirdPlaceRank(
  ranked: ThirdPlaceEntry[],
  matches: Match[],
): number | null {
  // Find the single relevant remaining match (if any) for each team.
  const remMatch: Record<string, Match | undefined> = {};
  for (const entry of ranked) {
    remMatch[entry.teamId] = matches.find(
      (m) =>
        m.groupId === entry.groupId &&
        !m.played &&
        (m.homeId === entry.teamId || m.awayId === entry.teamId),
    );
  }

  const withRemaining = ranked.filter((e) => remMatch[e.teamId]);
  const n = withRemaining.length;
  const combos = 3 ** n;

  // Decode scenario s into per-team outcome: digit 0=win, 1=draw, 2=loss.
  function decodeOutcomes(s: number): Record<string, MatchOutcome> {
    const out: Record<string, MatchOutcome> = {};
    let code = s;
    for (const entry of withRemaining) {
      const digit = code % 3;
      code = Math.floor(code / 3);
      out[entry.teamId] = digit === 0 ? 'win' : digit === 1 ? 'draw' : 'loss';
    }
    return out;
  }

  function finalPts(entry: ThirdPlaceEntry, out: MatchOutcome): number {
    return entry.points + (out === 'win' ? 3 : out === 'draw' ? 1 : 0);
  }

  // Fast path: is the full ordering achievable in any single scenario?
  for (let s = 0; s < combos; s++) {
    const outcomes = decodeOutcomes(s);
    let ok = true;
    for (let i = 0; i < ranked.length - 1; i++) {
      const hi = ranked[i], lo = ranked[i + 1];
      const hiPts = finalPts(hi, outcomes[hi.teamId] ?? 'none');
      const loPts = finalPts(lo, outcomes[lo.teamId] ?? 'none');
      if (hiPts > loPts) continue;
      if (hiPts < loPts) { ok = false; break; }
      // Tied on points: check GD/GF direction.
      if (!canRankAboveByGDGF(hi, outcomes[hi.teamId] ?? 'none', lo, outcomes[lo.teamId] ?? 'none')) {
        ok = false; break;
      }
    }
    if (ok) return null;
  }

  // No scenario works. First find any pair that is individually infeasible
  // (no scenario exists where just that adjacent pair is valid).
  for (let i = 0; i < ranked.length - 1; i++) {
    let pairOk = false;
    for (let s = 0; s < combos && !pairOk; s++) {
      const outcomes = decodeOutcomes(s);
      const hi = ranked[i], lo = ranked[i + 1];
      const hiPts = finalPts(hi, outcomes[hi.teamId] ?? 'none');
      const loPts = finalPts(lo, outcomes[lo.teamId] ?? 'none');
      if (hiPts > loPts) { pairOk = true; break; }
      if (hiPts === loPts &&
          canRankAboveByGDGF(hi, outcomes[hi.teamId] ?? 'none', lo, outcomes[lo.teamId] ?? 'none')) {
        pairOk = true;
      }
    }
    if (!pairOk) return i;
  }

  // All adjacent pairs are individually feasible but no single scenario
  // satisfies all of them simultaneously (correlated impossibility).
  // Return the first pair where the lower team's maximum reachable points
  // exceed the higher team's current points — this is the tension that makes
  // the joint constraint impossible.
  for (let i = 0; i < ranked.length - 1; i++) {
    const hi = ranked[i], lo = ranked[i + 1];
    const loMax = lo.points + (remMatch[lo.teamId] ? 3 : 0);
    if (loMax > hi.points) return i;
  }
  return 0;
}

/** True when the proposed ranking is jointly feasible under full scenario enumeration. */
export function isJointlyFeasibleThirdPlaceRanking(
  ranked: ThirdPlaceEntry[],
  matches: Match[],
): boolean {
  return firstJointlyIllegalThirdPlaceRank(ranked, matches) === null;
}
