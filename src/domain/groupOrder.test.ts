import { describe, it, expect } from 'vitest';
import { firstIllegalPlacement, isLegalGroupOrder } from './groupOrder';
import { computePlacementPossibilities, firstJointlyIllegalGroupPlacement } from './elimination';
import { computeGroupStandings } from './standings';
import type { Match, Team } from './types';

const team = (id: string): Team => ({
  id,
  name: id,
  code: id.toUpperCase().slice(0, 3),
  groupId: 'A',
});
const TEAMS = [team('t1'), team('t2'), team('t3'), team('t4')];

const played = (homeId: string, awayId: string, h: number, a: number): Match => ({
  id: `${homeId}-${awayId}`,
  stage: 'group',
  groupId: 'A',
  homeId,
  awayId,
  homeGoals: h,
  awayGoals: a,
  kickoff: '2026-06-11T20:00:00Z',
  played: true,
});

const unplayed = (homeId: string, awayId: string): Match => ({
  id: `${homeId}-${awayId}`,
  stage: 'group',
  groupId: 'A',
  homeId,
  awayId,
  kickoff: '2026-06-11T20:00:00Z',
  played: false,
});

function possibilities(matches: Match[]) {
  const standings = computeGroupStandings('A', TEAMS, matches);
  return computePlacementPossibilities('A', TEAMS, matches, standings);
}

