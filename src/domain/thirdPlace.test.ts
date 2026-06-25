import { describe, it, expect } from 'vitest';
import {
  buildThirdPlaceEntries,
  rankThirdPlaceEntries,
  qualifyingThirdPlace,
  qualifyingThirdPlaceGroups,
} from './thirdPlace';
import type { GroupId, Standing } from './types';
import { GROUP_IDS } from './types';

// Build a minimal groupOrder with a specific team at index 2 for each group.
function makeGroupOrder(thirdTeamByGroup: Partial<Record<GroupId, string>>): Record<GroupId, string[]> {
  return Object.fromEntries(
    GROUP_IDS.map((g) => {
      const third = thirdTeamByGroup[g] ?? `${g}-default-3rd`;
      return [g, [`${g}-1st`, `${g}-2nd`, third, `${g}-4th`]];
    }),
  ) as Record<GroupId, string[]>;
}

function makeStanding(teamId: string, _groupId: GroupId, pts: number, gd: number, gf: number): Standing {
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

describe('buildThirdPlaceEntries', () => {
  it('extracts one entry per group at index 2 of groupOrder', () => {
    const groupOrder = makeGroupOrder({ A: 'arg', B: 'bra' });
    const standings = Object.fromEntries(
      GROUP_IDS.map((g) => [g, [] as Standing[]]),
    ) as Record<GroupId, Standing[]>;
    standings.A = [makeStanding('A-1st', 'A', 9, 5, 6), makeStanding('A-2nd', 'A', 6, 2, 4), makeStanding('arg', 'A', 3, -1, 2)];

    const entries = buildThirdPlaceEntries(groupOrder, standings);
    expect(entries).toHaveLength(12);
    const argEntry = entries.find((e) => e.teamId === 'arg');
    expect(argEntry).toMatchObject({ teamId: 'arg', groupId: 'A', played: 3, points: 3, goalDifference: -1, goalsFor: 2 });
  });

  it('uses zero stats for groups with no standings yet', () => {
    const groupOrder = makeGroupOrder({});
    const standings = Object.fromEntries(GROUP_IDS.map((g) => [g, [] as Standing[]])) as Record<GroupId, Standing[]>;
    const entries = buildThirdPlaceEntries(groupOrder, standings);
    expect(entries.every((e) => e.points === 0)).toBe(true);
  });

  it('carries played count from the standing', () => {
    const groupOrder = makeGroupOrder({ B: 'bra' });
    const standings = Object.fromEntries(GROUP_IDS.map((g) => [g, [] as Standing[]])) as Record<GroupId, Standing[]>;
    standings.B = [
      makeStanding('B-1st', 'B', 9, 6, 7),
      makeStanding('B-2nd', 'B', 6, 2, 4),
      { ...makeStanding('bra', 'B', 4, 0, 3), played: 2 },
    ];
    const entries = buildThirdPlaceEntries(groupOrder, standings);
    const braEntry = entries.find((e) => e.teamId === 'bra');
    expect(braEntry?.played).toBe(2);
  });

  it('defaults played to 0 when no standing exists', () => {
    const groupOrder = makeGroupOrder({ C: 'col' });
    const standings = Object.fromEntries(GROUP_IDS.map((g) => [g, [] as Standing[]])) as Record<GroupId, Standing[]>;
    // No standing for 'col' in group C
    const entries = buildThirdPlaceEntries(groupOrder, standings);
    const colEntry = entries.find((e) => e.teamId === 'col');
    expect(colEntry?.played).toBe(0);
  });
});

describe('rankThirdPlaceEntries', () => {
  it('ranks by points descending', () => {
    const entries = [
      { teamId: 'low', groupId: 'A' as GroupId, played: 3, points: 2, goalDifference: 0, goalsFor: 0 },
      { teamId: 'high', groupId: 'B' as GroupId, played: 3, points: 7, goalDifference: 0, goalsFor: 0 },
      { teamId: 'mid', groupId: 'C' as GroupId, played: 3, points: 4, goalDifference: 0, goalsFor: 0 },
    ];
    const ranked = rankThirdPlaceEntries(entries);
    expect(ranked.map((e) => e.teamId)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks points ties by goal difference', () => {
    const entries = [
      { teamId: 'a', groupId: 'A' as GroupId, played: 3, points: 4, goalDifference: -1, goalsFor: 2 },
      { teamId: 'b', groupId: 'B' as GroupId, played: 3, points: 4, goalDifference: 3, goalsFor: 4 },
    ];
    const ranked = rankThirdPlaceEntries(entries);
    expect(ranked[0].teamId).toBe('b');
  });

  it('breaks GD ties by goals scored', () => {
    const entries = [
      { teamId: 'a', groupId: 'A' as GroupId, played: 3, points: 4, goalDifference: 1, goalsFor: 2 },
      { teamId: 'b', groupId: 'B' as GroupId, played: 3, points: 4, goalDifference: 1, goalsFor: 5 },
    ];
    const ranked = rankThirdPlaceEntries(entries);
    expect(ranked[0].teamId).toBe('b');
  });

  it('does not mutate the input array', () => {
    const entries = [
      { teamId: 'b', groupId: 'B' as GroupId, played: 3, points: 2, goalDifference: 0, goalsFor: 0 },
      { teamId: 'a', groupId: 'A' as GroupId, played: 3, points: 7, goalDifference: 0, goalsFor: 0 },
    ];
    const original = [...entries];
    rankThirdPlaceEntries(entries);
    expect(entries).toEqual(original);
  });
});

describe('qualifyingThirdPlace + qualifyingThirdPlaceGroups', () => {
  it('returns the top 8 ids and their group letters', () => {
    const ranked = GROUP_IDS.map((g, i) => ({
      teamId: `team-${g}`,
      groupId: g,
      played: 3,
      points: 12 - i,
      goalDifference: 0,
      goalsFor: 0,
    }));
    expect(qualifyingThirdPlace(ranked)).toHaveLength(8);
    expect(qualifyingThirdPlace(ranked)[0]).toBe('team-A');
    expect(qualifyingThirdPlaceGroups(ranked)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });
});
