// Compute group standings from match results, applying FIFA tiebreakers.
import type { GroupId, GroupPosition, Match, Standing, Team } from './types';
import { GROUP_IDS } from './types';
import { sortByTiebreakers } from './tiebreakers';

/**
 * Build the standings table for a single group from its played matches.
 * Unplayed matches (or matches missing a score) are ignored. Final ordering is
 * resolved by `sortByTiebreakers`, and each row's `position` is set accordingly.
 */
export function computeGroupStandings(
  groupId: GroupId,
  teams: Team[],
  matches: Match[],
): Standing[] {
  const rows: Record<string, Standing> = {};
  for (const team of teams) {
    if (team.groupId !== groupId) continue;
    rows[team.id] = {
      teamId: team.id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      position: 1,
    };
  }

  for (const m of matches) {
    if (m.groupId !== groupId || !m.played) continue;
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const home = rows[m.homeId];
    const away = rows[m.awayId];
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.goalsFor += m.homeGoals;
    home.goalsAgainst += m.awayGoals;
    away.goalsFor += m.awayGoals;
    away.goalsAgainst += m.homeGoals;

    if (m.homeGoals > m.awayGoals) {
      home.won++;
      away.lost++;
      home.points += 3;
    } else if (m.homeGoals < m.awayGoals) {
      away.won++;
      home.lost++;
      away.points += 3;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }

  for (const row of Object.values(rows)) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  const ordered = sortByTiebreakers(Object.values(rows), matches);
  return ordered.map((row, idx) => ({
    ...row,
    position: (idx + 1) as GroupPosition,
  }));
}

/** Standings for every group, keyed by group id. */
export function computeAllStandings(
  teams: Record<string, Team>,
  matches: Match[],
): Record<GroupId, Standing[]> {
  const all = Object.values(teams);
  return Object.fromEntries(
    GROUP_IDS.map((g) => [g, computeGroupStandings(g, all, matches)]),
  ) as Record<GroupId, Standing[]>;
}

// Re-exported so callers can find the tiebreaker entry point alongside standings.
export { sortByTiebreakers };
