import { describe, it, expect, vi } from 'vitest';
import { toMatches } from './adapter';

// Minimal raw shape matching football-data.org v4 FdMatch.
type RawTeam = { id: number; name: string; shortName: string; tla: string };
type RawMatch = {
  id: number;
  utcDate: string;
  status: string;
  stage: string;
  group: string | null;
  homeTeam: RawTeam;
  awayTeam: RawTeam;
  score: { fullTime: { home: number | null; away: number | null } };
};

function makeMatch(overrides: Partial<RawMatch> = {}): RawMatch {
  return {
    id: 1,
    utcDate: '2026-06-11T23:00:00Z',
    status: 'SCHEDULED',
    stage: 'GROUP_STAGE',
    group: 'GROUP_A',
    homeTeam: { id: 10, name: 'Mexico', shortName: 'Mexico', tla: 'MEX' },
    awayTeam: { id: 11, name: 'South Korea', shortName: 'South Korea', tla: 'KOR' },
    score: { fullTime: { home: null, away: null } },
    ...overrides,
  };
}

function payload(matches: RawMatch[]) {
  return { matches };
}

describe('toMatches', () => {
  it('maps a FINISHED group match with scores', () => {
    const result = toMatches(
      payload([makeMatch({ id: 42, status: 'FINISHED', score: { fullTime: { home: 2, away: 1 } } })]),
    );
    expect(result).toHaveLength(1);
    const m = result[0];
    expect(m.id).toBe('42');
    expect(m.stage).toBe('group');
    expect(m.groupId).toBe('A');
    expect(m.homeId).toBe('mexico');
    expect(m.awayId).toBe('south-korea');
    expect(m.played).toBe(true);
    expect(m.homeGoals).toBe(2);
    expect(m.awayGoals).toBe(1);
    expect(m.kickoff).toBe('2026-06-11T23:00:00Z');
  });

  it('maps a SCHEDULED match with no goals', () => {
    const result = toMatches(payload([makeMatch({ status: 'SCHEDULED' })]));
    expect(result).toHaveLength(1);
    const m = result[0];
    expect(m.played).toBe(false);
    expect(m.homeGoals).toBeUndefined();
    expect(m.awayGoals).toBeUndefined();
  });

  it('resolves team by name when TLA is unrecognised', () => {
    const result = toMatches(
      payload([
        makeMatch({
          homeTeam: { id: 99, name: 'Mexico', shortName: 'Mexico', tla: 'XXX' },
        }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].homeId).toBe('mexico');
  });

  it('resolves team by shortName when name does not match', () => {
    const result = toMatches(
      payload([
        makeMatch({
          awayTeam: { id: 99, name: 'Republic of Korea', shortName: 'South Korea', tla: 'XXX' },
        }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].awayId).toBe('south-korea');
  });

  it('skips a match when a team cannot be resolved and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = toMatches(
      payload([
        makeMatch({
          homeTeam: { id: 99, name: 'Unknown FC', shortName: 'Unknown', tla: 'UNK' },
        }),
      ]),
    );
    expect(result).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('filters out non-group-stage matches', () => {
    const result = toMatches(
      payload([
        makeMatch({ id: 1, stage: 'LAST_32' }),
        makeMatch({ id: 2, stage: 'GROUP_STAGE' }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('handles a 0-0 score without treating zero as missing', () => {
    const result = toMatches(
      payload([makeMatch({ status: 'FINISHED', score: { fullTime: { home: 0, away: 0 } } })]),
    );
    expect(result[0].homeGoals).toBe(0);
    expect(result[0].awayGoals).toBe(0);
  });

  it('returns empty array for malformed inputs', () => {
    expect(toMatches(null)).toEqual([]);
    expect(toMatches('string')).toEqual([]);
    expect(toMatches({ noMatches: true })).toEqual([]);
    expect(toMatches({ matches: 'not-an-array' })).toEqual([]);
  });

  it('parses group letter from GROUP_X format', () => {
    const result = toMatches(payload([makeMatch({ group: 'GROUP_L' })]));
    expect(result[0].groupId).toBe('L');
  });

  it('leaves groupId undefined for a null group field', () => {
    const result = toMatches(payload([makeMatch({ group: null })]));
    expect(result[0].groupId).toBeUndefined();
  });
});
