import { describe, it, expect } from 'vitest';
import { computeTeamRecords, stageLabel } from './teamRecord';
import type { Match } from './types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function groupMatch(
  homeId: string,
  awayId: string,
  homeGoals: number,
  awayGoals: number,
): Match {
  return {
    id: `g:${homeId}-${awayId}`,
    stage: 'group',
    groupId: 'A',
    homeId,
    awayId,
    homeGoals,
    awayGoals,
    kickoff: '2026-06-11T20:00:00Z',
    played: true,
  };
}

function koMatch(
  stage: Match['stage'],
  homeId: string,
  awayId: string,
  homeGoals: number,
  awayGoals: number,
): Match {
  return {
    id: `ko:${homeId}-${awayId}`,
    stage,
    homeId,
    awayId,
    homeGoals,
    awayGoals,
    kickoff: '2026-07-01T20:00:00Z',
    played: true,
  };
}

function unplayed(homeId: string, awayId: string): Match {
  return {
    id: `u:${homeId}-${awayId}`,
    stage: 'group',
    groupId: 'A',
    homeId,
    awayId,
    kickoff: '2026-06-11T20:00:00Z',
    played: false,
  };
}

// ---------------------------------------------------------------------------
// computeTeamRecords
// ---------------------------------------------------------------------------

