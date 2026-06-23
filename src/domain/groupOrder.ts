// Validation helpers for user-chosen group orderings.
import type { PlacementPossibility } from './types';

const CAN_FINISH: Record<number, keyof PlacementPossibility> = {
  1: 'canFinish1st',
  2: 'canFinish2nd',
  3: 'canFinish3rd',
  4: 'canFinish4th',
};

export interface IllegalPlacement {
  teamId: string;
  attemptedPosition: number;
}

/**
 * Check whether a proposed group ordering is legal given current possibilities.
 * `orderedIds` is an array of 4 team ids, index 0 = 1st place.
 * Returns the first illegal placement found, or null if the order is valid.
 */
export function firstIllegalPlacement(
  orderedIds: string[],
  possibilities: PlacementPossibility[],
): IllegalPlacement | null {
  const byId = Object.fromEntries(possibilities.map((p) => [p.teamId, p]));
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const pos = i + 1;
    const p = byId[id];
    if (!p) continue;
    const key = CAN_FINISH[pos];
    if (key && !p[key]) return { teamId: id, attemptedPosition: pos };
  }
  return null;
}

/** True when every team in the proposed order can reach its assigned position. */
export function isLegalGroupOrder(
  orderedIds: string[],
  possibilities: PlacementPossibility[],
): boolean {
  return firstIllegalPlacement(orderedIds, possibilities) === null;
}
