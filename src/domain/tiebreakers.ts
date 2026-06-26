// FIFA 2026 group-stage tiebreaker sequence (FIFA World Cup 2026 Regulations, Art. 32):
//
//   1. Points in all group matches
//
//   Head-to-head criteria (applied among teams still tied on criterion 1):
//     2. Points in head-to-head matches
//     3. Goal difference in head-to-head matches
//     4. Goals scored in head-to-head matches
//
//   If still equal after head-to-head:
//     5. Goal difference in all group matches
//     6. Goals scored in all group matches
//     7. Fair-play points (yellow/red cards) — not modeled; no card data available.
//     8. FIFA/Coca-Cola World Ranking — not modeled.
//     9. Drawing of lots — represented here by lexicographic team id for determinism.
//
// breakTie        handles criteria 2–6 (H2H pts → GD → goals, then overall GD → goals).
// sortByTiebreakers groups rows by points (criterion 1), then resolves each tied
//   block via breakTie. For a circular H2H tie (all H2H metrics equal), breakTie
//   falls back to overall GD → goals → team-id as a stable proxy for the draw of lots.
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
 * Resolve a block of teams tied on overall points (FIFA 2026 criteria 2-6).
 * H2H criteria (pts → GD → GF) come first; overall GD/GF and team id are the fallback.
 */
function breakTie(tied: Standing[], matches: Match[]): Standing[] {
  const h2h = headToHeadStats(tied.map((t) => t.teamId), matches);

  // Sort by H2H criteria first.
  const byH2h = [...tied].sort((a, b) => {
    const sa = h2h[a.teamId];
    const sb = h2h[b.teamId];
    // H2H criteria first (2026 rule change)
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
  // Primary sort: points only — H2H (not overall GD) is the next criterion in 2026.
  const sorted = [...rows].sort((a, b) => b.points - a.points);

  // For each block tied on points, apply the full tiebreaker chain (H2H → overall GD/GF).
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
