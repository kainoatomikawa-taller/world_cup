import { describe, it, expect } from 'vitest';
import {
  aggregateTeamStats,
  buildRatingsLeaderboard,
  buildTouchesLeaderboard,
} from './tournamentStats';
import type { Match, PlayerRating, TeamMatchStats } from './types';

// ---- test helpers ----

function side(overrides: Partial<TeamMatchStats> = {}): TeamMatchStats {
  return {
    possession: 50,
    shots: 10,
    shotsOnTarget: 4,
    passes: 400,
    corners: 4,
    freeKicks: 10,
    yellowCards: 1,
    redCards: 0,
    ...overrides,
  };
}

function enrichedMatch(
  homeId: string,
  awayId: string,
  homeOverrides: Partial<TeamMatchStats> = {},
  awayOverrides: Partial<TeamMatchStats> = {},
  matchId = `${homeId}-${awayId}`,
): Match {
  return {
    id: matchId,
    stage: 'group',
    groupId: 'A',
    homeId,
    awayId,
    homeGoals: 1,
    awayGoals: 0,
    kickoff: '2026-06-11T20:00:00Z',
    played: true,
    stats: {
      matchId,
      home: side(homeOverrides),
      away: side(awayOverrides),
    },
  };
}

function unenrichedMatch(homeId: string, awayId: string): Match {
  return {
    id: `${homeId}-${awayId}`,
    stage: 'group',
    groupId: 'A',
    homeId,
    awayId,
    homeGoals: 1,
    awayGoals: 0,
    kickoff: '2026-06-11T20:00:00Z',
    played: true,
    // no stats
  };
}

function unplayed(homeId: string, awayId: string): Match {
  return {
    id: `${homeId}-${awayId}`,
    stage: 'group',
    groupId: 'A',
    homeId,
    awayId,
    kickoff: '2026-06-11T20:00:00Z',
    played: false,
  };
}

function rating(
  playerId: string,
  teamId: string,
  matchId: string,
  r: number,
  source?: string,
): PlayerRating {
  return { playerId, teamId, matchId, rating: r, source };
}

// ---- aggregateTeamStats ----

