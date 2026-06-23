// The constraint engine: which group placements are still mathematically
// reachable for each team, given current results and remaining fixtures.
//
// A group has 4 teams and 6 matches, so at most 6 remain. We brute-force every
// combination of remaining results (3^n outcomes, n ≤ 6 → ≤ 729) and, for each,
// compute the range of positions each team could finish in.
//
// Reachability is computed at the POINTS level. Within a scenario, teams level
// on points are treated optimistically/pessimistically for the team in question
// (it could finish anywhere in the tied block), since goal-difference and
// goals-scored tiebreakers are controllable by choosing remaining scorelines.
// This can very slightly over-approximate in rare fixed-goal cases, which errs
// toward ALLOWING a borderline placement rather than wrongly forbidding a legal
// one — the safer behavior for the UI.
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
    const n = remaining.length;
    const combos = 3 ** n;
    for (let scenario = 0; scenario < combos; scenario++) {
      const points = { ...basePoints };
      let code = scenario;
      for (let k = 0; k < n; k++) {
        const outcome = code % 3;
        code = Math.floor(code / 3);
        const m = remaining[k];
        if (outcome === 0) {
          points[m.homeId] += 3; // home win
        } else if (outcome === 1) {
          points[m.homeId] += 1; // draw
          points[m.awayId] += 1;
        } else {
          points[m.awayId] += 3; // away win
        }
      }

      for (const id of groupTeamIds) {
        const p = points[id];
        let above = 0;
        let equal = 0;
        for (const other of groupTeamIds) {
          if (other === id) continue;
          if (points[other] > p) above++;
          else if (points[other] === p) equal++;
        }
        // Best case: wins every tie (rank = above + 1).
        // Worst case: loses every tie (rank = above + 1 + equal).
        const best = above + 1;
        const worst = above + 1 + equal;
        for (let rank = best; rank <= worst; rank++) {
          reachable[id].add(rank);
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
