// FIFA group-stage tiebreaker ordering.
//
// Official FIFA 2026 order (Article 32, Competition Regulations):
//   1) points in all group matches
//   2) head-to-head points (matches between the tied teams)
//   3) head-to-head goal difference
//   4) head-to-head goals scored
//   5) goal difference in all group matches
//   6) goals scored in all group matches
//   7) FIFA/Coca-Cola World Ranking (not modeled)
//   8) drawing of lots
//
// Fair-play points (cards) and the FIFA ranking are not modeled here, so after
// step 6 we fall back to a deterministic order by team id as a stand-in for the
// drawing of lots, keeping results stable.
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
 * Resolve a block of teams tied on overall points using FIFA 2026 criteria 2-6:
 *   H2H pts → H2H GD → H2H goals → overall GD → overall goals → team id.
 */
function breakTie(tied: Standing[], matches: Match[]): Standing[] {
  const h2h = headToHeadStats(tied.map((t) => t.teamId), matches);

  // Sort by H2H criteria first.
  const byH2h = [...tied].sort((a, b) => {
    const sa = h2h[a.teamId];
    const sb = h2h[b.teamId];
    if (sb.points !== sa.points) return sb.points - sa.points;
    if (sb.goalDifference !== sa.goalDifference) return sb.goalDifference - sa.goalDifference;
    if (sb.goalsFor !== sa.goalsFor) return sb.goalsFor - sa.goalsFor;
    return 0;
  });

  // Within sub-blocks still tied on H2H, fall back to overall GD → goals → id.
  const result: Standing[] = [];
  let i = 0;
  while (i < byH2h.length) {
    const refH2h = h2h[byH2h[i].teamId];
    let j = i + 1;
    while (
      j < byH2h.length &&
      h2h[byH2h[j].teamId].points === refH2h.points &&
      h2h[byH2h[j].teamId].goalDifference === refH2h.goalDifference &&
      h2h[byH2h[j].teamId].goalsFor === refH2h.goalsFor
    ) j++;

    const sub = byH2h.slice(i, j);
    if (sub.length === 1) {
      result.push(sub[0]);
    } else {
      result.push(
        ...[...sub].sort((a, b) => {
          if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
          if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
          return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
        }),
      );
    }
    i = j;
  }
  return result;
}

/**
 * Sort standings rows into final group order (index 0 = 1st place).
 * `matches` is needed for the head-to-head tiebreaker among tied teams.
 */
export function sortByTiebreakers(
  rows: Standing[],
  matches: Match[],
): Standing[] {
  // Primary sort: points only.
  const sorted = [...rows].sort((a, b) => b.points - a.points);

  // For each block tied on points, apply the full tiebreaker chain.
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
