// FIFA group-stage tiebreaker ordering.
//
// Official order (2026):
//   1) points
//   2) head-to-head points (among the tied teams)
//   3) head-to-head goal difference
//   4) head-to-head goals scored
//   5) goal difference in all group matches
//   6) goals scored in all group matches
// Then fair-play points, then drawing of lots.
//
// Fair-play points are not modeled (we have no card data), so after step 6
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

/**
 * Resolve a set of teams equal on points.
 * H2H criteria (pts → GD → GF) come first; overall GD/GF are the fallback.
 */
function breakTie(tied: Standing[], matches: Match[]): Standing[] {
  const h2h = headToHeadStats(
    tied.map((t) => t.teamId),
    matches,
  );
  return [...tied].sort((a, b) => {
    const sa = h2h[a.teamId];
    const sb = h2h[b.teamId];
    // H2H criteria first (2026 rule change)
    if (sb.points !== sa.points) return sb.points - sa.points;
    if (sb.goalDifference !== sa.goalDifference) return sb.goalDifference - sa.goalDifference;
    if (sb.goalsFor !== sa.goalsFor) return sb.goalsFor - sa.goalsFor;
    // Then overall GD / GF
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
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
  // Sort by points only — H2H (not overall GD) is the next criterion in 2026.
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  // Group teams equal on points, then break each block with H2H → overall GD/GF.
  const result: Standing[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].points === sorted[i].points) j++;
    const tiedBlock = sorted.slice(i, j);
    if (tiedBlock.length > 1) result.push(...breakTie(tiedBlock, matches));
    else result.push(tiedBlock[0]);
    i = j;
  }
  return result;
}
