import { describe, it, expect } from 'vitest';
import {
  buildThirdPlaceEntries,
  rankThirdPlaceEntries,
  qualifyingThirdPlace,
  qualifyingThirdPlaceGroups,
  achievablePointRange,
  canRankAbove,
  firstIllegalThirdPlaceRank,
  isLegalThirdPlaceRanking,
  type ThirdPlaceEntry,
} from './thirdPlace';
import type { GroupId, Match, Standing } from './types';
import { GROUP_IDS } from './types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeGroupOrder(thirdTeamByGroup: Partial<Record<GroupId, string>>): Record<GroupId, string[]> {
  return Object.fromEntries(
    GROUP_IDS.map((g) => {
      const third = thirdTeamByGroup[g] ?? `${g}-default-3rd`;
      return [g, [`${g}-1st`, `${g}-2nd`, third, `${g}-4th`]];
    }),
  ) as Record<GroupId, string[]>;
}

function makeStanding(teamId: string, pts: number, gd: number, gf: number): Standing {
  return {
    teamId,
    played: 3,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: gf,
    goalsAgainst: gf - gd,
    goalDifference: gd,
    points: pts,
    position: 3,
  };
}

function makeEntry(
  teamId: string,
  groupId: GroupId,
  pts: number,
  gd = 0,
  gf = 0,
): ThirdPlaceEntry {
  return { teamId, groupId, points: pts, goalDifference: gd, goalsFor: gf };
}

/** Creates a group-stage match (unplayed by default). */
function makeMatch(
  id: string,
  groupId: GroupId,
  homeId: string,
  awayId: string,
  played = false,
): Match {
  return { id, stage: 'group', groupId, homeId, awayId, kickoff: '2026-06-01T00:00:00Z', played };
}

// ---------------------------------------------------------------------------
// buildThirdPlaceEntries
// ---------------------------------------------------------------------------

