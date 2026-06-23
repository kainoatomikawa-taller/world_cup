import { describe, it, expect } from 'vitest';
import { firstIllegalPlacement, isLegalGroupOrder } from './groupOrder';
import { computePlacementPossibilities } from './elimination';
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
