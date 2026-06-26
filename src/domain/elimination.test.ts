import { describe, it, expect } from 'vitest';
import { computePlacementPossibilities } from './elimination';
import { computeGroupStandings } from './standings';
import type { Match, PlacementPossibility, Team } from './types';

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

function possibilitiesFor(matches: Match[]): Record<string, PlacementPossibility> {
  const standings = computeGroupStandings('A', TEAMS, matches);
  const list = computePlacementPossibilities('A', TEAMS, matches, standings);
  return Object.fromEntries(list.map((p) => [p.teamId, p]));
}

describe('computePlacementPossibilities', () => {
  it('before any match, every team can still finish 1st, 2nd, or 3rd', () => {
    const matches = [
      unplayed('t1', 't2'),
      unplayed('t1', 't3'),
      unplayed('t1', 't4'),
      unplayed('t2', 't3'),
      unplayed('t2', 't4'),
      unplayed('t3', 't4'),
    ];
    const p = possibilitiesFor(matches);
    for (const id of ['t1', 't2', 't3', 't4']) {
      expect(p[id]).toMatchObject({
        canFinish1st: true,
        canFinish2nd: true,
        canFinish3rd: true,
        locked: false,
      });
    }
  });

  it('treats a group with no scheduled matches as fully open (not complete)', () => {
    // Regression: empty fixtures must not be mistaken for a completed group.
    const p = possibilitiesFor([]);
    for (const id of ['t1', 't2', 't3', 't4']) {
      expect(p[id]).toMatchObject({
        canFinish1st: true,
        canFinish2nd: true,
        canFinish3rd: true,
        canFinish4th: true,
        locked: false,
      });
    }
  });

  it('locks every team to its final position once the group is complete', () => {
    const matches = [
      played('t1', 't2', 1, 0),
      played('t1', 't3', 1, 0),
      played('t1', 't4', 1, 0),
      played('t2', 't3', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
    ];
    const p = possibilitiesFor(matches);
    expect(p.t1).toMatchObject({ canFinish1st: true, canFinish2nd: false, canFinish3rd: false, locked: true });
    expect(p.t3).toMatchObject({ canFinish1st: false, canFinish2nd: false, canFinish3rd: true, locked: true });
    expect(p.t4).toMatchObject({ canFinish1st: false, canFinish2nd: false, canFinish3rd: false, locked: true });
  });

  it('marks a team that can no longer reach 3rd as eliminated, without locking the group', () => {
    // t4 has played all 3 games and lost them all (0 pts, no matches left).
    // t1, t2, t3 are all already on >= 3 pts with games still to play.
    const matches = [
      played('t1', 't4', 1, 0),
      played('t2', 't4', 1, 0),
      played('t3', 't4', 1, 0),
      played('t1', 't2', 1, 0), // t1 -> 6, t2 -> 3
      unplayed('t1', 't3'),
      unplayed('t2', 't3'),
    ];
    const p = possibilitiesFor(matches);
    // t4 can only ever be 4th: three teams are already above its max of 0 pts.
    expect(p.t4).toMatchObject({
      canFinish1st: false,
      canFinish2nd: false,
      canFinish3rd: false,
      locked: false,
    });
    // t1 has clinched a chance at the top.
    expect(p.t1.canFinish1st).toBe(true);
    // t3 still has everything to play for.
    expect(p.t3.canFinish3rd).toBe(true);
  });

  it('locks a team to 4th when H2H defeats prevent it from rising above tied teams', () => {
    // t4 has already lost head-to-head to both t2 and t3.
    // t4's only remaining game is vs t1.
    // Even if t4 wins (reaching 3 pts and tying with t2 or t3), the H2H defeats
    // mean it can never finish above either of them.
    const matches = [
      played('t1', 't2', 1, 0), // t1=3, t2=0 so far
      played('t1', 't3', 1, 0), // t1=6, t3=0 so far
      played('t2', 't4', 1, 0), // t2=3 total, t4=0 — t2 beat t4 in H2H
      played('t3', 't4', 1, 0), // t3=3 total, t4=0 — t3 beat t4 in H2H
      unplayed('t1', 't4'),
      unplayed('t2', 't3'),
    ];
    const p = possibilitiesFor(matches);
    expect(p.t4).toMatchObject({
      canFinish1st: false,
      canFinish2nd: false,
      canFinish3rd: false, // H2H defeats to both t2 and t3 block this
      canFinish4th: true,
      locked: false,
    });
    // The other teams' possibilities are not disrupted by this fix.
    expect(p.t1.canFinish1st).toBe(true);
    expect(p.t2.canFinish3rd).toBe(true);
    expect(p.t3.canFinish3rd).toBe(true);
  });
});
