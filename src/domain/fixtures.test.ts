import { describe, it, expect } from 'vitest';
import { groupFixtures, groupMatchDays, selectDefaultMatchDay } from './fixtures';
import type { Match } from './types';

const base = (id: string, overrides: Partial<Match> = {}): Match => ({
  id,
  stage: 'group',
  groupId: 'A',
  homeId: 'team1',
  awayId: 'team2',
  kickoff: '2026-06-11T20:00:00Z',
  played: false,
  ...overrides,
});

describe('groupFixtures', () => {
  it('returns empty array for no matches', () => {
    expect(groupFixtures([])).toEqual([]);
  });

  it('places a single match in a single group', () => {
    const groups = groupFixtures([base('m1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].matches[0].id).toBe('m1');
  });

  it('groups group-stage matches on the same UTC date into one section', () => {
    const matches = [
      base('m1', { kickoff: '2026-06-11T18:00:00Z' }),
      base('m2', { kickoff: '2026-06-11T21:00:00Z' }),
    ];
    const groups = groupFixtures(matches);
    expect(groups).toHaveLength(1);
    expect(groups[0].matches).toHaveLength(2);
  });

  it('puts group-stage matches on different dates in separate sections', () => {
    const matches = [
      base('m1', { kickoff: '2026-06-11T20:00:00Z' }),
      base('m2', { kickoff: '2026-06-12T20:00:00Z' }),
    ];
    const groups = groupFixtures(matches);
    expect(groups).toHaveLength(2);
    expect(groups[0].matches[0].id).toBe('m1');
    expect(groups[1].matches[0].id).toBe('m2');
  });

  it('sorts matches within a date section by kickoff time', () => {
    const matches = [
      base('m_late', { kickoff: '2026-06-11T23:00:00Z' }),
      base('m_early', { kickoff: '2026-06-11T18:00:00Z' }),
    ];
    const groups = groupFixtures(matches);
    expect(groups[0].matches.map((m) => m.id)).toEqual(['m_early', 'm_late']);
  });

  it('groups knockout matches by stage, not by date', () => {
    const matches = [
      base('r1', { stage: 'round32', groupId: undefined, kickoff: '2026-07-01T20:00:00Z' }),
      base('r2', { stage: 'round32', groupId: undefined, kickoff: '2026-07-02T20:00:00Z' }),
      base('q1', { stage: 'quarter', groupId: undefined, kickoff: '2026-07-10T20:00:00Z' }),
    ];
    const groups = groupFixtures(matches);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('Round of 32');
    expect(groups[0].matches).toHaveLength(2);
    expect(groups[1].label).toBe('Quarter-finals');
  });

  it('orders group stage before all knockout stages regardless of kickoff order', () => {
    const matches = [
      base('k1', { stage: 'final', groupId: undefined, kickoff: '2026-07-20T20:00:00Z' }),
      base('g1', { kickoff: '2026-06-11T20:00:00Z' }),
      base('k2', { stage: 'round32', groupId: undefined, kickoff: '2026-07-01T20:00:00Z' }),
    ];
    const groups = groupFixtures(matches);
    expect(groups[0].matches[0].stage).toBe('group');
    expect(groups[groups.length - 1].matches[0].stage).toBe('final');
  });

  it('orders knockout stages in the correct tournament sequence', () => {
    const matches: Match[] = [
      base('f', { stage: 'final', groupId: undefined, kickoff: '2026-07-20T20:00:00Z' }),
      base('s', { stage: 'semi', groupId: undefined, kickoff: '2026-07-15T20:00:00Z' }),
      base('r', { stage: 'round32', groupId: undefined, kickoff: '2026-07-01T20:00:00Z' }),
      base('tp', { stage: 'thirdPlacePlayoff', groupId: undefined, kickoff: '2026-07-19T20:00:00Z' }),
    ];
    const groups = groupFixtures(matches);
    expect(groups.map((g) => g.label)).toEqual([
      'Round of 32',
      'Semi-finals',
      'Third-Place Play-off',
      'Final',
    ]);
  });

  it('uses a formatted date label for group-stage sections', () => {
    const groups = groupFixtures([base('m1', { kickoff: '2026-06-11T20:00:00Z' })]);
    expect(groups[0].label).toBe('11 June 2026');
  });

  it('preserves played state and score on returned matches', () => {
    const matches = [base('m1', { played: true, homeGoals: 2, awayGoals: 1 })];
    const m = groupFixtures(matches)[0].matches[0];
    expect(m.played).toBe(true);
    expect(m.homeGoals).toBe(2);
    expect(m.awayGoals).toBe(1);
  });
});

describe('groupMatchDays', () => {
  it('returns empty array for no matches', () => {
    expect(groupMatchDays([])).toEqual([]);
  });

  it('groups matches on the same UTC date into one match day', () => {
    const matches = [
      base('m1', { kickoff: '2026-06-11T18:00:00Z' }),
      base('m2', { kickoff: '2026-06-11T21:00:00Z' }),
    ];
    const days = groupMatchDays(matches);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe('2026-06-11');
    expect(days[0].matches).toHaveLength(2);
  });

  it('produces one match day per distinct UTC date', () => {
    const matches = [
      base('m1', { kickoff: '2026-06-11T20:00:00Z' }),
      base('m2', { kickoff: '2026-06-12T20:00:00Z' }),
    ];
    const days = groupMatchDays(matches);
    expect(days).toHaveLength(2);
    expect(days[0].date).toBe('2026-06-11');
    expect(days[1].date).toBe('2026-06-12');
  });

  it('sorts match days in ascending date order regardless of input order', () => {
    const matches = [
      base('m2', { kickoff: '2026-06-13T20:00:00Z' }),
      base('m1', { kickoff: '2026-06-11T20:00:00Z' }),
    ];
    const days = groupMatchDays(matches);
    expect(days[0].date).toBe('2026-06-11');
    expect(days[1].date).toBe('2026-06-13');
  });

  it('buckets knockout matches by date, not by stage', () => {
    const matches = [
      base('r1', { stage: 'round32', groupId: undefined, kickoff: '2026-07-01T18:00:00Z' }),
      base('f1', { stage: 'final',   groupId: undefined, kickoff: '2026-07-01T21:00:00Z' }),
    ];
    const days = groupMatchDays(matches);
    expect(days).toHaveLength(1);
    expect(days[0].matches).toHaveLength(2);
  });

  it('attaches a formatted label to each match day', () => {
    const days = groupMatchDays([base('m1', { kickoff: '2026-06-11T20:00:00Z' })]);
    expect(days[0].label).toBe('11 June 2026');
  });
});

describe('selectDefaultMatchDay', () => {
  it('returns undefined for an empty list', () => {
    expect(selectDefaultMatchDay([])).toBeUndefined();
  });

  it("returns today's match day when fixtures exist on the current date", () => {
    const days = groupMatchDays([base('m1', { kickoff: '2026-06-15T20:00:00Z' })]);
    const result = selectDefaultMatchDay(days, new Date('2026-06-15T10:00:00Z'));
    expect(result?.date).toBe('2026-06-15');
  });

  it('falls back to the next future match day when today has no fixtures', () => {
    const days = groupMatchDays([
      base('m1', { kickoff: '2026-06-12T20:00:00Z' }),
      base('m2', { kickoff: '2026-06-14T20:00:00Z' }),
    ]);
    // today is between the two match days
    const result = selectDefaultMatchDay(days, new Date('2026-06-13T10:00:00Z'));
    expect(result?.date).toBe('2026-06-14');
  });

  it("falls back to the final's match day when no future fixtures remain", () => {
    const days = groupMatchDays([
      base('m1', { kickoff: '2026-06-11T20:00:00Z' }),
      base('f1', { stage: 'final', groupId: undefined, kickoff: '2026-07-19T20:00:00Z' }),
    ]);
    const result = selectDefaultMatchDay(days, new Date('2026-08-01T10:00:00Z'));
    expect(result?.date).toBe('2026-07-19');
  });

  it('falls back to the last match day when no future fixtures and no final', () => {
    const days = groupMatchDays([
      base('m1', { kickoff: '2026-06-11T20:00:00Z' }),
      base('m2', { kickoff: '2026-06-12T20:00:00Z' }),
    ]);
    const result = selectDefaultMatchDay(days, new Date('2026-08-01T10:00:00Z'));
    expect(result?.date).toBe('2026-06-12');
  });
});
