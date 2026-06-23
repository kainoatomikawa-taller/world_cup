// FIFA group-stage tiebreaker ordering.
//
// Official order (2026):
//   1) points, 2) goal difference, 3) goals scored  — all overall.
// If teams are still equal, the same three criteria are applied to the matches
// played BETWEEN the tied teams (head-to-head):
//   4) head-to-head points, 5) head-to-head GD, 6) head-to-head goals scored.
// Then fair-play points, then drawing of lots.
//
// Fair-play points are not modeled (we have no card data), so after head-to-head
// we fall back to a deterministic order by team id, standing in for the draw of
// lots so results are stable.
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