describe('buildThirdPlaceEntries', () => {
  it('extracts one entry per group at index 2 of groupOrder', () => {
    const groupOrder = makeGroupOrder({ A: 'arg', B: 'bra' });
    const standings = Object.fromEntries(
      GROUP_IDS.map((g) => [g, [] as Standing[]]),
    ) as Record<GroupId, Standing[]>;
    standings.A = [
      makeStanding('A-1st', 9, 5, 6),
      makeStanding('A-2nd', 6, 2, 4),
      makeStanding('arg', 3, -1, 2),
    ];

    const entries = buildThirdPlaceEntries(groupOrder, standings);
    expect(entries).toHaveLength(12);
    const argEntry = entries.find((e) => e.teamId === 'arg');
    expect(argEntry).toMatchObject({ teamId: 'arg', groupId: 'A', points: 3, goalDifference: -1, goalsFor: 2 });
  });

  it('uses zero stats for groups with no standings yet', () => {
    const groupOrder = makeGroupOrder({});
    const standings = Object.fromEntries(GROUP_IDS.map((g) => [g, [] as Standing[]])) as Record<GroupId, Standing[]>;
    const entries = buildThirdPlaceEntries(groupOrder, standings);
    expect(entries.every((e) => e.points === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rankThirdPlaceEntries
// ---------------------------------------------------------------------------

describe('rankThirdPlaceEntries', () => {
  it('ranks by points descending', () => {
    const entries = [
      { teamId: 'low', groupId: 'A' as GroupId, points: 2, goalDifference: 0, goalsFor: 0 },
      { teamId: 'high', groupId: 'B' as GroupId, points: 7, goalDifference: 0, goalsFor: 0 },
      { teamId: 'mid', groupId: 'C' as GroupId, points: 4, goalDifference: 0, goalsFor: 0 },
    ];
    const ranked = rankThirdPlaceEntries(entries);
    expect(ranked.map((e) => e.teamId)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks points ties by goal difference', () => {
    const entries = [
      { teamId: 'a', groupId: 'A' as GroupId, points: 4, goalDifference: -1, goalsFor: 2 },
      { teamId: 'b', groupId: 'B' as GroupId, points: 4, goalDifference: 3, goalsFor: 4 },
    ];
    expect(rankThirdPlaceEntries(entries)[0].teamId).toBe('b');
  });

  it('breaks GD ties by goals scored', () => {
    const entries = [
      { teamId: 'a', groupId: 'A' as GroupId, points: 4, goalDifference: 1, goalsFor: 2 },
      { teamId: 'b', groupId: 'B' as GroupId, points: 4, goalDifference: 1, goalsFor: 5 },
    ];
    expect(rankThirdPlaceEntries(entries)[0].teamId).toBe('b');
  });

  it('does not mutate the input array', () => {
    const entries = [
      { teamId: 'b', groupId: 'B' as GroupId, points: 2, goalDifference: 0, goalsFor: 0 },
      { teamId: 'a', groupId: 'A' as GroupId, points: 7, goalDifference: 0, goalsFor: 0 },
    ];
    const original = [...entries];
    rankThirdPlaceEntries(entries);
    expect(entries).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// qualifyingThirdPlace + qualifyingThirdPlaceGroups
// ---------------------------------------------------------------------------

describe('qualifyingThirdPlace + qualifyingThirdPlaceGroups', () => {
  it('returns the top 8 ids and their group letters', () => {
    const ranked = GROUP_IDS.map((g, i) => ({
      teamId: `team-${g}`,
      groupId: g,
      points: 12 - i,
      goalDifference: 0,
      goalsFor: 0,
    }));
    expect(qualifyingThirdPlace(ranked)).toHaveLength(8);
    expect(qualifyingThirdPlace(ranked)[0]).toBe('team-A');
    expect(qualifyingThirdPlaceGroups(ranked)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });
});

// ---------------------------------------------------------------------------
// achievablePointRange
// ---------------------------------------------------------------------------

describe('achievablePointRange', () => {
  it('returns fixed range when no remaining matches exist', () => {
    const entry = makeEntry('t', 'A', 6);
    expect(achievablePointRange(entry, [])).toEqual({ min: 6, max: 6 });
  });

  it('extends max by 3 for one remaining match', () => {
    const entry = makeEntry('t', 'A', 4);
    const matches = [makeMatch('m1', 'A', 't', 'opp', false)];
    expect(achievablePointRange(entry, matches)).toEqual({ min: 4, max: 7 });
  });

  it('extends max by 6 for two remaining matches', () => {
    const entry = makeEntry('t', 'A', 1);
    const matches = [
      makeMatch('m1', 'A', 't', 'opp1', false),
      makeMatch('m2', 'A', 'opp2', 't', false),
    ];
    expect(achievablePointRange(entry, matches)).toEqual({ min: 1, max: 7 });
  });

  it('ignores already-played matches', () => {
    const entry = makeEntry('t', 'A', 3);
    const matches = [
      makeMatch('m1', 'A', 't', 'opp1', true),  // played
      makeMatch('m2', 'A', 't', 'opp2', false), // remaining
    ];
    expect(achievablePointRange(entry, matches)).toEqual({ min: 3, max: 6 });
  });

  it('ignores matches for other groups', () => {
    const entry = makeEntry('t', 'A', 3);
    const matches = [makeMatch('m1', 'B', 't', 'opp', false)]; // wrong group
    expect(achievablePointRange(entry, matches)).toEqual({ min: 3, max: 3 });
  });
});

// ---------------------------------------------------------------------------
// canRankAbove — fixed groups (all matches played)
// ---------------------------------------------------------------------------

describe('canRankAbove — both groups complete', () => {
  const none: Match[] = [];

  it('higher points always beats lower', () => {
    expect(canRankAbove(makeEntry('a', 'A', 7), makeEntry('b', 'B', 5), none)).toBe(true);
  });

  it('lower points cannot beat higher', () => {
    expect(canRankAbove(makeEntry('a', 'A', 3), makeEntry('b', 'B', 7), none)).toBe(false);
  });

  it('equal points — better GD wins', () => {
    expect(canRankAbove(makeEntry('a', 'A', 4, 3, 5), makeEntry('b', 'B', 4, 1, 5), none)).toBe(true);
    expect(canRankAbove(makeEntry('a', 'A', 4, 1, 5), makeEntry('b', 'B', 4, 3, 5), none)).toBe(false);
  });

  it('equal points+GD — better GF wins', () => {
    expect(canRankAbove(makeEntry('a', 'A', 4, 2, 6), makeEntry('b', 'B', 4, 2, 4), none)).toBe(true);
    expect(canRankAbove(makeEntry('a', 'A', 4, 2, 4), makeEntry('b', 'B', 4, 2, 6), none)).toBe(false);
  });

  it('equal stats — alphabetically earlier teamId ranks higher', () => {
    expect(canRankAbove(makeEntry('aardvark', 'A', 4, 2, 4), makeEntry('zebra', 'B', 4, 2, 4), none)).toBe(true);
    expect(canRankAbove(makeEntry('zebra', 'A', 4, 2, 4), makeEntry('aardvark', 'B', 4, 2, 4), none)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canRankAbove — mixed match counts (2-games vs 3-games)
// ---------------------------------------------------------------------------

describe('canRankAbove — mixed match counts', () => {
  it('2-game team can rank above fixed team if win gives enough points', () => {
    // team-a: 3 pts after 2 games, 1 remaining → can reach 6 pts
    // team-b: 4 pts fixed
    const a = makeEntry('team-a', 'A', 3);
    const b = makeEntry('team-b', 'B', 4);
    const matches = [makeMatch('m1', 'A', 'team-a', 'opp', false)];
    expect(canRankAbove(a, b, matches)).toBe(true); // a can get 6 > 4
  });

  it('2-game team cannot rank above fixed team when max pts still falls short', () => {
    // team-a: 1 pt after 2 games, 1 remaining → max 4 pts
    // team-b: 5 pts fixed → min 5
    const a = makeEntry('team-a', 'A', 1);
    const b = makeEntry('team-b', 'B', 5);
    const matches = [makeMatch('m1', 'A', 'team-a', 'opp', false)];
    expect(canRankAbove(a, b, matches)).toBe(false); // 4 < 5
  });

  it('fixed team can rank above 2-game team that could surpass it only by winning', () => {
    // team-a: 5 pts fixed
    // team-b: 4 pts, 1 remaining → min 4, max 7
    // a above b: a max (5) > b min (4) → feasible (b can lose → 4 < 5)
    const a = makeEntry('team-a', 'A', 5);
    const b = makeEntry('team-b', 'B', 4);
    const matches = [makeMatch('m1', 'B', 'team-b', 'opp', false)];
    expect(canRankAbove(a, b, matches)).toBe(true);
  });

  it('fixed team cannot rank above 2-game team whose minimum already exceeds it', () => {
    // team-a: 4 pts fixed
    // team-b: 5 pts, 1 remaining → min 5, max 8
    const a = makeEntry('team-a', 'A', 4);
    const b = makeEntry('team-b', 'B', 5);
    const matches = [makeMatch('m1', 'B', 'team-b', 'opp', false)];
    expect(canRankAbove(a, b, matches)).toBe(false); // a max 4 < b min 5
  });

  it('two 2-game teams: feasible when one can get more points', () => {
    // a: 4 pts, max 7; b: 5 pts, max 8
    // a above b: a max (7) > b min (5) → true (a wins, b loses)
    const a = makeEntry('team-a', 'A', 4);
    const b = makeEntry('team-b', 'B', 5);
    const matchesA = [makeMatch('m1', 'A', 'team-a', 'opp', false)];
    const matchesB = [makeMatch('m2', 'B', 'team-b', 'opp', false)];
    expect(canRankAbove(a, b, [...matchesA, ...matchesB])).toBe(true);
  });

  it('two 2-game teams: infeasible when one can never reach the other minimum', () => {
    // a: 1 pt, max 4; b: 5 pts, max 8
    const a = makeEntry('team-a', 'A', 1);
    const b = makeEntry('team-b', 'B', 5);
    const matches = [
      makeMatch('m1', 'A', 'team-a', 'opp', false),
      makeMatch('m2', 'B', 'team-b', 'opp', false),
    ];
    expect(canRankAbove(a, b, matches)).toBe(false); // a max 4 < b min 5
  });

  it('boundary: 2-game team whose max equals fixed teams points — GD tunable → feasible', () => {
    // a: 4 pts, 1 remaining → max 7; b: 7 pts fixed
    // a max == b min → a has remaining match → GD free → feasible
    const a = makeEntry('team-a', 'A', 4);
    const b = makeEntry('team-b', 'B', 7);
    const matches = [makeMatch('m1', 'A', 'team-a', 'opp', false)];
    expect(canRankAbove(a, b, matches)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// firstIllegalThirdPlaceRank + isLegalThirdPlaceRanking
// ---------------------------------------------------------------------------

describe('isLegalThirdPlaceRanking — basic', () => {
  const none: Match[] = [];

  it('accepts a correctly ordered ranking', () => {
    const ranked = [makeEntry('a', 'A', 7), makeEntry('b', 'B', 5), makeEntry('c', 'C', 3)];
    expect(isLegalThirdPlaceRanking(ranked, none)).toBe(true);
    expect(firstIllegalThirdPlaceRank(ranked, none)).toBeNull();
  });

  it('accepts a single entry', () => {
    expect(isLegalThirdPlaceRanking([makeEntry('a', 'A', 7)], none)).toBe(true);
  });

  it('accepts an empty list', () => {
    expect(isLegalThirdPlaceRanking([], none)).toBe(true);
  });

  it('rejects a fully reversed ranking', () => {
    const ranked = [makeEntry('c', 'C', 3), makeEntry('b', 'B', 5), makeEntry('a', 'A', 7)];
    expect(isLegalThirdPlaceRanking(ranked, none)).toBe(false);
    expect(firstIllegalThirdPlaceRank(ranked, none)).toBe(0); // first pair already wrong
  });

  it('identifies the first illegal index (not the last)', () => {
    // rank 0 (7pts) → ok, rank 1 (3pts) → cannot be above rank 2 (5pts)
    const ranked = [makeEntry('a', 'A', 7), makeEntry('c', 'C', 3), makeEntry('b', 'B', 5)];
    expect(firstIllegalThirdPlaceRank(ranked, none)).toBe(1);
  });
});

describe('isLegalThirdPlaceRanking — 8-of-12 cutoff', () => {
  it('rejects ranking where position 9 has more points than position 8', () => {
    // ranks 0-6 descending, rank 7 = 4 pts (last qualifier), rank 8 = 5 pts (first non-qualifier)
    const ranked: ThirdPlaceEntry[] = GROUP_IDS.map((g, i) => {
      const pts = i <= 6 ? 12 - i : i === 7 ? 4 : i === 8 ? 5 : 1;
      return makeEntry(`t-${g}`, g, pts);
    });
    // pair (ranked[7]=4pts, ranked[8]=5pts) is illegal
    expect(firstIllegalThirdPlaceRank(ranked, [])).toBe(7);
    expect(isLegalThirdPlaceRanking(ranked, [])).toBe(false);
  });

  it('accepts ranking where position 8 equals position 9 in all stats', () => {
    // Points equal; GF tiebreak: rank 7 teamId 'h-team' < rank 8 'i-team' alphabetically → rank 7 higher
    const ranked: ThirdPlaceEntry[] = GROUP_IDS.map((g) => {
      // All same stats; rely on alphabetical teamId tiebreak
      return makeEntry(`${g.toLowerCase()}-team`, g, 4, 1, 3);
    });
    // 'a-team' < 'b-team' < ... → natural alphabetical order is legal
    expect(isLegalThirdPlaceRanking(ranked, [])).toBe(true);
  });
});

describe('isLegalThirdPlaceRanking — full 12-team mixed scenario', () => {
  // Groups A–E: complete (3 games played), points 7,6,5,4,3
  // Groups G–L: 2 games played (1 remaining match each), current points all 3 → min 3, max 6
  // Group F: complete (3 games played), 2 pts — must sit below all 3-pt teams
  // Valid ordering: a3,b3,c3,d3,e3, then g3..l3 (all can achieve 3+ pts), then f3 last
  function buildMixedScenario() {
    const entries: ThirdPlaceEntry[] = [
      makeEntry('a3', 'A', 7), makeEntry('b3', 'B', 6), makeEntry('c3', 'C', 5),
      makeEntry('d3', 'D', 4), makeEntry('e3', 'E', 3),
      // 2-game teams — min 3 pts each (cannot drop below 3)
      makeEntry('g3', 'G', 3), makeEntry('h3', 'H', 3), makeEntry('i3', 'I', 3),
      makeEntry('j3', 'J', 3), makeEntry('k3', 'K', 3), makeEntry('l3', 'L', 3),
      // f3: 2 pts fixed — must be last (f3 max 2 < every 2-game team's min 3)
      makeEntry('f3', 'F', 2),
    ];
    const matches: Match[] = [
      makeMatch('mg', 'G', 'g3', 'g-opp', false),
      makeMatch('mh', 'H', 'h3', 'h-opp', false),
      makeMatch('mi', 'I', 'i3', 'i-opp', false),
      makeMatch('mj', 'J', 'j3', 'j-opp', false),
      makeMatch('mk', 'K', 'k3', 'k-opp', false),
      makeMatch('ml', 'L', 'l3', 'l-opp', false),
    ];
    return { entries, matches };
  }

  it('accepts the default ordering', () => {
    const { entries, matches } = buildMixedScenario();
    expect(isLegalThirdPlaceRanking(entries, matches)).toBe(true);
  });

  it('rejects placing a 2-pt fixed team above 2-game teams whose minimum is 3 pts', () => {
    // Insert f3 (2pts, fixed) at index 5, pushing g3 to index 6
    // Pair (f3=2pts, g3=3pts min): f3.max(2) < g3.min(3) → illegal at index 5
    const { entries, matches } = buildMixedScenario();
    const reordered = [
      entries[0], entries[1], entries[2], entries[3], entries[4],
      entries[11], // f3 (2 pts, fixed) inserted before 2-game teams
      entries[5], entries[6], entries[7], entries[8], entries[9], entries[10],
    ];
    expect(isLegalThirdPlaceRanking(reordered, matches)).toBe(false);
    expect(firstIllegalThirdPlaceRank(reordered, matches)).toBe(5);
  });

  it('allows a 2-game team (3 pts, can win→6) to outrank a fixed 5-pt team', () => {
    // g3 = 3 pts + 1 remaining → max 6. c3 = 5 pts fixed.
    // Can g3 rank above c3? g3 max (6) > c3 min (5) → yes
    const { entries, matches } = buildMixedScenario();
    const g3 = entries.find((e) => e.teamId === 'g3')!;
    const c3 = entries.find((e) => e.teamId === 'c3')!;
    expect(canRankAbove(g3, c3, matches)).toBe(true);
  });

  it('blocks a 2-game team (3 pts, max 6) from outranking a fixed 7-pt team', () => {
    const { entries, matches } = buildMixedScenario();
    const g3 = entries.find((e) => e.teamId === 'g3')!;
    const a3 = entries.find((e) => e.teamId === 'a3')!; // 7 pts fixed
    expect(canRankAbove(g3, a3, matches)).toBe(false); // 6 < 7
  });

  it('correctly handles a legal partial-group ranking at the cut-line', () => {
    // Arrange so rank 8 (first non-qualifier) has a 2-game team that could match rank 7
    // But natural order here is fine — test that a legal 8/9 boundary passes
    const entries: ThirdPlaceEntry[] = [
      makeEntry('a3', 'A', 7), makeEntry('b3', 'B', 6), makeEntry('c3', 'C', 5),
      makeEntry('d3', 'D', 4), makeEntry('e3', 'E', 4), makeEntry('f3', 'F', 4),
      makeEntry('g3', 'G', 4), makeEntry('h3', 'H', 4), // rank 7 (last qualifier)
      makeEntry('i3', 'I', 3), // rank 8 (first non-qualifier): 3 pts fixed
      makeEntry('j3', 'J', 2), makeEntry('k3', 'K', 1), makeEntry('l3', 'L', 0),
    ];
    // Groups I, J, K, L are complete (no remaining matches)
    expect(isLegalThirdPlaceRanking(entries, [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Interaction scenarios — simulating the drag-and-drop constraint enforcement
// These mirror the logic in ThirdPlace.tsx's onDragEnd handler.
// ---------------------------------------------------------------------------

/**
 * Simulates the drag handler: applies arrayMove to an id list, maps to entries,
 * and returns the first-illegal index (null = valid reorder).
 */
function simulateDrag(
  idOrder: string[],
  entryById: Record<string, ThirdPlaceEntry>,
  from: number,
  to: number,
  matches: Match[],
): number | null {
  const next = [...idOrder];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  const entries = next.map((id) => entryById[id]).filter(Boolean) as ThirdPlaceEntry[];
  return firstIllegalThirdPlaceRank(entries, matches);
}

describe('UI interaction — drag constraint enforcement', () => {
  // 12 teams, all complete (3 games played), points strictly decreasing.
  const staticEntries: ThirdPlaceEntry[] = GROUP_IDS.map((g, i) =>
    makeEntry(`team-${g}`, g, 12 - i),
  );
  const staticById = Object.fromEntries(staticEntries.map((e) => [e.teamId, e]));
  const staticIds = staticEntries.map((e) => e.teamId);
  const noMatches: Match[] = [];

  it('accepts a valid reorder when remaining matches make either ordering achievable', () => {
    // Both teams have 1 remaining match (GD/GF tunable) so either can rank above the other.
    const entries: ThirdPlaceEntry[] = GROUP_IDS.map((g, i) =>
      makeEntry(`team-${g}`, g, 5),
    );
    const byId = Object.fromEntries(entries.map((e) => [e.teamId, e]));
    const ids = entries.map((e) => e.teamId);
    // Each group has 1 remaining match for its third-place team.
    const matches: Match[] = GROUP_IDS.map((g) =>
      makeMatch(`m${g}`, g, `team-${g}`, `opp-${g}`, false),
    );
    // All teams at 5 pts with remaining matches → any adjacent swap is valid.
    expect(simulateDrag(ids, byId, 0, 5, matches)).toBeNull();
    expect(simulateDrag(ids, byId, 11, 0, matches)).toBeNull();
  });

  it('rejects moving a low-pts team above a high-pts team', () => {
    // Drag last team (0 pts) to rank-0 position
    const result = simulateDrag(staticIds, staticById, 11, 0, noMatches);
    expect(result).not.toBeNull();
    // rank-0 after drag is team-L (0 pts), rank-1 is team-A (12 pts) → illegal at index 0
    expect(result).toBe(0);
  });

  it('rejects moving rank-1 team to rank-3 when that creates an impossible pair', () => {
    // Moving team-A (12 pts) from index 0 to index 2 produces [B(11),C(10),A(12),D(8)…]
    // Pair (C=10, A=12): 10 < 12 → illegal at index 1
    const result = simulateDrag(staticIds, staticById, 0, 2, noMatches);
    expect(result).toBe(1);
  });

  it('accepts a reorder when remaining matches allow it', () => {
    // Both a and b have 4 pts with 1 remaining match each — GD/GF freely tunable,
    // so either can rank above the other.
    const a = makeEntry('team-a', 'A', 4);
    const b = makeEntry('team-b', 'B', 4);
    const rest: ThirdPlaceEntry[] = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map(
      (g, i) => makeEntry(`team-${g}`, g as GroupId, 3 - i),
    );
    const all = [a, b, ...rest];
    const byId = Object.fromEntries(all.map((e) => [e.teamId, e]));
    const ids = all.map((e) => e.teamId);
    const matchesAB: Match[] = [
      makeMatch('mA', 'A', 'team-a', 'opp-a', false),
      makeMatch('mB', 'B', 'team-b', 'opp-b', false),
    ];
    // With remaining matches, hi.max > lo.min → canRankAbove is true in both directions.
    expect(simulateDrag(ids, byId, 0, 1, matchesAB)).toBeNull();
    expect(simulateDrag(ids, byId, 1, 0, matchesAB)).toBeNull();
  });

  it('enforces the 8-of-12 qualification cut-line', () => {
    // Drag the rank-8 (9th in 0-based: 4 pts) to rank-7 (5 pts) and verify it's rejected.
    // In staticEntries: index 7 = team-H (5 pts), index 8 = team-I (4 pts)
    const result = simulateDrag(staticIds, staticById, 8, 7, noMatches);
    // After move: [..., team-I(4pts), team-H(5pts), ...]
    // Pair at index 7: team-I(4) < team-H(5) → illegal at 7
    expect(result).toBe(7);
  });

  it('allows a 2-game team to move up when it can reach the required points', () => {
    // team-b: 3 pts, 1 remaining match → can reach 6 pts
    // team-a: 4 pts fixed
    // Ranking [b, a, …]: b max (6) > a min (4) → feasible
    const a = makeEntry('team-a', 'A', 4);
    const b = makeEntry('team-b', 'B', 3);
    const rest: ThirdPlaceEntry[] = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map(
      (g, i) => makeEntry(`team-${g}`, g as GroupId, 2 - Math.floor(i / 2)),
    );
    const all = [a, b, ...rest];
    const byId = Object.fromEntries(all.map((e) => [e.teamId, e]));
    const ids = all.map((e) => e.teamId);
    const matches: Match[] = [makeMatch('m1', 'B', 'team-b', 'b-opp', false)];
    // b is at index 1, a at index 0. Drag b (index 1) to index 0 (above a):
    expect(simulateDrag(ids, byId, 1, 0, matches)).toBeNull();
  });

  it('blocks a 2-game team from moving above a position it cannot reach', () => {
    // team-b: 1 pt, 1 remaining → max 4 pts
    // team-a: 5 pts fixed
    // Ranking [b, a, …]: b max (4) < a min (5) → infeasible at index 0
    const a = makeEntry('team-a', 'A', 5);
    const b = makeEntry('team-b', 'B', 1);
    const rest: ThirdPlaceEntry[] = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map(
      (g, i) => makeEntry(`team-${g}`, g as GroupId, 0),
    );
    const all = [a, b, ...rest];
    const byId = Object.fromEntries(all.map((e) => [e.teamId, e]));
    const ids = all.map((e) => e.teamId);
    const matches: Match[] = [makeMatch('m1', 'B', 'team-b', 'b-opp', false)];
    // b at index 1, a at index 0. Drag b to index 0:
    const result = simulateDrag(ids, byId, 1, 0, matches);
    expect(result).toBe(0);
  });
});
