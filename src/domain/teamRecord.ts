// Pure derivations over the match list already in the store.
// No React, no network — inputs are domain types from types.ts.
import type { GroupId, Match, Stage } from './types';

// ---------------------------------------------------------------------------
// Team W/D/L record
// ---------------------------------------------------------------------------

export interface TeamRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * Tallies each team's W-D-L record across all played matches regardless of stage.
 *
 * Penalty-decided knockout matches: only the regulation/extra-time scoreline is
 * available in Match (homeGoals / awayGoals). When those are equal the match is
 * recorded as a draw for both sides — the penalty winner is not modelled here
 * because Match carries no penalty-score field.
 *
 * Matches that are unplayed, or where either goal tally is null, are skipped.
 */
export function computeTeamRecords(matches: Match[]): Record<string, TeamRecord> {
  const records: Record<string, TeamRecord> = {};

  const ensure = (teamId: string): TeamRecord => {
    records[teamId] ??= { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
    return records[teamId];
  };

  for (const m of matches) {
    if (!m.played) continue;
    if (m.homeGoals == null || m.awayGoals == null) continue;

    const home = ensure(m.homeId);
    const away = ensure(m.awayId);

    home.played++;
    away.played++;
    home.goalsFor += m.homeGoals;
    home.goalsAgainst += m.awayGoals;
    away.goalsFor += m.awayGoals;
    away.goalsAgainst += m.homeGoals;

    if (m.homeGoals > m.awayGoals) {
      home.won++;
      away.lost++;
    } else if (m.homeGoals < m.awayGoals) {
      away.won++;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Stage display label
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<Stage, string> = {
  group:             'Group Stage',
  round32:           'Round of 32',
  round16:           'Round of 16',
  quarter:           'Quarter-finals',
  semi:              'Semi-finals',
  thirdPlacePlayoff: 'Third-Place Play-off',
  final:             'Final',
};

/**
 * Human-readable label for a match stage.
 * Group matches include the group letter when groupId is provided ("Group A");
 * without one, returns the generic "Group Stage" fallback.
 */
export function stageLabel(stage: Stage, groupId?: GroupId): string {
  if (stage === 'group') {
    return groupId ? `Group ${groupId}` : 'Group Stage';
  }
  return STAGE_LABELS[stage];
}