describe('isLegalGroupOrder', () => {
  it('accepts any order before any match is played', () => {
    const matches = [
      unplayed('t1', 't2'), unplayed('t1', 't3'), unplayed('t1', 't4'),
      unplayed('t2', 't3'), unplayed('t2', 't4'), unplayed('t3', 't4'),
    ];
    const p = possibilities(matches);
    expect(isLegalGroupOrder(['t4', 't3', 't2', 't1'], p)).toBe(true);
    expect(isLegalGroupOrder(['t1', 't2', 't3', 't4'], p)).toBe(true);
  });

  it('rejects placing an eliminated team in the top 3', () => {
    // t4 has lost all 3 games — locked to 4th.
    const matches = [
      played('t1', 't4', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
      unplayed('t1', 't2'),
      unplayed('t1', 't3'),
      unplayed('t2', 't3'),
    ];
    const p = possibilities(matches);
    expect(isLegalGroupOrder(['t1', 't2', 't4', 't3'], p)).toBe(false);
    expect(isLegalGroupOrder(['t4', 't1', 't2', 't3'], p)).toBe(false);
  });

  it('accepts the only legal order for a fully-played group', () => {
    const matches = [
      played('t1', 't2', 1, 0),
      played('t1', 't3', 1, 0),
      played('t1', 't4', 1, 0),
      played('t2', 't3', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
    ];
    const p = possibilities(matches);
    expect(isLegalGroupOrder(['t1', 't2', 't3', 't4'], p)).toBe(true);
    expect(isLegalGroupOrder(['t2', 't1', 't3', 't4'], p)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// firstJointlyIllegalGroupPlacement
// ---------------------------------------------------------------------------

function standings(matches: Match[]) {
  return computeGroupStandings('A', TEAMS, matches);
}

describe('firstJointlyIllegalGroupPlacement', () => {
  it('returns null when any order is valid before matches are played', () => {
    const matches = [
      unplayed('t1', 't2'), unplayed('t1', 't3'), unplayed('t1', 't4'),
      unplayed('t2', 't3'), unplayed('t2', 't4'), unplayed('t3', 't4'),
    ];
    const s = standings(matches);
    expect(firstJointlyIllegalGroupPlacement(['t4', 't3', 't2', 't1'], 'A', TEAMS, matches, s)).toBeNull();
    expect(firstJointlyIllegalGroupPlacement(['t1', 't2', 't3', 't4'], 'A', TEAMS, matches, s)).toBeNull();
  });

  it('returns null for the only valid order in a complete group', () => {
    const matches = [
      played('t1', 't2', 2, 0),
      played('t1', 't3', 1, 0),
      played('t1', 't4', 1, 0),
      played('t2', 't3', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
    ];
    const s = standings(matches);
    expect(firstJointlyIllegalGroupPlacement(['t1', 't2', 't3', 't4'], 'A', TEAMS, matches, s)).toBeNull();
  });

  it('rejects an inverted order in a complete group', () => {
    const matches = [
      played('t1', 't2', 1, 0),
      played('t1', 't3', 1, 0),
      played('t1', 't4', 1, 0),
      played('t2', 't3', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
    ];
    const s = standings(matches);
    const result = firstJointlyIllegalGroupPlacement(['t2', 't1', 't3', 't4'], 'A', TEAMS, matches, s);
    expect(result).not.toBeNull();
    expect(result?.index).toBe(0);
    expect(result?.teamId).toBe('t2');
    expect(result?.blockedById).toBe('t1');
  });

  it('rejects placing a locked-out team above its ceiling with matches remaining', () => {
    // t4 has lost all 3 games (0 pts). The other teams each have ≥3 pts.
    // t4 can never finish above t3.
    const matches = [
      played('t1', 't4', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
      unplayed('t1', 't2'),
      unplayed('t1', 't3'),
      unplayed('t2', 't3'),
    ];
    const s = standings(matches);
    // t4 has 0 pts; the minimum any of t1/t2/t3 can achieve is 3 pts.
    // Ordering [t1, t2, t4, t3] places t4 at 3rd — impossible.
    const result = firstJointlyIllegalGroupPlacement(['t1', 't2', 't4', 't3'], 'A', TEAMS, matches, s);
    expect(result).not.toBeNull();
    expect(result?.teamId).toBe('t4');
    expect(result?.blockedById).toBe('t3');
  });

  it('accepts an ordering consistent with at least one remaining scenario', () => {
    // Two matches remain. Either t1 or t2 can win — both orderings are feasible.
    const matches = [
      played('t1', 't3', 1, 0),
      played('t2', 't4', 1, 0),
      played('t1', 't4', 1, 0),
      played('t2', 't3', 1, 0),
      unplayed('t1', 't2'),
      unplayed('t3', 't4'),
    ];
    const s = standings(matches);
    expect(firstJointlyIllegalGroupPlacement(['t1', 't2', 't3', 't4'], 'A', TEAMS, matches, s)).toBeNull();
    expect(firstJointlyIllegalGroupPlacement(['t2', 't1', 't3', 't4'], 'A', TEAMS, matches, s)).toBeNull();
  });

  it('rejects an ordering that no scenario can produce', () => {
    // t1 has won every match so far (6 pts). t4 has lost every match (0 pts).
    // [t4, t3, t2, t1] is impossible since t4 max pts < t1 min pts.
    const matches = [
      played('t1', 't3', 1, 0),
      played('t1', 't4', 1, 0),
      played('t2', 't3', 1, 0),
      played('t2', 't4', 1, 0),
      unplayed('t1', 't2'),
      unplayed('t3', 't4'),
    ];
    const s = standings(matches);
    const result = firstJointlyIllegalGroupPlacement(['t4', 't3', 't2', 't1'], 'A', TEAMS, matches, s);
    expect(result).not.toBeNull();
    // Base: t1=6, t2=6, t3=0, t4=0 (each played 4 matches, t1 and t2 won 2 each).
    // Pair (t4, t3): t4 can win t3vt4 → t4=3 >= t3=0 → individually feasible.
    // Pair (t3, t2): t3 max = 0+3 = 3; t2 min = 6 (t2 cannot lose points) → 3 < 6 → infeasible.
    // So the first infeasible pair is index=1 (t3 cannot be above t2).
    expect(result?.index).toBe(1);
    expect(result?.teamId).toBe('t3');
    expect(result?.blockedById).toBe('t2');
  });
});

describe('firstIllegalPlacement', () => {
  it('returns null for a valid order', () => {
    const matches = [
      unplayed('t1', 't2'), unplayed('t1', 't3'), unplayed('t1', 't4'),
      unplayed('t2', 't3'), unplayed('t2', 't4'), unplayed('t3', 't4'),
    ];
    const p = possibilities(matches);
    expect(firstIllegalPlacement(['t1', 't2', 't3', 't4'], p)).toBeNull();
  });

  it('returns the offending team and position', () => {
    const matches = [
      played('t1', 't4', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
      unplayed('t1', 't2'),
      unplayed('t1', 't3'),
      unplayed('t2', 't3'),
    ];
    const p = possibilities(matches);
    const result = firstIllegalPlacement(['t1', 't2', 't4', 't3'], p);
    expect(result).toEqual({ teamId: 't4', attemptedPosition: 3 });
  });
});
