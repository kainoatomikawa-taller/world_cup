// Derive the full bracket from group orders, third-place qualifiers, and user picks.
//
// Derive-on-read: the store holds only bracketPicks (matchId → winnerId). The
// full BracketSlot tree is computed fresh each time so upstream changes (group
// order edits, third-place rank changes) automatically invalidate stale picks.
import { WINNER_DESTINATION, LOSER_DESTINATION } from '../data/bracketTemplate';
import { seedRound32 } from './bracketSeeding';
import type { BracketSlot, GroupId } from './types';

/**
 * Derive the complete 31-match bracket.
 *
 * 1. Seeds R32 from groupOrder + qualifying third-place groups.
 * 2. Walks matches in ascending matchId order (feeders always before recipients).
 * 3. For each match: applies a valid user pick, then propagates the winner into
 *    the next round's participant slot — and, for the semi-finals, propagates the
 *    loser into the third-place playoff (103).
 *
 * A pick is "valid" only when it matches one of the match's current participants.
 * Stale picks (from a changed upstream) are silently ignored.
 */
export function computeBracket(
  groupOrder: Record<GroupId, string[]>,
  qualifyingThirdGroups: GroupId[],
  picks: Record<number, string>,
): Record<number, BracketSlot> {
  const bracket = seedRound32(groupOrder, qualifyingThirdGroups);

  const matchIds = Object.keys(bracket).map(Number).sort((a, b) => a - b);

  for (const matchId of matchIds) {
    const slot = bracket[matchId];

    if (!slot.locked) {
      const pick = picks[matchId];
      if (pick && (pick === slot.homeId || pick === slot.awayId)) {
        slot.winnerId = pick;
      }
    }

    if (slot.winnerId) {
      const dest = WINNER_DESTINATION[matchId];
      if (dest) {
        const next = bracket[dest.matchId];
        if (dest.side === 'home') next.homeId = slot.winnerId;
        else next.awayId = slot.winnerId;
      }

      // Propagate the loser too (only the semi-finals have a loser destination —
      // the third-place playoff). Requires both participants to be resolved so we
      // know who actually lost.
      const loserDest = LOSER_DESTINATION[matchId];
      if (loserDest && slot.homeId && slot.awayId) {
        const loserId = slot.winnerId === slot.homeId ? slot.awayId : slot.homeId;
        const next = bracket[loserDest.matchId];
        if (loserDest.side === 'home') next.homeId = loserId;
        else next.awayId = loserId;
      }
    }
  }

  return bracket;
}

/** True once all 32 matches (including the third-place playoff) have a winner. */
export function isBracketComplete(bracket: Record<number, BracketSlot>): boolean {
  const slots = Object.values(bracket);
  return slots.length === 32 && slots.every((s) => Boolean(s.winnerId));
}

/** Returns the champion team id, or undefined if the final hasn't been decided. */
export function getChampion(bracket: Record<number, BracketSlot>): string | undefined {
  return bracket[104]?.winnerId;
}

/** Returns the runner-up team id (loser of the final), or undefined if undecided. */
export function getRunnerUp(bracket: Record<number, BracketSlot>): string | undefined {
  const final = bracket[104];
  if (!final?.winnerId || !final.homeId || !final.awayId) return undefined;
  return final.winnerId === final.homeId ? final.awayId : final.homeId;
}

/** Returns the third-place team id, or undefined if the playoff (103) isn't decided. */
export function getThirdPlace(bracket: Record<number, BracketSlot>): string | undefined {
  return bracket[103]?.winnerId;
}
