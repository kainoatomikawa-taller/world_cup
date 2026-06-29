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
  hasUserPicks: boolean;
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

  // First pass: seed the bracket without any picks to get stable team assignments.
  // This gives us (homeId, awayId) for every slot before user picks influence propagation.
  const seededBracket = useMemo(
    () => computeBracket(groupOrder, qualifyingThirdGroups, {}),
    [groupOrder, qualifyingThirdGroups],
  );

  // Derive winners from played knockout fixtures, keyed by bracket matchId.
  // Knockout games always produce a winner (extra time / pens included in goals).
  const realPicks = useMemo(() => {
    const result: Record<number, string> = {};
    const playedKnockout = matches.filter((m) => m.stage !== 'group' && m.played);
    if (playedKnockout.length === 0) return result;

    for (const [idStr, slot] of Object.entries(seededBracket)) {
      if (!slot.homeId || !slot.awayId) continue;
      const matchId = Number(idStr);

      const fixture = playedKnockout.find(
        (m) =>
          (m.homeId === slot.homeId && m.awayId === slot.awayId) ||
          (m.homeId === slot.awayId && m.awayId === slot.homeId),
      );

      if (fixture?.homeGoals == null || fixture.awayGoals == null) continue;
      if (fixture.homeGoals === fixture.awayGoals) continue; // penalty result not in goals

      result[matchId] =
        fixture.homeGoals > fixture.awayGoals ? fixture.homeId : fixture.awayId;
    }
    return result;
  }, [seededBracket, matches]);

  // Final bracket: real results override user picks and those slots are locked.
  const bracket = useMemo(() => {
    const effectivePicks = { ...bracketPicks, ...realPicks };
    const b = computeBracket(groupOrder, qualifyingThirdGroups, effectivePicks);
    for (const matchId of Object.keys(realPicks).map(Number)) {
      if (b[matchId]) b[matchId].locked = true;
    }
    return b;
  }, [groupOrder, qualifyingThirdGroups, bracketPicks, realPicks]);

  // True when the user has made at least one pick beyond locked real results.
  const hasUserPicks = Object.keys(bracketPicks).some(
    (id) => !realPicks[Number(id)],
  );

  return { bracket, teams, setPick, clearPick, hasUserPicks };
}
