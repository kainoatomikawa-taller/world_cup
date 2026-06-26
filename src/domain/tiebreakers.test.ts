import { describe, it, expect } from 'vitest';
import { sortByTiebreakers } from './tiebreakers';
import type { Match, Standing } from './types';

const standing = (
  teamId: string,
  points: number,
  goalDifference: number,
  goalsFor: number,
): Standing => ({
  teamId,
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor,
  goalsAgainst: goalsFor - goalDifference,
  goalDifference,
  points,
  position: 1,
});

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

describe('sortByTiebreakers', () => {
  it('ranks by points when all teams have distinct totals (criterion 1)', () => {
    const rows = [
      standing('t3', 3, 0, 1),
      standing('t1', 9, 3, 3),
      standing('t4', 0, -3, 0),
      standing('t2', 6, 1, 2),
    ];
    const result = sortByTiebreakers(rows, []);
    expect(result.map((r) => r.teamId)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('separates teams with equal points by overall goal difference (criterion 2)', () => {
    // t1 and t2 both 4 pts; t1 has better GD.
    const rows = [
      standing('t2', 4, 1, 2),
      standing('t1', 4, 2, 3),
    ];
    const result = sortByTiebreakers(rows, []);
    expect(result.map((r) => r.teamId)).toEqual(['t1', 't2']);
  });

  it('applies head-to-head to break a 2-team tie on all overall criteria (criteria 4–6)', () => {
    // Both teams: 6 pts, +1 GD, 2 goals. t1 beat t2 1-0 head-to-head.
    const rows = [
      standing('t2', 6, 1, 2),
      standing('t1', 6, 1, 2),
    ];
    const result = sortByTiebreakers(rows, [played('t1', 't2', 1, 0)]);
    expect(result.map((r) => r.teamId)).toEqual(['t1', 't2']);
  });

  it('uses H2H goal difference to rank a circular tie where H2H points are equal (criterion 5)', () => {
    // All three equal on overall: 3 pts, 0 GD, 3 goals.
    // Circular wins but unequal margins:
    //   t1 beats t2 3-0  →  t1 H2H GD +1 (net of +3 beat and -2 loss)
    //   t2 beats t3 2-0  →  t3 H2H GD  0 (net of +2 beat and -2 loss)
    //   t3 beats t1 2-0  →  t2 H2H GD -1 (net of -3 loss and +2 beat)
    // H2H points are all 3 (equal); H2H GD resolves: t1(+1) > t3(0) > t2(-1).
    const rows = [
      standing('t3', 3, 0, 3),
      standing('t2', 3, 0, 3),
      standing('t1', 3, 0, 3),
    ];
    const matches = [
      played('t1', 't2', 3, 0),
      played('t2', 't3', 2, 0),
      played('t3', 't1', 2, 0),
    ];
    const result = sortByTiebreakers(rows, matches);
    expect(result.map((r) => r.teamId)).toEqual(['t1', 't3', 't2']);
  });

  it('resolves a 3-team circular H2H tie deterministically by team id (criterion 8 proxy)', () => {
    // All three equal on overall: 3 pts, 0 GD, 1 goal.
    // H2H: t1 beat t2, t2 beat t3, t3 beat t1 — circular, so H2H metrics are also
    // all equal (3 pts, 0 GD, 1 goal each). Falls through to team-id order.
    const rows = [
      standing('t3', 3, 0, 1),
      standing('t2', 3, 0, 1),
      standing('t1', 3, 0, 1),
    ];
    const matches = [
      played('t1', 't2', 1, 0),
      played('t2', 't3', 1, 0),
      played('t3', 't1', 1, 0),
    ];
    const result = sortByTiebreakers(rows, matches);
    expect(result.map((r) => r.teamId)).toEqual(['t1', 't2', 't3']);
  });
});
