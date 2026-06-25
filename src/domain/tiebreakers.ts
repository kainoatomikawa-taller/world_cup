// FIFA 2026 group-stage tiebreaker sequence (FIFA World Cup 2026 Regulations, Art. 12):
//
//   Overall criteria (all group matches):
//     1. Points
//     2. Goal difference
//     3. Goals scored
//
//   Head-to-head criteria (matches among the tied teams only, applied when two or
//   more teams remain equal after criteria 1–3):
//     4. Points in head-to-head matches
//     5. Goal difference in head-to-head matches
//     6. Goals scored in head-to-head matches
//
//   7. Fair-play points (yellow/red cards) — not modeled; no card data available.
//   8. Drawing of lots — represented here by lexicographic team id for determinism.
//
// compareOverall  handles criteria 1–3.
// breakTie        handles criteria 4–6 (then falls to 8).
// sortByTiebreakers groups equal rows by criteria 1–3, then resolves each tied
//   block via breakTie. For a circular H2H tie (all head-to-head metrics equal),
//   the sort falls through to team-id order as a stable proxy for the draw of lots.
import type { Match, Standing } from './types';

interface MiniStat {
  points: number;
  goalDifference: number;
  goalsFor: number;
}

/** Build a head-to-head mini-table from only the matches among `teamIds`. */
function headToHeadStats(
  teamIds: string[],
  matches: Match[],
): Record<string, MiniStat> {
  const inGroup = new Set(teamIds);
  const stats: Record<string, MiniStat> = {};
  for (const id of teamIds) {
    stats[id] = { points: 0, goalDifference: 0, goalsFor: 0 };
  }
  for (const m of matches) {
    if (!m.played || m.homeGoals == null || m.awayGoals == null) continue;
    if (!inGroup.has(m.homeId) || !inGroup.has(m.awayId)) continue;
    const home = stats[m.homeId];
    const away = stats[m.awayId];
    home.goalsFor += m.homeGoals;
    away.goalsFor += m.awayGoals;
    home.goalDifference += m.homeGoals - m.awayGoals;
    away.goalDifference += m.awayGoals - m.homeGoals;
    if (m.homeGoals > m.awayGoals) home.points += 3;
    else if (m.homeGoals < m.awayGoals) away.points += 3;
    else {
      home.points += 1;
      away.points += 1;
    }
  }
  return stats;
}

/** Compare two rows on overall points → GD → goals (returns <0 if a ranks higher). */
function compareOverall(a: Standing, b: Standing): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDifference !== a.goalDifference) {
    return b.goalDifference - a.goalDifference;
  }
  return b.goalsFor - a.goalsFor;
}

/** Resolve a set of teams that are equal on overall criteria via head-to-head. */
function breakTie(tied: Standing[], matches: Match[]): Standing[] {
  const h2h = headToHeadStats(
    tied.map((t) => t.teamId),
    matches,
  );
  return [...tied].sort((a, b) => {
    const sa = h2h[a.teamId];
    const sb = h2h[b.teamId];
    if (sb.points !== sa.points) return sb.points - sa.points;
    if (sb.goalDifference !== sa.goalDifference) {
      return sb.goalDifference - sa.goalDifference;
    }
    if (sb.goalsFor !== sa.goalsFor) return sb.goalsFor - sa.goalsFor;
    // Fair play not modeled; deterministic stand-in for drawing of lots.
    return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
  });
}

/**
 * Sort standings rows into final group order (index 0 = 1st place).
 * `matches` is needed for the head-to-head tiebreaker among tied teams.
 */
export function sortByTiebreakers(
  rows: Standing[],
  matches: Match[],
): Standing[] {
  const sorted = [...rows].sort(compareOverall);
  // Group teams that are equal on overall criteria, then break each block with
  // head-to-head results.
  const result: Standing[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && compareOverall(sorted[i], sorted[j]) === 0) {
      j++;
    }
    const tiedBlock = sorted.slice(i, j);
    if (tiedBlock.length > 1) result.push(...breakTie(tiedBlock, matches));
    else result.push(tiedBlock[0]);
    i = j;
  }
  return result;
}
