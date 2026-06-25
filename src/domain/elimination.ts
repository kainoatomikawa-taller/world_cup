// The constraint engine: which group placements are still mathematically
// reachable for each team, given current results and remaining fixtures.
//
// A group has 4 teams and 6 matches, so at most 6 remain. We brute-force every
// combination of remaining results (3^n outcomes, n ≤ 6 → ≤ 729) and, for each,
// compute the range of positions each team could finish in.
//
// Per the 2026 FIFA rules the tiebreaker order is:
//   points → H2H pts → H2H GD → H2H GF → overall GD → overall GF → …
//
// H2H pts are determined by match OUTCOMES (win/draw/loss), which we enumerate.
// H2H GD/GF and overall GD/GF depend on the exact scoreline and are freely
// tunable — so any order within an equal-H2H-pts tied block is achievable.
// This means we only need to check H2H pts (not GD/GF) to determine whether a
// tie can be resolved in a given direction.
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

      // Compute H2H pts within each points-tied block for this scenario.
      // H2H pts are outcome-determined (not scoreline-dependent) so they act as
      // a hard constraint before the freely-tunable GD/GF tiebreakers.
      const h2hPts = scenarioH2HPts(groupTeamIds, groupMatches, remaining, scenario);

      for (const id of groupTeamIds) {
        const p = points[id];
        let above = 0;  // teams that definitely rank above id
        let equal = 0;  // teams that could go either way (equal H2H pts)
        for (const other of groupTeamIds) {
          if (other === id) continue;
          if (points[other] > p) {
            above++;
          } else if (points[other] === p) {
            // Within a tied-points block, H2H pts determine rank.
            if (h2hPts[other] > h2hPts[id]) above++;       // other definitely above
            else if (h2hPts[other] === h2hPts[id]) equal++; // GD/GF tunable → uncertain
            // else id ranks above other — don't count
          }
        }
        // Best case: id wins all GD/GF ties (rank = above + 1).
        // Worst case: id loses all GD/GF ties (rank = above + 1 + equal).
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

/**
 * Compute H2H points for each team in `teamIds` using all group matches, with
 * the remaining matches resolved according to `scenarioCode`.
 *
 * H2H pts are only counted for matches where BOTH teams are in `teamIds`
 * (i.e. within the same points-tied block).  This gives us the H2H ranking
 * criterion (step 2 in the 2026 FIFA order) without needing exact scorelines.
 */
function scenarioH2HPts(
  teamIds: string[],
  allGroupMatches: Match[],
  remaining: Match[],
  scenarioCode: number,
): Record<string, number> {
  const inBlock = new Set(teamIds);
  const h2h: Record<string, number> = {};
  for (const id of teamIds) h2h[id] = 0;

  for (const m of allGroupMatches) {
    if (!inBlock.has(m.homeId) || !inBlock.has(m.awayId)) continue;
    if (m.played) {
      if (m.homeGoals == null || m.awayGoals == null) continue;
      if (m.homeGoals > m.awayGoals) h2h[m.homeId] += 3;
      else if (m.homeGoals < m.awayGoals) h2h[m.awayId] += 3;
      else { h2h[m.homeId] += 1; h2h[m.awayId] += 1; }
    }
  }

  let c = scenarioCode;
  for (let k = 0; k < remaining.length; k++) {
    const outcome = c % 3;
    c = Math.floor(c / 3);
    const m = remaining[k];
    if (!inBlock.has(m.homeId) || !inBlock.has(m.awayId)) continue;
    if (outcome === 0) h2h[m.homeId] += 3;
    else if (outcome === 1) { h2h[m.homeId] += 1; h2h[m.awayId] += 1; }
    else h2h[m.awayId] += 3;
  }

  return h2h;
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

  // Returns true if orderedIds[i] can rank above orderedIds[i+1] in scenario s,
  // accounting for H2H pts within their shared tied-points block.
  function pairFeasibleInScenario(pts: Record<string, number>, s: number, i: number): boolean {
    const hiPts = pts[orderedIds[i]] ?? 0;
    const loPts = pts[orderedIds[i + 1]] ?? 0;
    if (hiPts > loPts) return true;
    if (hiPts < loPts) return false;
    // Tied on points: find the full block and check H2H pts.
    let blockStart = i;
    while (blockStart > 0 && (pts[orderedIds[blockStart - 1]] ?? 0) === hiPts) blockStart--;
    let blockEnd = i + 2;
    while (blockEnd < orderedIds.length && (pts[orderedIds[blockEnd]] ?? 0) === hiPts) blockEnd++;
    const blockIds = orderedIds.slice(blockStart, blockEnd);
    const h2h = scenarioH2HPts(blockIds, groupMatches, remaining, s);
    const hiH2H = h2h[orderedIds[i]] ?? 0;
    const loH2H = h2h[orderedIds[i + 1]] ?? 0;
    // Equal H2H pts → GD/GF freely tunable → either order achievable.
    return hiH2H >= loH2H;
  }

  // Fast path: find any scenario consistent with the full ordering.
  for (let s = 0; s < combos; s++) {
    const pts = applyScenario(s);
    let ok = true;
    for (let i = 0; i < orderedIds.length - 1; i++) {
      if (!pairFeasibleInScenario(pts, s, i)) { ok = false; break; }
    }
    if (ok) return null;
  }

  // No scenario works. Find the first adjacent pair that is individually
  // infeasible across all scenarios.
  for (let i = 0; i < orderedIds.length - 1; i++) {
    let pairOk = false;
    for (let s = 0; s < combos; s++) {
      const pts = applyScenario(s);
      if (pairFeasibleInScenario(pts, s, i)) { pairOk = true; break; }
    }
    if (!pairOk) return { index: i, teamId: orderedIds[i], blockedById: orderedIds[i + 1] };
  }

  // Every adjacent pair is individually achievable but the joint combination is
  // not (correlated across matches). Report the first pair as a best-effort hint.
  return { index: 0, teamId: orderedIds[0], blockedById: orderedIds[1] };
}
