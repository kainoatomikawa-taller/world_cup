// Seed the Round-of-32 (and create empty shells for later rounds) from the
// user's group ordering and the qualifying third-place groups.
import { assignThirdPlace } from '../data/assignmentTable';
import { BRACKET_TEMPLATE, type ParticipantSource } from '../data/bracketTemplate';
import type { BracketSlot, GroupId } from './types';

function resolveSource(
  src: ParticipantSource,
  groupOrder: Record<GroupId, string[]>,
  thirdAssign: Record<number, GroupId>,
): string | undefined {
  switch (src.kind) {
    case 'winner':    return groupOrder[src.group]?.[0];
    case 'runnerUp':  return groupOrder[src.group]?.[1];
    case 'thirdPlace': {
      const g = thirdAssign[src.matchId];
      return g !== undefined ? groupOrder[g]?.[2] : undefined;
    }
    case 'matchWinner': return undefined; // filled in by computeBracket
    case 'matchLoser':  return undefined; // filled in by computeBracket
  }
}

/**
 * Build the initial bracket skeleton.
 *
 * R32 slots have both participants resolved from the group order and third-place
 * assignment. R16+ slots are created with no participants — computeBracket fills
 * those in as winners propagate.
 *
 * If fewer than 8 groups qualify (third-place ranking not yet complete), third-place
 * participant slots remain undefined rather than throwing.
 */
export function seedRound32(
  groupOrder: Record<GroupId, string[]>,
  qualifyingThirdGroups: GroupId[],
): Record<number, BracketSlot> {
  const thirdAssign: Record<number, GroupId> =
    qualifyingThirdGroups.length === 8 ? assignThirdPlace(qualifyingThirdGroups) : {};

  const bracket: Record<number, BracketSlot> = {};

  for (const tmpl of BRACKET_TEMPLATE) {
    if (tmpl.stage !== 'round32') {
      bracket[tmpl.matchId] = { matchId: tmpl.matchId, stage: tmpl.stage, locked: false };
    } else {
      bracket[tmpl.matchId] = {
        matchId: tmpl.matchId,
        stage: tmpl.stage,
        homeId: resolveSource(tmpl.home, groupOrder, thirdAssign),
        awayId: resolveSource(tmpl.away, groupOrder, thirdAssign),
        locked: false,
      };
    }
  }

  return bracket;
}
