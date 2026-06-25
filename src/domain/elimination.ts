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

// ---------------------------------------------------------------------------
// Joint-ordering feasibility
// ---------------------------------------------------------------------------
//
// The per-team canFinish* flags in PlacementPossibility are computed from the
// union of all scenarios and therefore checked independently. Two teams could
// each individually reach a position yet have those positions be mutually
// exclusive in every single scenario.
//
// firstJointlyIllegalGroupPlacement does the stronger check: it asks whether
// any one scenario produces a points ordering consistent with the full proposed
// standing (non-increasing from rank 1 to rank 4, with equal-points ties
// resolvable by freely-chosen GD/GF scorelines). It returns the first adjacent
// pair that blocks the ordering, enabling an informative error message.

export interface JointIllegalGroupPlacement {
  /** Index in orderedIds of the team that cannot sit above its neighbour. */
  index: number;
  /** Team id at `index` — the one ranked too high. */
  teamId: string;
  /** Team id at `index + 1` — the one that cannot be ranked below. */
  blockedById: string;
}

/**
 * Check whether the proposed group ordering is jointly achievable — i.e. there
 * exists at least one combination of remaining match outcomes that produces a
 * points ranking consistent with `orderedIds` (with ties broken freely by GD).
 *
 * Returns the first pair whose ordering is impossible, or null if the full
 * ordering is feasible.
 */
export function firstJointlyIllegalGroupPlacement(
  orderedIds: string[],
  groupId: GroupId,
  teams: Team[],
  matches: Match[],
  standings: Standing[],
): JointIllegalGroupPlacement | null {
  if (orderedIds.length < 2) return null;

  const groupTeamIds = teams
    .filter((t) => t.groupId === groupId)
    .map((t) => t.id);
  const inGroup = new Set(groupTeamIds);

  const basePoints: Record<string, number> = {};
  for (const id of groupTeamIds) basePoints[id] = 0;
  for (const s of standings) {
    if (s.teamId in basePoints) basePoints[s.teamId] = s.points;
  }

  const groupMatches = matches.filter(
    (m) => m.groupId === groupId && inGroup.has(m.homeId) && inGroup.has(m.awayId),
  );
  const remaining = groupMatches.filter((m) => !m.played);
  const complete = groupMatches.length > 0 && remaining.length === 0;

  // For a completed group the standings positions are fully determined.
  if (complete) {
    const posById = Object.fromEntries(standings.map((s) => [s.teamId, s.position]));
    for (let i = 0; i < orderedIds.length - 1; i++) {
      const hi = posById[orderedIds[i]];
      const lo = posById[orderedIds[i + 1]];
      if (hi !== undefined && lo !== undefined && hi > lo) {
        return { index: i, teamId: orderedIds[i], blockedById: orderedIds[i + 1] };
      }
    }
    return null;
  }

  // Helper: apply one scenario code to basePoints and return a fresh points map.
  function applyScenario(code: number): Record<string, number> {
    const pts = { ...basePoints };
    let c = code;
    for (let k = 0; k < remaining.length; k++) {
      const outcome = c % 3;
      c = Math.floor(c / 3);
      const m = remaining[k];
      if (outcome === 0) pts[m.homeId] += 3;
      else if (outcome === 1) { pts[m.homeId] += 1; pts[m.awayId] += 1; }
      else pts[m.awayId] += 3;
    }
    return pts;
  }

  const combos = 3 ** remaining.length;

  // Fast path: find any scenario that is consistent with the full ordering.
  for (let s = 0; s < combos; s++) {
    const pts = applyScenario(s);
    let ok = true;
    for (let i = 0; i < orderedIds.length - 1; i++) {
      if ((pts[orderedIds[i]] ?? 0) < (pts[orderedIds[i + 1]] ?? 0)) { ok = false; break; }
    }
    if (ok) return null;
  }

  // No scenario works. Find the first adjacent pair that is individually
  // infeasible (no scenario exists where orderedIds[i] points ≥ orderedIds[i+1]).
  for (let i = 0; i < orderedIds.length - 1; i++) {
    let pairOk = false;
    for (let s = 0; s < combos; s++) {
      const pts = applyScenario(s);
      if ((pts[orderedIds[i]] ?? 0) >= (pts[orderedIds[i + 1]] ?? 0)) { pairOk = true; break; }
    }
    if (!pairOk) return { index: i, teamId: orderedIds[i], blockedById: orderedIds[i + 1] };
  }

  // Every adjacent pair is individually achievable but the joint combination is
  // not (correlated across matches). Report the first pair as a best-effort hint.
  return { index: 0, teamId: orderedIds[0], blockedById: orderedIds[1] };
}
