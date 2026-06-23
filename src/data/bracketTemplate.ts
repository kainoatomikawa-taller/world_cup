// Fixed bracket structure for the 2026 FIFA World Cup knockout stage.
// Encodes exactly which group positions (winner, runner-up, third-place) or
// prior match winners/losers fill each of the 32 slots (73–104). Match 103 is
// the third-place playoff, contested by the two semi-final losers.
//
// Source: en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage
import type { GroupId, Stage } from '../domain/types';

export type ParticipantSource =
  | { kind: 'winner'; group: GroupId }
  | { kind: 'runnerUp'; group: GroupId }
  | { kind: 'thirdPlace'; matchId: number }   // group resolved via assignThirdPlace
  | { kind: 'matchWinner'; matchId: number }
  | { kind: 'matchLoser'; matchId: number };

export interface BracketMatchTemplate {
  matchId: number;
  stage: Stage;
  home: ParticipantSource;
  away: ParticipantSource;
}

export const BRACKET_TEMPLATE: BracketMatchTemplate[] = [
  // Round of 32
  { matchId: 73, stage: 'round32', home: { kind: 'runnerUp', group: 'A' }, away: { kind: 'runnerUp', group: 'B' } },
  { matchId: 74, stage: 'round32', home: { kind: 'winner',   group: 'E' }, away: { kind: 'thirdPlace', matchId: 74 } },
  { matchId: 75, stage: 'round32', home: { kind: 'winner',   group: 'F' }, away: { kind: 'runnerUp',  group: 'C' } },
  { matchId: 76, stage: 'round32', home: { kind: 'winner',   group: 'C' }, away: { kind: 'runnerUp',  group: 'F' } },
  { matchId: 77, stage: 'round32', home: { kind: 'winner',   group: 'I' }, away: { kind: 'thirdPlace', matchId: 77 } },
  { matchId: 78, stage: 'round32', home: { kind: 'runnerUp', group: 'E' }, away: { kind: 'runnerUp',  group: 'I' } },
  { matchId: 79, stage: 'round32', home: { kind: 'winner',   group: 'A' }, away: { kind: 'thirdPlace', matchId: 79 } },
  { matchId: 80, stage: 'round32', home: { kind: 'winner',   group: 'L' }, away: { kind: 'thirdPlace', matchId: 80 } },
  { matchId: 81, stage: 'round32', home: { kind: 'winner',   group: 'D' }, away: { kind: 'thirdPlace', matchId: 81 } },
  { matchId: 82, stage: 'round32', home: { kind: 'winner',   group: 'G' }, away: { kind: 'thirdPlace', matchId: 82 } },
  { matchId: 83, stage: 'round32', home: { kind: 'runnerUp', group: 'K' }, away: { kind: 'runnerUp',  group: 'L' } },
  { matchId: 84, stage: 'round32', home: { kind: 'winner',   group: 'H' }, away: { kind: 'runnerUp',  group: 'J' } },
  { matchId: 85, stage: 'round32', home: { kind: 'winner',   group: 'B' }, away: { kind: 'thirdPlace', matchId: 85 } },
  { matchId: 86, stage: 'round32', home: { kind: 'winner',   group: 'J' }, away: { kind: 'runnerUp',  group: 'H' } },
  { matchId: 87, stage: 'round32', home: { kind: 'winner',   group: 'K' }, away: { kind: 'thirdPlace', matchId: 87 } },
  { matchId: 88, stage: 'round32', home: { kind: 'runnerUp', group: 'D' }, away: { kind: 'runnerUp',  group: 'G' } },
  // Round of 16
  { matchId: 89, stage: 'round16', home: { kind: 'matchWinner', matchId: 74 }, away: { kind: 'matchWinner', matchId: 77 } },
  { matchId: 90, stage: 'round16', home: { kind: 'matchWinner', matchId: 73 }, away: { kind: 'matchWinner', matchId: 75 } },
  { matchId: 91, stage: 'round16', home: { kind: 'matchWinner', matchId: 76 }, away: { kind: 'matchWinner', matchId: 78 } },
  { matchId: 92, stage: 'round16', home: { kind: 'matchWinner', matchId: 79 }, away: { kind: 'matchWinner', matchId: 80 } },
  { matchId: 93, stage: 'round16', home: { kind: 'matchWinner', matchId: 83 }, away: { kind: 'matchWinner', matchId: 84 } },
  { matchId: 94, stage: 'round16', home: { kind: 'matchWinner', matchId: 81 }, away: { kind: 'matchWinner', matchId: 82 } },
  { matchId: 95, stage: 'round16', home: { kind: 'matchWinner', matchId: 86 }, away: { kind: 'matchWinner', matchId: 88 } },
  { matchId: 96, stage: 'round16', home: { kind: 'matchWinner', matchId: 85 }, away: { kind: 'matchWinner', matchId: 87 } },
  // Quarter-finals
  { matchId: 97,  stage: 'quarter', home: { kind: 'matchWinner', matchId: 89 }, away: { kind: 'matchWinner', matchId: 90 } },
  { matchId: 98,  stage: 'quarter', home: { kind: 'matchWinner', matchId: 93 }, away: { kind: 'matchWinner', matchId: 94 } },
  { matchId: 99,  stage: 'quarter', home: { kind: 'matchWinner', matchId: 91 }, away: { kind: 'matchWinner', matchId: 92 } },
  { matchId: 100, stage: 'quarter', home: { kind: 'matchWinner', matchId: 95 }, away: { kind: 'matchWinner', matchId: 96 } },
  // Semi-finals
  { matchId: 101, stage: 'semi', home: { kind: 'matchWinner', matchId: 97  }, away: { kind: 'matchWinner', matchId: 98  } },
  { matchId: 102, stage: 'semi', home: { kind: 'matchWinner', matchId: 99  }, away: { kind: 'matchWinner', matchId: 100 } },
  // Third-place playoff — the two semi-final losers.
  { matchId: 103, stage: 'thirdPlacePlayoff', home: { kind: 'matchLoser', matchId: 101 }, away: { kind: 'matchLoser', matchId: 102 } },
  // Final
  { matchId: 104, stage: 'final', home: { kind: 'matchWinner', matchId: 101 }, away: { kind: 'matchWinner', matchId: 102 } },
];