describe('computeTeamRecords', () => {
  it('returns an empty record for an empty match list', () => {
    expect(computeTeamRecords([])).toEqual({});
  });

  it('ignores unplayed matches', () => {
    expect(computeTeamRecords([unplayed('t1', 't2')])).toEqual({});
  });

  it('ignores played matches where a goal tally is null', () => {
    const m: Match = { ...groupMatch('t1', 't2', 1, 0), homeGoals: undefined };
    expect(computeTeamRecords([m])).toEqual({});
  });

  it('credits a win to home and a loss to away', () => {
    const records = computeTeamRecords([groupMatch('t1', 't2', 2, 0)]);
    expect(records['t1']).toMatchObject({ won: 1, drawn: 0, lost: 0, played: 1 });
    expect(records['t2']).toMatchObject({ won: 0, drawn: 0, lost: 1, played: 1 });
  });

  it('credits a win to away and a loss to home', () => {
    const records = computeTeamRecords([groupMatch('t1', 't2', 0, 1)]);
    expect(records['t1']).toMatchObject({ won: 0, lost: 1 });
    expect(records['t2']).toMatchObject({ won: 1, lost: 0 });
  });

  it('credits a draw to both sides', () => {
    const records = computeTeamRecords([groupMatch('t1', 't2', 1, 1)]);
    expect(records['t1']).toMatchObject({ won: 0, drawn: 1, lost: 0 });
    expect(records['t2']).toMatchObject({ won: 0, drawn: 1, lost: 0 });
  });

  it('accumulates goals for and against correctly', () => {
    const records = computeTeamRecords([groupMatch('t1', 't2', 3, 1)]);
    expect(records['t1']).toMatchObject({ goalsFor: 3, goalsAgainst: 1 });
    expect(records['t2']).toMatchObject({ goalsFor: 1, goalsAgainst: 3 });
  });

  it('accumulates across multiple matches for the same team', () => {
    const matches = [
      groupMatch('t1', 't2', 2, 0), // t1 win
      groupMatch('t1', 't3', 1, 1), // t1 draw
      groupMatch('t1', 't4', 0, 2), // t1 loss
    ];
    const records = computeTeamRecords(matches);
    expect(records['t1']).toEqual({
      played: 3,
      won: 1,
      drawn: 1,
      lost: 1,
      goalsFor: 3,
      goalsAgainst: 3,
    });
  });

  it('handles a team appearing only as away side', () => {
    const matches = [
      groupMatch('t1', 't2', 0, 1),
      groupMatch('t3', 't2', 0, 2),
    ];
    const records = computeTeamRecords(matches);
    expect(records['t2']).toEqual({
      played: 2, won: 2, drawn: 0, lost: 0, goalsFor: 3, goalsAgainst: 0,
    });
  });

  it('includes knockout matches in the tally', () => {
    const matches = [
      groupMatch('t1', 't2', 1, 0),
      koMatch('round16', 't1', 't2', 2, 1),
    ];
    const records = computeTeamRecords(matches);
    expect(records['t1']).toMatchObject({ played: 2, won: 2 });
    expect(records['t2']).toMatchObject({ played: 2, lost: 2 });
  });

  it('KO match: a 0-0 draw after extra time counts as drawn for both (penalty result not modelled)', () => {
    // In practice this result would have been decided by penalties, but the Match
    // type only stores the regulation/ET scoreline — both teams get a draw.
    const records = computeTeamRecords([koMatch('semi', 't1', 't2', 1, 1)]);
    expect(records['t1']).toMatchObject({ won: 0, drawn: 1, lost: 0 });
    expect(records['t2']).toMatchObject({ won: 0, drawn: 1, lost: 0 });
  });

  it('KO match: a decisive result (e.g. 2-1 in ET) awards a win and a loss', () => {
    const records = computeTeamRecords([koMatch('quarter', 't1', 't2', 2, 1)]);
    expect(records['t1']).toMatchObject({ won: 1, lost: 0 });
    expect(records['t2']).toMatchObject({ won: 0, lost: 1 });
  });

  it('mixes group and knockout matches across several teams', () => {
    // Group stage
    const matches = [
      groupMatch('arg', 'bra', 1, 0), // arg W, bra L
      groupMatch('arg', 'ger', 0, 0), // arg D, ger D
      groupMatch('bra', 'ger', 2, 1), // bra W, ger L
      koMatch('semi', 'arg', 'bra', 0, 1), // bra W, arg L
    ];
    const records = computeTeamRecords(matches);
    expect(records['arg']).toEqual({
      played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 1, goalsAgainst: 1,
    });
    expect(records['bra']).toEqual({
      played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 3, goalsAgainst: 2,
    });
    expect(records['ger']).toEqual({
      played: 2, won: 0, drawn: 1, lost: 1, goalsFor: 1, goalsAgainst: 2,
    });
  });

  it('does not create entries for teams that only appear in unplayed matches', () => {
    const matches = [unplayed('ghost1', 'ghost2')];
    const records = computeTeamRecords(matches);
    expect(records['ghost1']).toBeUndefined();
    expect(records['ghost2']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// stageLabel
// ---------------------------------------------------------------------------

describe('stageLabel', () => {
  it('returns "Group A" through "Group L" for group stage with a groupId', () => {
    expect(stageLabel('group', 'A')).toBe('Group A');
    expect(stageLabel('group', 'L')).toBe('Group L');
    expect(stageLabel('group', 'F')).toBe('Group F');
  });

  it('returns "Group Stage" when stage is group but no groupId is supplied', () => {
    expect(stageLabel('group')).toBe('Group Stage');
    expect(stageLabel('group', undefined)).toBe('Group Stage');
  });

  it('returns "Round of 32" for round32', () => {
    expect(stageLabel('round32')).toBe('Round of 32');
  });

  it('returns "Round of 16" for round16', () => {
    expect(stageLabel('round16')).toBe('Round of 16');
  });

  it('returns "Quarter-finals" for quarter', () => {
    expect(stageLabel('quarter')).toBe('Quarter-finals');
  });

  it('returns "Semi-finals" for semi', () => {
    expect(stageLabel('semi')).toBe('Semi-finals');
  });

  it('returns "Third-Place Play-off" for thirdPlacePlayoff', () => {
    expect(stageLabel('thirdPlacePlayoff')).toBe('Third-Place Play-off');
  });

  it('returns "Final" for final', () => {
    expect(stageLabel('final')).toBe('Final');
  });

  it('ignores groupId for non-group stages', () => {
    // groupId is irrelevant outside the group stage; should have no effect
    expect(stageLabel('semi', 'A')).toBe('Semi-finals');
    expect(stageLabel('final', 'B')).toBe('Final');
  });
});
