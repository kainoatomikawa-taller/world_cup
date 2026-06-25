// The constraint engine: which group placements are still mathematically
// reachable for each team, given current results and remaining fixtures.
//
// A group has 4 teams and 6 matches, so at most 6 remain. We brute-force every
// combination of remaining results (3^n outcomes, n ≤ 6 → ≤ 729) and, for each,
// compute the range of positions each team could finish in.
//
// Overall points determine separation between teams. Within a tied block we
// apply the first real tiebreaker: head-to-head points among the tied teams
// (FIFA 2026 criterion 4). H2H results from already-played matches are fixed;
// remaining H2H matches take the outcome of the current scenario. If H2H points
// are still equal, GD and goals-scored are controllable via scorelines, so we
// treat that remaining uncertainty as open — a slight over-approximation that
// errs toward ALLOWING rather than wrongly forbidding a legal placement.
import type { GroupId, Match, PlacementPossibility, Standing, Team } from './types';

/**
 * For each team in a group, determine whether it can still finish 1st / 2nd / 3rd.
 * The UI uses this to disable illegal drag-and-drop placements.
 */
export function computePlacementPossibilities(
  groupId: GroupId,
  teams: Team[],
  matches: Match[],
  standings: Standing[],
): PlacementPossibility[] {
  const groupTeamIds = teams
    .filter((t) => t.groupId === groupId)
    .map((t) => t.id);

  const basePoints: Record<string, number> = {};
  for (const id of groupTeamIds) basePoints[id] = 0;
  for (const s of standings) {
    if (s.teamId in basePoints) basePoints[s.teamId] = s.points;
  }

  const groupMatches = matches.filter(
    (m) =>
      m.groupId === groupId &&
      m.homeId in basePoints &&
      m.awayId in basePoints,
  );
  const remaining = groupMatches.filter((m) => !m.played);
  // A group is only "complete" if it has matches AND they are all played. With
  // no matches scheduled yet, every position is still reachable (not complete).
  const complete = groupMatches.length > 0 && remaining.length === 0;

  const reachable: Record<string, Set<number>> = {};
  for (const id of groupTeamIds) reachable[id] = new Set<number>();

  if (complete) {
    // Positions are fixed by the current standings.
    for (const s of standings) {
      if (s.teamId in reachable) reachable[s.teamId].add(s.position);
    }
  } else {
    // Pre-compute H2H points from already-played matches.
    // playedH2h[a][b] = points a earned in its match against b (-1 = not yet played).
    const playedH2h: Record<string, Record<string, number>> = {};
    for (const id of groupTeamIds) {
      playedH2h[id] = {};
      for (const other of groupTeamIds) {
        if (other !== id) playedH2h[id][other] = -1;
      }
    }
    for (const m of groupMatches) {
      if (!m.played || m.homeGoals == null || m.awayGoals == null) continue;
      const h = m.homeId, a = m.awayId;
      if (m.homeGoals > m.awayGoals) {
        playedH2h[h][a] = 3; playedH2h[a][h] = 0;
      } else if (m.homeGoals < m.awayGoals) {
        playedH2h[h][a] = 0; playedH2h[a][h] = 3;
      } else {
        playedH2h[h][a] = 1; playedH2h[a][h] = 1;
      }
    }

    const n = remaining.length;
    const combos = 3 ** n;
    for (let scenario = 0; scenario < combos; scenario++) {
      const points = { ...basePoints };

      // Build scenario-level H2H table: played results + this scenario's outcomes.
      const h2h: Record<string, Record<string, number>> = {};
      for (const id of groupTeamIds) h2h[id] = { ...playedH2h[id] };

      let code = scenario;
      for (let k = 0; k < n; k++) {
        const outcome = code % 3;
        code = Math.floor(code / 3);
        const m = remaining[k];
        if (outcome === 0) {
          points[m.homeId] += 3; // home win
          h2h[m.homeId][m.awayId] = 3; h2h[m.awayId][m.homeId] = 0;
        } else if (outcome === 1) {
          points[m.homeId] += 1; points[m.awayId] += 1; // draw
          h2h[m.homeId][m.awayId] = 1; h2h[m.awayId][m.homeId] = 1;
        } else {
          points[m.awayId] += 3; // away win
          h2h[m.homeId][m.awayId] = 0; h2h[m.awayId][m.homeId] = 3;
        }
      }

      for (const id of groupTeamIds) {
        const p = points[id];
        const tiedWith: string[] = [];
        let above = 0;
        for (const other of groupTeamIds) {
          if (other === id) continue;
          if (points[other] > p) above++;
          else if (points[other] === p) tiedWith.push(other);
        }

        if (tiedWith.length === 0) {
          reachable[id].add(above + 1);
        } else {
          // Apply H2H points tiebreaker (FIFA 2026 criterion 4) within tied block.
          // h2hTotal(t) = sum of points t earned against every other team in the block.
          const tiedBlock = [id, ...tiedWith];
          const h2hTotal = (tid: string) =>
            tiedBlock.reduce((sum, other) => {
              if (other === tid) return sum;
              const v = h2h[tid][other];
              return sum + (v >= 0 ? v : 0); // unscheduled pairs contribute 0
            }, 0);

          const myH2h = h2hTotal(id);
          let h2hAbove = 0; // tied teams with strictly more H2H pts → always above id
          let h2hEqual = 0; // tied teams with equal H2H pts → GD/goals still open
          for (const other of tiedWith) {
            const otherH2h = h2hTotal(other);
            if (otherH2h > myH2h) h2hAbove++;
            else if (otherH2h === myH2h) h2hEqual++;
            // fewer H2H pts → always below id, don't count
          }

          // Best: id tops the H2H-equal sub-block. Worst: id falls to its bottom.
          const best = above + h2hAbove + 1;
          const worst = above + h2hAbove + h2hEqual + 1;
          for (let rank = best; rank <= worst; rank++) {
            reachable[id].add(rank);
          }
        }
      }
    }
  }

  return groupTeamIds.map((id) => ({
    teamId: id,
    canFinish1st: reachable[id].has(1),
    canFinish2nd: reachable[id].has(2),
    canFinish3rd: reachable[id].has(3),
    canFinish4th: reachable[id].has(4),
    locked: complete,
  }));
}

/** True once every group match has been played and standings are fixed. */
export function isGroupComplete(groupId: GroupId, matches: Match[]): boolean {
  const groupMatches = matches.filter((m) => m.groupId === groupId);
  return groupMatches.length > 0 && groupMatches.every((m) => m.played);
}
