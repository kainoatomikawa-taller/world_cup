// Pure aggregation functions: per-match enrichment data → tournament-wide totals.
// No React, no network — inputs are domain types from types.ts.
import type { Match, PlayerRating, TeamMatchStats } from './types';

// -----------------------------------------------------------------------
// Team-level aggregation
// -----------------------------------------------------------------------

export interface TournamentTeamStats {
  teamId: string;
  matchesWithStats: number;
  totalShots: number;
  totalShotsOnTarget: number;
  totalPasses: number;
  /** Average possession across matches that had a stats block. Null when none did. */
  avgPossession: number | null;
  /** Average pass-completion % across matches that provided the field. Null when none did. */
  avgPassCompletionPct: number | null;
  totalCorners: number;
  totalFreeKicks: number;
  totalYellowCards: number;
  totalRedCards: number;
}

type TeamAcc = {
  matchesWithStats: number;
  totalShots: number;
  totalShotsOnTarget: number;
  totalPasses: number;
  possessionSum: number;
  passCompletionSum: number;
  passCompletionCount: number;
  totalCorners: number;
  totalFreeKicks: number;
  totalYellowCards: number;
  totalRedCards: number;
};

/**
 * Aggregate per-match TeamMatchStats into tournament-wide totals keyed by teamId.
 * Matches without a stats block or that are unplayed are silently skipped, so
 * partial enrichment never causes errors.
 */
export function aggregateTeamStats(matches: Match[]): Record<string, TournamentTeamStats> {
  const acc: Record<string, TeamAcc> = {};

  const ensure = (teamId: string): TeamAcc => {
    acc[teamId] ??= {
      matchesWithStats: 0,
      totalShots: 0,
      totalShotsOnTarget: 0,
      totalPasses: 0,
      possessionSum: 0,
      passCompletionSum: 0,
      passCompletionCount: 0,
      totalCorners: 0,
      totalFreeKicks: 0,
      totalYellowCards: 0,
      totalRedCards: 0,
    };
    return acc[teamId];
  };

  const addSide = (teamId: string, side: TeamMatchStats) => {
    const a = ensure(teamId);
    a.matchesWithStats++;
    a.totalShots += side.shots;
    a.totalShotsOnTarget += side.shotsOnTarget;
    a.totalPasses += side.passes;
    a.possessionSum += side.possession;
    if (side.passCompletionPct != null) {
      a.passCompletionSum += side.passCompletionPct;
      a.passCompletionCount++;
    }
    a.totalCorners += side.corners;
    a.totalFreeKicks += side.freeKicks;
    a.totalYellowCards += side.yellowCards;
    a.totalRedCards += side.redCards;
  };

  for (const match of matches) {
    if (!match.played || !match.stats) continue;
    addSide(match.homeId, match.stats.home);
    addSide(match.awayId, match.stats.away);
  }

  return Object.fromEntries(
    Object.entries(acc).map(([teamId, a]) => [
      teamId,
      {
        teamId,
        matchesWithStats: a.matchesWithStats,
        totalShots: a.totalShots,
        totalShotsOnTarget: a.totalShotsOnTarget,
        totalPasses: a.totalPasses,
        avgPossession: a.matchesWithStats > 0 ? a.possessionSum / a.matchesWithStats : null,
        avgPassCompletionPct:
          a.passCompletionCount > 0 ? a.passCompletionSum / a.passCompletionCount : null,
        totalCorners: a.totalCorners,
        totalFreeKicks: a.totalFreeKicks,
        totalYellowCards: a.totalYellowCards,
        totalRedCards: a.totalRedCards,
      },
    ]),
  );
}

// -----------------------------------------------------------------------
// Individual player leaderboards
// -----------------------------------------------------------------------

export interface PlayerRatingLeaderboardEntry {
  playerId: string;
  teamId: string;
  avgRating: number;
  matchCount: number;
  source?: string;
}

/**
 * Average per-match PlayerRatings into a sorted leaderboard (highest first).
 * Ratings from different sources are kept as separate entries so a Sofascore
 * and FBref rating for the same player both appear.
 * Pass minMatches to suppress players with too few data points.
 */
export function buildRatingsLeaderboard(
  ratings: PlayerRating[],
  minMatches = 1,
): PlayerRatingLeaderboardEntry[] {
  type RatingAcc = { playerId: string; teamId: string; source?: string; sum: number; count: number };
  const acc: Record<string, RatingAcc> = {};

  for (const r of ratings) {
    const key = r.source ? `${r.playerId}::${r.source}` : r.playerId;
    acc[key] ??= { playerId: r.playerId, teamId: r.teamId, source: r.source, sum: 0, count: 0 };
    acc[key].sum += r.rating;
    acc[key].count++;
  }

  return Object.values(acc)
    .filter((a) => a.count >= minMatches)
    .map((a) => ({
      playerId: a.playerId,
      teamId: a.teamId,
      avgRating: a.sum / a.count,
      matchCount: a.count,
      source: a.source,
    }))
    .sort((x, y) => y.avgRating - x.avgRating);
}

export interface PlayerTouchesLeaderboardEntry {
  playerId: string;
  totalTouches: number;
  matchCount: number;
}

/**
 * Sum touches from MatchStats.players across all played matches, returning a
 * leaderboard sorted by total touches (highest first). Players with no touch
 * data in any match are excluded. Matches missing a stats block or a players
 * array are silently skipped.
 */
export function buildTouchesLeaderboard(matches: Match[]): PlayerTouchesLeaderboardEntry[] {
  const acc: Record<string, { totalTouches: number; matchCount: number }> = {};

  for (const match of matches) {
    if (!match.played || !match.stats?.players) continue;
    for (const p of match.stats.players) {
      if (p.touches == null) continue;
      acc[p.playerId] ??= { totalTouches: 0, matchCount: 0 };
      acc[p.playerId].totalTouches += p.touches;
      acc[p.playerId].matchCount++;
    }
  }

  return Object.entries(acc)
    .map(([playerId, a]) => ({ playerId, ...a }))
    .sort((x, y) => y.totalTouches - x.totalTouches);
}