describe('aggregateTeamStats', () => {
  it('returns empty object for an empty match list', () => {
    expect(aggregateTeamStats([])).toEqual({});
  });

  it('returns empty object when no matches have stats', () => {
    expect(aggregateTeamStats([unenrichedMatch('t1', 't2')])).toEqual({});
  });

  it('skips unplayed matches', () => {
    expect(aggregateTeamStats([unplayed('t1', 't2')])).toEqual({});
  });

  it('creates entries for both home and away teams from a single match', () => {
    const result = aggregateTeamStats([enrichedMatch('t1', 't2', { shots: 8 }, { shots: 12 })]);
    expect(result['t1'].totalShots).toBe(8);
    expect(result['t2'].totalShots).toBe(12);
    expect(result['t1'].matchesWithStats).toBe(1);
    expect(result['t2'].matchesWithStats).toBe(1);
  });

  it('sums shots, corners, cards etc. across multiple matches for the same team', () => {
    const matches = [
      enrichedMatch('t1', 't2', { shots: 8, corners: 3, yellowCards: 2 }),
      enrichedMatch('t1', 't3', { shots: 12, corners: 5, yellowCards: 1 }),
    ];
    const { t1 } = aggregateTeamStats(matches);
    expect(t1.totalShots).toBe(20);
    expect(t1.totalCorners).toBe(8);
    expect(t1.totalYellowCards).toBe(3);
    expect(t1.matchesWithStats).toBe(2);
  });

  it('averages possession across all matches with stats', () => {
    const matches = [
      enrichedMatch('t1', 't2', { possession: 60 }, { possession: 40 }),
      enrichedMatch('t1', 't3', { possession: 55 }, { possession: 45 }),
    ];
    const { t1 } = aggregateTeamStats(matches);
    expect(t1.avgPossession).toBeCloseTo(57.5);
  });

  it('averages passCompletionPct only over matches where it is present', () => {
    const matches = [
      enrichedMatch('t1', 't2', { passCompletionPct: 80 }),
      enrichedMatch('t1', 't3'),  // no passCompletionPct in overrides → undefined
    ];
    const { t1 } = aggregateTeamStats(matches);
    // Only the first match contributes
    expect(t1.avgPassCompletionPct).toBeCloseTo(80);
  });

  it('returns null avgPassCompletionPct when no match provides the field', () => {
    const result = aggregateTeamStats([enrichedMatch('t1', 't2')]);
    expect(result['t1'].avgPassCompletionPct).toBeNull();
  });

  it('handles a mix of enriched, unenriched, and unplayed matches', () => {
    const matches = [
      enrichedMatch('t1', 't2', { shots: 10 }),
      unenrichedMatch('t1', 't3'),  // same team, no stats → ignored
      unplayed('t1', 't4'),          // unplayed → ignored
    ];
    const result = aggregateTeamStats(matches);
    expect(result['t1'].totalShots).toBe(10);
    expect(result['t1'].matchesWithStats).toBe(1);
    expect(result['t3']).toBeUndefined();
    expect(result['t4']).toBeUndefined();
  });

  it('accumulates redCards and freeKicks correctly', () => {
    const matches = [
      enrichedMatch('t1', 't2', { redCards: 1, freeKicks: 15 }, { redCards: 0, freeKicks: 8 }),
      enrichedMatch('t1', 't3', { redCards: 0, freeKicks: 10 }, { redCards: 2, freeKicks: 20 }),
    ];
    const result = aggregateTeamStats(matches);
    expect(result['t1'].totalRedCards).toBe(1);
    expect(result['t1'].totalFreeKicks).toBe(25);
  });

  it('counts passes and shots on target correctly across teams', () => {
    const match = enrichedMatch(
      't1', 't2',
      { passes: 500, shotsOnTarget: 6 },
      { passes: 350, shotsOnTarget: 2 },
    );
    const result = aggregateTeamStats([match]);
    expect(result['t1'].totalPasses).toBe(500);
    expect(result['t1'].totalShotsOnTarget).toBe(6);
    expect(result['t2'].totalPasses).toBe(350);
    expect(result['t2'].totalShotsOnTarget).toBe(2);
  });
});

// ---- buildRatingsLeaderboard ----

describe('buildRatingsLeaderboard', () => {
  it('returns empty array for empty input', () => {
    expect(buildRatingsLeaderboard([])).toEqual([]);
  });

  it('returns a single entry for a single rating', () => {
    const result = buildRatingsLeaderboard([rating('p1', 't1', 'm1', 8.0)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ playerId: 'p1', teamId: 't1', avgRating: 8.0, matchCount: 1 });
  });

  it('averages multiple ratings for the same player+source across matches', () => {
    const ratings = [
      rating('p1', 't1', 'm1', 8.0, 'sofascore'),
      rating('p1', 't1', 'm2', 9.0, 'sofascore'),
    ];
    const result = buildRatingsLeaderboard(ratings);
    expect(result).toHaveLength(1);
    expect(result[0].avgRating).toBeCloseTo(8.5);
    expect(result[0].matchCount).toBe(2);
  });

  it('sorts by avgRating descending', () => {
    const ratings = [
      rating('p1', 't1', 'm1', 7.0),
      rating('p2', 't2', 'm1', 9.0),
      rating('p3', 't3', 'm1', 8.0),
    ];
    const result = buildRatingsLeaderboard(ratings);
    expect(result.map((e) => e.playerId)).toEqual(['p2', 'p3', 'p1']);
  });

  it('filters out players below the minMatches threshold', () => {
    const ratings = [
      rating('p1', 't1', 'm1', 9.5),          // 1 match
      rating('p2', 't2', 'm1', 8.0),
      rating('p2', 't2', 'm2', 8.5),           // 2 matches
    ];
    const result = buildRatingsLeaderboard(ratings, 2);
    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('p2');
  });

  it('keeps ratings from different sources as separate entries', () => {
    const ratings = [
      rating('p1', 't1', 'm1', 8.0, 'sofascore'),
      rating('p1', 't1', 'm1', 7.5, 'fbref'),
    ];
    const result = buildRatingsLeaderboard(ratings);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.source).sort()).toEqual(['fbref', 'sofascore']);
  });

  it('treats ratings with no source as a single group', () => {
    const ratings = [
      rating('p1', 't1', 'm1', 7.0),
      rating('p1', 't1', 'm2', 9.0),
    ];
    const result = buildRatingsLeaderboard(ratings);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBeUndefined();
    expect(result[0].avgRating).toBeCloseTo(8.0);
  });

  it('returns correct playerId and teamId for named players', () => {
    const result = buildRatingsLeaderboard([rating('messi', 'argentina', 'm1', 9.2, 'sofascore')]);
    expect(result[0]).toMatchObject({ playerId: 'messi', teamId: 'argentina' });
  });
});

