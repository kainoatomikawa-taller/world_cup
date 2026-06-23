// Derives the 12 third-place candidates from the user's group choices, ranks
// them by FIFA criteria, and reconciles the store's thirdPlaceRanking when the
// user changes a group's 3rd-placed team.
import { useEffect, useMemo } from 'react';
import { GROUP_IDS } from '../../domain/types';
import { computeAllStandings } from '../../domain/standings';
import {
  buildThirdPlaceEntries,
  rankThirdPlaceEntries,
  type ThirdPlaceEntry,
} from '../../domain/thirdPlace';
import { isGroupComplete } from '../../domain/elimination';
import { useTournamentStore } from '../../store/tournamentStore';

export interface ThirdPlaceData {
  // Entries in the user's current ranking order (index 0 = best).
  rankedEntries: ThirdPlaceEntry[];
  // True when all 12 groups have been fully played — list is locked.
  allGroupsComplete: boolean;
}

export function useThirdPlaceData(): ThirdPlaceData {
  const teams = useTournamentStore((s) => s.teams);
  const matches = useTournamentStore((s) => s.matches);
  const groupOrder = useTournamentStore((s) => s.groupOrder);
  const thirdPlaceRanking = useTournamentStore((s) => s.thirdPlaceRanking);
  const rankThirdPlace = useTournamentStore((s) => s.rankThirdPlace);

  const teamList = useMemo(() => Object.values(teams), [teams]);

  const standingsByGroup = useMemo(
    () => computeAllStandings(teams, matches),
    [teams, matches],
  );

  // The 12 current third-place candidates, built from groupOrder.
  const defaultEntries = useMemo(
    () => rankThirdPlaceEntries(buildThirdPlaceEntries(groupOrder, standingsByGroup)),
    [groupOrder, standingsByGroup],
  );

  const allGroupsComplete = useMemo(
    () => teamList.length > 0 && GROUP_IDS.every((g) => isGroupComplete(g, matches)),
    [teamList, matches],
  );

  // Reconcile thirdPlaceRanking whenever the set of 3rd-place candidates changes.
  // - Keep teams still in 3rd in their existing order.
  // - Append newly-3rd teams at their default-ranked position.
  // - Drop teams that are no longer 3rd.
  useEffect(() => {
    const currentIds = new Set(defaultEntries.map((e) => e.teamId));
    const existingOrder = thirdPlaceRanking.filter((id) => currentIds.has(id));
    const existingSet = new Set(existingOrder);
    // New teams not yet in the user's ranking, inserted in default order.
    const newEntries = defaultEntries
      .filter((e) => !existingSet.has(e.teamId))
      .map((e) => e.teamId);

    // Merge: interleave new entries at their default positions.
    const merged: string[] = [];
    let newIdx = 0;
    let existingIdx = 0;
    for (const defaultEntry of defaultEntries) {
      if (existingSet.has(defaultEntry.teamId)) {
        merged.push(existingOrder[existingIdx++]);
      } else {
        merged.push(newEntries[newIdx++]);
      }
    }

    const changed =
      merged.length !== thirdPlaceRanking.length ||
      merged.some((id, i) => id !== thirdPlaceRanking[i]);
    if (changed) rankThirdPlace(merged);
  }, [defaultEntries, thirdPlaceRanking, rankThirdPlace]);

  // Build rankedEntries in the user's chosen order.
  const entryById = useMemo(
    () => Object.fromEntries(defaultEntries.map((e) => [e.teamId, e])),
    [defaultEntries],
  );

  const rankedEntries = useMemo(
    () => thirdPlaceRanking.map((id) => entryById[id]).filter(Boolean) as ThirdPlaceEntry[],
    [thirdPlaceRanking, entryById],
  );

  return { rankedEntries, allGroupsComplete };
}
