import { describe, it, expect } from 'vitest';
import { BRACKET_TEMPLATE, WINNER_DESTINATION, LOSER_DESTINATION } from './bracketTemplate';
import { THIRD_PLACE_MATCH_IDS } from './assignmentTable';

const R32 = BRACKET_TEMPLATE.filter((m) => m.stage === 'round32');
const R16 = BRACKET_TEMPLATE.filter((m) => m.stage === 'round16');
const QF  = BRACKET_TEMPLATE.filter((m) => m.stage === 'quarter');
const SF  = BRACKET_TEMPLATE.filter((m) => m.stage === 'semi');
const TP  = BRACKET_TEMPLATE.filter((m) => m.stage === 'thirdPlacePlayoff');
const F   = BRACKET_TEMPLATE.filter((m) => m.stage === 'final');

describe('BRACKET_TEMPLATE structure', () => {
  it('has 32 matches total (16+8+4+2+1+1)', () => {
    expect(BRACKET_TEMPLATE).toHaveLength(32);
    expect(R32).toHaveLength(16);
    expect(R16).toHaveLength(8);
    expect(QF).toHaveLength(4);
    expect(SF).toHaveLength(2);
    expect(TP).toHaveLength(1);
    expect(F).toHaveLength(1);
  });

  it('third-place playoff (103) is contested by the two semi-final losers', () => {
    const byId = Object.fromEntries(BRACKET_TEMPLATE.map((m) => [m.matchId, m]));
    expect(byId[103].stage).toBe('thirdPlacePlayoff');
    expect(byId[103].home).toEqual({ kind: 'matchLoser', matchId: 101 });
    expect(byId[103].away).toEqual({ kind: 'matchLoser', matchId: 102 });
  });

  it('covers matches 73–88 in R32 with no gaps', () => {
    const ids = R32.map((m) => m.matchId).sort((a, b) => a - b);
    expect(ids).toEqual([73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88]);
  });

  it('has exactly 8 thirdPlace sources matching THIRD_PLACE_MATCH_IDS', () => {
    const thirdSources = BRACKET_TEMPLATE.flatMap((m) =>
      [m.home, m.away].filter((s) => s.kind === 'thirdPlace'),
    );
    expect(thirdSources).toHaveLength(8);
    const matchIds = thirdSources
      .map((s) => (s.kind === 'thirdPlace' ? s.matchId : -1))
      .sort((a, b) => a - b);
    expect(matchIds).toEqual([...THIRD_PLACE_MATCH_IDS].sort((a, b) => a - b));
  });

  it('every matchWinner source points to an existing matchId', () => {
    const allIds = new Set(BRACKET_TEMPLATE.map((m) => m.matchId));
    for (const m of BRACKET_TEMPLATE) {
      for (const src of [m.home, m.away]) {
        if (src.kind === 'matchWinner') {
          expect(allIds.has(src.matchId), `matchWinner(${src.matchId}) not found`).toBe(true);
        }
      }
    }
  });

  it('each R16+ match has exactly two matchWinner sources', () => {
    for (const m of [...R16, ...QF, ...SF, ...F]) {
      expect(m.home.kind).toBe('matchWinner');
      expect(m.away.kind).toBe('matchWinner');
    }
  });

  it('specific R32 matchups are correct', () => {
    const byId = Object.fromEntries(BRACKET_TEMPLATE.map((m) => [m.matchId, m]));
    expect(byId[73].home).toEqual({ kind: 'runnerUp', group: 'A' });
    expect(byId[73].away).toEqual({ kind: 'runnerUp', group: 'B' });
    expect(byId[74].home).toEqual({ kind: 'winner', group: 'E' });
    expect(byId[74].away).toEqual({ kind: 'thirdPlace', matchId: 74 });
    expect(byId[75].home).toEqual({ kind: 'winner', group: 'F' });
    expect(byId[75].away).toEqual({ kind: 'runnerUp', group: 'C' });
    expect(byId[88].home).toEqual({ kind: 'runnerUp', group: 'D' });
    expect(byId[88].away).toEqual({ kind: 'runnerUp', group: 'G' });
  });
});

describe('WINNER_DESTINATION', () => {
  it('has an entry for all 32 matches', () => {
    const allIds = BRACKET_TEMPLATE.map((m) => m.matchId);
    for (const id of allIds) {
      expect(id in WINNER_DESTINATION, `${id} missing from WINNER_DESTINATION`).toBe(true);
    }
  });

  it('final (104) and third-place playoff (103) map to null', () => {
    expect(WINNER_DESTINATION[104]).toBeNull();
    expect(WINNER_DESTINATION[103]).toBeNull();
  });

  it('every other match maps to a valid next matchId', () => {
    const allIds = new Set(BRACKET_TEMPLATE.map((m) => m.matchId));
    for (const [id, dest] of Object.entries(WINNER_DESTINATION)) {
      if (Number(id) === 104 || Number(id) === 103) continue;
      expect(dest).not.toBeNull();
      expect(allIds.has(dest!.matchId)).toBe(true);
    }
  });

  it('R32 winners feed the correct R16 matches', () => {
    // 89 = W74/W77, 90 = W73/W75
    expect(WINNER_DESTINATION[74]).toEqual({ matchId: 89, side: 'home' });
    expect(WINNER_DESTINATION[77]).toEqual({ matchId: 89, side: 'away' });
    expect(WINNER_DESTINATION[73]).toEqual({ matchId: 90, side: 'home' });
    expect(WINNER_DESTINATION[75]).toEqual({ matchId: 90, side: 'away' });
  });
});

describe('LOSER_DESTINATION', () => {
  it('only the two semi-finals feed losers, into the third-place playoff', () => {
    expect(LOSER_DESTINATION).toEqual({
      101: { matchId: 103, side: 'home' },
      102: { matchId: 103, side: 'away' },
    });
  });
});
