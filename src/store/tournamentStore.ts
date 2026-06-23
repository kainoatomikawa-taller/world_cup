// Single source of truth shared across all three screens. Holds live data plus
// the user's picks, and exposes validated actions. Built on Zustand.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GroupId, Match, Team, TournamentState } from '../domain/types';
import { GROUP_IDS } from '../domain/types';

interface TournamentStore extends TournamentState {
  // --- lifecycle ---
  initialize: (teams: Team[], matches: Match[]) => void;
  /** Replace the matches array with fresh live data (does not reset teams or picks). */
  setMatches: (matches: Match[]) => void;

  // --- group stage ---
  initializeGroupOrders: (seedByGroup: Record<GroupId, string[]>) => void;
  setGroupOrder: (groupId: GroupId, orderedTeamIds: string[]) => void;

  // --- third place ---
  rankThirdPlace: (orderedTeamIds: string[]) => void;

  // --- knockout ---
  /** Record a winner pick for a bracket match. */
  setPick: (matchId: number, teamId: string) => void;
  /** Remove a winner pick (e.g. user clicks the current winner to deselect). */
  clearPick: (matchId: number) => void;
}

const emptyGroupOrder = () =>
  Object.fromEntries(GROUP_IDS.map((g) => [g, [] as string[]])) as Record<
    GroupId,
    string[]
  >;

export const useTournamentStore = create<TournamentStore>()(
  persist(
    (set) => ({
      teams: {},
      matches: [],
      groupOrder: emptyGroupOrder(),
      thirdPlaceRanking: [],
      bracketPicks: {},

      initialize: (teams, matches) =>
        set({
          teams: Object.fromEntries(teams.map((t) => [t.id, t])),
          matches,
        }),

      setMatches: (matches) => set({ matches }),

      initializeGroupOrders: (seedByGroup) =>
        set((s) => {
          const updated = { ...s.groupOrder };
          for (const g of GROUP_IDS) {
            if (updated[g].length === 0 && seedByGroup[g]?.length) {
              updated[g] = seedByGroup[g];
            }
          }
          return { groupOrder: updated };
        }),

      setGroupOrder: (groupId, orderedTeamIds) =>
        set((s) => ({
          groupOrder: { ...s.groupOrder, [groupId]: orderedTeamIds },
        })),

      rankThirdPlace: (orderedTeamIds) => set({ thirdPlaceRanking: orderedTeamIds }),

      setPick: (matchId, teamId) =>
        set((s) => ({ bracketPicks: { ...s.bracketPicks, [matchId]: teamId } })),

      clearPick: (matchId) =>
        set((s) => {
          const next = { ...s.bracketPicks };
          delete next[matchId];
          return { bracketPicks: next };
        }),
    }),
    {
      name: 'wc2026-picks',
      storage: createJSONStorage(() => localStorage),
      // Only persist user picks — teams and matches come from static data / the API.
      partialize: (state) => ({
        groupOrder: state.groupOrder,
        thirdPlaceRanking: state.thirdPlaceRanking,
        bracketPicks: state.bracketPicks,
      }),
    },
  ),
);