/**
 * For each match, where does its winner feed as a participant in the next round?
 * Derived from BRACKET_TEMPLATE — every matchWinner source maps back to here.
 * The final (104) and the third-place playoff (103) map to null — their winners
 * feed no further match (champion / bronze).
 */
export const WINNER_DESTINATION: Record<number, { matchId: number; side: 'home' | 'away' } | null> =
  Object.fromEntries([
    ...BRACKET_TEMPLATE.flatMap((m): [number, { matchId: number; side: 'home' | 'away' }][] => {
      const entries: [number, { matchId: number; side: 'home' | 'away' }][] = [];
      if (m.home.kind === 'matchWinner') entries.push([m.home.matchId, { matchId: m.matchId, side: 'home' }]);
      if (m.away.kind === 'matchWinner') entries.push([m.away.matchId, { matchId: m.matchId, side: 'away' }]);
      return entries;
    }),
    [103, null] as [number, null],
    [104, null] as [number, null],
  ]);

/**
 * For each match, where does its loser feed? Mirrors WINNER_DESTINATION but for
 * matchLoser sources — currently only the two semi-finals (101, 102), whose
 * losers contest the third-place playoff (103).
 */
export const LOSER_DESTINATION: Record<number, { matchId: number; side: 'home' | 'away' }> =
  Object.fromEntries(
    BRACKET_TEMPLATE.flatMap((m): [number, { matchId: number; side: 'home' | 'away' }][] => {
      const entries: [number, { matchId: number; side: 'home' | 'away' }][] = [];
      if (m.home.kind === 'matchLoser') entries.push([m.home.matchId, { matchId: m.matchId, side: 'home' }]);
      if (m.away.kind === 'matchLoser') entries.push([m.away.matchId, { matchId: m.matchId, side: 'away' }]);
      return entries;
    }),
  );
