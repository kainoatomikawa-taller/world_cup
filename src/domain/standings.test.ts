import { describe, it, expect } from 'vitest';
import { isGroupComplete } from './elimination';
import { computeGroupStandings } from './standings';
import type { Match, Team } from './types';

const team = (id: string): Team => ({
  id,
  name: id,
  code: id.toUpperCase().slice(0, 3),
  groupId: 'A',
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

describe('isGroupComplete', () => {
  it('is false when a group has no matches', () => {
    expect(isGroupComplete('A', [])).toBe(false);
  });

  it("is true when all of a group's matches are played", () => {
    expect(isGroupComplete('A', [played('x', 'y', 1, 0)])).toBe(true);
  });

  it('is false when any match is unplayed', () => {
    const matches: Match[] = [
      {
        id: 'A-1',
        stage: 'group',
        groupId: 'A',
        homeId: 'x',
        awayId: 'y',
        kickoff: '2026-06-11T20:00:00Z',
        played: false,
      },
    ];
    expect(isGroupComplete('A', matches)).toBe(false);
  });
});

describe('computeGroupStandings', () => {
  const teams = [team('t1'), team('t2'), team('t3'), team('t4')];

  it('tallies points, goals, and ranks a clean group with no ties', () => {
    // t1 wins all, t2 wins two, t3 wins one, t4 loses all.
    const matches = [
      played('t1', 't2', 1, 0),
      played('t1', 't3', 1, 0),
      played('t1', 't4', 1, 0),
      played('t2', 't3', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
    ];
    const table = computeGroupStandings('A', teams, matches);
    expect(table.map((r) => r.teamId)).toEqual(['t1', 't2', 't3', 't4']);
    expect(table.map((r) => r.points)).toEqual([9, 6, 3, 0]);
    expect(table[0].position).toBe(1);
    expect(table[0]).toMatchObject({ won: 3, goalsFor: 3, goalsAgainst: 0 });
  });

  it('breaks an overall tie using head-to-head results', () => {
    // t1 and t2 finish level on points, GD, and goals; t1 beat t2 head-to-head.
    // t3 and t4 finish level on points, GD, and goals; t4 beat t3 head-to-head.
    const matches = [
      played('t1', 't2', 1, 0), // t1 beats t2 (head-to-head)
      played('t3', 't1', 1, 0), // t3 beats t1
      played('t1', 't4', 1, 0), // t1 beats t4
      played('t2', 't3', 1, 0), // t2 beats t3
      played('t2', 't4', 1, 0), // t2 beats t4
      played('t4', 't3', 1, 0), // t4 beats t3 (head-to-head)
    ];
    const table = computeGroupStandings('A', teams, matches);
    // t1 & t2 both 6pts; t3 & t4 both 3pts. H2H decides each pair.
    expect(table.map((r) => r.points)).toEqual([6, 6, 3, 3]);
    expect(table.map((r) => r.teamId)).toEqual(['t1', 't2', 't4', 't3']);
  });

  it('ignores unplayed matches', () => {
    const matches: Match[] = [
      played('t1', 't2', 2, 0),
      { ...played('t3', 't4', 5, 0), played: false, homeGoals: undefined, awayGoals: undefined },
    ];
    const table = computeGroupStandings('A', teams, matches);
    const t1 = table.find((r) => r.teamId === 't1')!;
    const t3 = table.find((r) => r.teamId === 't3')!;
    expect(t1.points).toBe(3);
    expect(t3.played).toBe(0);
  });
});