// ---- buildTouchesLeaderboard ----

describe('buildTouchesLeaderboard', () => {
  it('returns empty array for an empty match list', () => {
    expect(buildTouchesLeaderboard([])).toEqual([]);
  });

  it('returns empty array when no match has player stats', () => {
    expect(buildTouchesLeaderboard([unenrichedMatch('t1', 't2')])).toEqual([]);
  });

  it('skips unplayed matches even if they carry a stats block', () => {
    const match: Match = {
      ...unplayed('t1', 't2'),
      stats: {
        matchId: 't1-t2',
        home: side(),
        away: side(),
        players: [{ playerId: 'p1', touches: 80 }],
      },
    };
    expect(buildTouchesLeaderboard([match])).toEqual([]);
  });

  it('returns empty array when stats block has no players array', () => {
    const match: Match = {
      ...enrichedMatch('t1', 't2'),
      stats: { matchId: 't1-t2', home: side(), away: side() },
    };
    expect(buildTouchesLeaderboard([match])).toEqual([]);
  });

  it('skips players with no touches field', () => {
    const match: Match = {
      ...enrichedMatch('t1', 't2'),
      stats: {
        matchId: 't1-t2',
        home: side(),
        away: side(),
        players: [{ playerId: 'p1' /* touches absent */ }],
      },
    };
    expect(buildTouchesLeaderboard([match])).toEqual([]);
  });

  it('sums touches across multiple matches for the same player', () => {
    const makeMatch = (matchId: string, touches: number): Match => ({
      id: matchId,
      stage: 'group',
      groupId: 'A',
      homeId: 't1',
      awayId: 't2',
      homeGoals: 1,
      awayGoals: 0,
      kickoff: '2026-06-11T20:00:00Z',
      played: true,
      stats: {
        matchId,
        home: side(),
        away: side(),
        players: [{ playerId: 'p1', touches }],
      },
    });
    const result = buildTouchesLeaderboard([makeMatch('m1', 70), makeMatch('m2', 85)]);
    expect(result[0]).toMatchObject({ playerId: 'p1', totalTouches: 155, matchCount: 2 });
  });

  it('sorts by totalTouches descending', () => {
    const match: Match = {
      ...enrichedMatch('t1', 't2'),
      stats: {
        matchId: 't1-t2',
        home: side(),
        away: side(),
        players: [
          { playerId: 'p1', touches: 50 },
          { playerId: 'p2', touches: 80 },
          { playerId: 'p3', touches: 60 },
        ],
      },
    };
    const result = buildTouchesLeaderboard([match]);
    expect(result.map((e) => e.playerId)).toEqual(['p2', 'p3', 'p1']);
  });

  it('handles a mix of matches with and without player stats', () => {
    const withPlayers: Match = {
      ...enrichedMatch('t1', 't2'),
      stats: {
        matchId: 't1-t2',
        home: side(),
        away: side(),
        players: [{ playerId: 'p1', touches: 90 }],
      },
    };
    const withoutPlayers = enrichedMatch('t1', 't3'); // default helper gives no players
    const result = buildTouchesLeaderboard([withPlayers, withoutPlayers]);
    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('p1');
  });
});
