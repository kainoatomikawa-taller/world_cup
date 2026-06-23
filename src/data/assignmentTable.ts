// Assigns the 8 qualifying third-place teams to their Round-of-32 slots.
//
// Eight R32 matches contain a third-place team. Each such slot has a fixed list
// of 5 eligible groups (published by FIFA). Exactly one group's third-place team
// fills each slot, and the overall assignment depends on WHICH 8 of the 12
// groups produced a qualifying third-place finisher.
//
// FIFA publishes a literal 495-row lookup table for this. We instead compute a
// valid assignment by treating it as a bipartite matching (groups → slots) over
// the eligible lists, resolved deterministically. This always yields a valid
// bracket. In the ~210 combinations where two groups share an identical eligible
// set (notably E and I), the exact slot may differ from FIFA's official table;
// the literal table can be dropped in behind this same function later.
import type { GroupId } from '../domain/types';

export interface ThirdPlaceSlot {
  /** The Round-of-32 match this third-place team plays in. */
  matchId: number;
  /** Groups whose third-place team is eligible to fill this slot. */
  eligibleGroups: GroupId[];
}

export const THIRD_PLACE_SLOTS: ThirdPlaceSlot[] = [
  { matchId: 74, eligibleGroups: ['A', 'B', 'C', 'D', 'F'] },
  { matchId: 77, eligibleGroups: ['C', 'D', 'F', 'G', 'H'] },
  { matchId: 79, eligibleGroups: ['C', 'E', 'F', 'H', 'I'] },
  { matchId: 80, eligibleGroups: ['E', 'H', 'I', 'J', 'K'] },
  { matchId: 81, eligibleGroups: ['B', 'E', 'F', 'I', 'J'] },
  { matchId: 82, eligibleGroups: ['A', 'E', 'H', 'I', 'J'] },
  { matchId: 85, eligibleGroups: ['E', 'F', 'G', 'I', 'J'] },
  { matchId: 87, eligibleGroups: ['D', 'E', 'I', 'J', 'L'] },
];

/** The R32 match numbers that host a third-place team. */
export const THIRD_PLACE_MATCH_IDS: number[] = THIRD_PLACE_SLOTS.map((s) => s.matchId);

/**
 * Assign the 8 qualifying third-place groups to their R32 slots.
 *
 * Returns a map of match id → the group whose third-place team plays there.
 * Throws if not exactly 8 groups are given, or (should never happen) no valid
 * matching exists.
 *
 * Deterministic: slots are filled in match-id order, trying eligible groups in
 * alphabetical order, with backtracking to guarantee a complete matching.
 */
export function assignThirdPlace(qualifyingGroups: GroupId[]): Record<number, GroupId> {
  if (qualifyingGroups.length !== 8) {
    throw new Error(
      `assignThirdPlace expects exactly 8 groups, got ${qualifyingGroups.length}`,
    );
  }

  const groups = [...qualifyingGroups].sort();
  const assignment: Record<number, GroupId> = {};
  const used = new Set<GroupId>();

  function backtrack(slotIdx: number): boolean {
    if (slotIdx === THIRD_PLACE_SLOTS.length) return true;
    const slot = THIRD_PLACE_SLOTS[slotIdx];
    for (const g of groups) {
      if (used.has(g)) continue;
      if (!slot.eligibleGroups.includes(g)) continue;
      assignment[slot.matchId] = g;
      used.add(g);
      if (backtrack(slotIdx + 1)) return true;
      used.delete(g);
      delete assignment[slot.matchId];
    }
    return false;
  }

  if (!backtrack(0)) {
    throw new Error(
      `No valid third-place assignment for groups: ${qualifyingGroups.join(', ')}`,
    );
  }
  return assignment;
}
