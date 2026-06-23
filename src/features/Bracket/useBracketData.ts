// Derives the full bracket from store state. The bracket recomputes automatically
// whenever group orders, third-place ranking, or bracket picks change.
import { useMemo } from 'react';
import { useTournamentStore } from '../../store/tournamentStore';
import { computeBracket } from '../../domain/knockout';
import {
  buildThirdPlaceEntries,
  rankThirdPlaceEntries,
} from '../../domain/thirdPlace';
import { computeAllStandings } from '../../domain/standings';
import { GROUP_IDS } from '../../domain/types';
import type { BracketSlot, GroupId, Team } from '../../domain/types';

export interface BracketData {
  bracket: Record<number, BracketSlot>;
  teams: Record<string, Team>;
  setPick: (matchId: number, teamId: string) => void;
  clearPick: (matchId: number) => void;
}

export function useBracketData(): BracketData {
  const teams = useTournamentStore((s) => s.teams);
  const matches = useTournamentStore((s) => s.matches);
  const groupOrder = useTournamentStore((s) => s.groupOrder);
  const thirdPlaceRanking = useTournamentStore((s) => s.thirdPlaceRanking);
  const bracketPicks = useTournamentStore((s) => s.bracketPicks);
  const setPick = useTournamentStore((s) => s.setPick);
  const clearPick = useTournamentStore((s) => s.clearPick);

  const standingsByGroup = useMemo(
    () => computeAllStandings(teams, matches),
    [teams, matches],
  );

  // Reverse map: 3rd-place team id → its group (derived from groupOrder).
  const thirdTeamToGroup = useMemo((): Record<string, GroupId> =>
    Object.fromEntries(
      GROUP_IDS
        .map((g): [string, GroupId] | null => {
          const id = groupOrder[g]?.[2];
          return id ? [id, g] : null;
        })
        .filter((x): x is [string, GroupId] => x !== null),
    ), [groupOrder]);

  // Derive the 8 qualifying third-place groups in the user's chosen order.
  // Falls back to default FIFA ranking if the third-place screen hasn't been visited.
  const qualifyingThirdGroups = useMemo((): GroupId[] => {
    const ranking =
      thirdPlaceRanking.length >= 8
        ? thirdPlaceRanking
        : rankThirdPlaceEntries(
            buildThirdPlaceEntries(groupOrder, standingsByGroup),
          ).map((e) => e.teamId);

    const groups = ranking
      .slice(0, 8)
      .map((id) => thirdTeamToGroup[id])
      .filter((g): g is GroupId => g !== undefined);

    return groups.length === 8 ? groups : [];
  }, [thirdPlaceRanking, thirdTeamToGroup, groupOrder, standingsByGroup]);

  const bracket = useMemo(
    () => computeBracket(groupOrder, qualifyingThirdGroups, bracketPicks),
    [groupOrder, qualifyingThirdGroups, bracketPicks],
  );

  return { bracket, teams, setPick, clearPick };
}
