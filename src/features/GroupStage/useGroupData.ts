// Memoized selector that feeds the GroupStage screen all per-group data it needs
// without re-running the rules engine on every render.
import { useMemo } from 'react';
import { computeGroupStandings } from '../../domain/standings';
import { computePlacementPossibilities, isGroupComplete } from '../../domain/elimination';
import type { GroupId, PlacementPossibility, Standing } from '../../domain/types';
import { GROUP_IDS } from '../../domain/types';
import { useTournamentStore } from '../../store/tournamentStore';

export interface GroupData {
  standings: Standing[];
  possibilities: PlacementPossibility[];
  complete: boolean;
}

export function useGroupData(): Record<GroupId, GroupData> {
  const teams = useTournamentStore((s) => s.teams);
  const matches = useTournamentStore((s) => s.matches);
  const teamList = useMemo(() => Object.values(teams), [teams]);

  return useMemo(() => {
    return Object.fromEntries(
      GROUP_IDS.map((g) => {
        const standings = computeGroupStandings(g, teamList, matches);
        const possibilities = computePlacementPossibilities(g, teamList, matches, standings);
        const complete = isGroupComplete(g, matches);
        return [g, { standings, possibilities, complete }];
      }),
    ) as Record<GroupId, GroupData>;
  }, [teamList, matches]);
}
