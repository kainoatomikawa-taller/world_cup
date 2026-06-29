import { describe, it, expect } from 'vitest';
import {
  assignThirdPlace,
  THIRD_PLACE_SLOTS,
  THIRD_PLACE_MATCH_IDS,
} from './assignmentTable';
import { GROUP_IDS } from '../domain/types';
import type { GroupId } from '../domain/types';

// All C(12,8) = 495 combinations of qualifying groups.
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [head, ...rest] = arr;
  const withHead = combinations(rest, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(rest, k);
  return [...withHead, ...withoutHead];
}

const ALL_COMBINATIONS = combinations(GROUP_IDS, 8);

describe('assignThirdPlace', () => {
  it('there are exactly 495 qualifying-group combinations', () => {
    expect(ALL_COMBINATIONS).toHaveLength(495);
  });

  it('produces a valid perfect matching for every one of the 495 combinations', () => {
    const eligibleByMatch = Object.fromEntries(
      THIRD_PLACE_SLOTS.map((s) => [s.matchId, s.eligibleGroups]),
    );

    for (const combo of ALL_COMBINATIONS) {
      const assignment = assignThirdPlace(combo);
      const assignedMatchIds = Object.keys(assignment).map(Number).sort((a, b) => a - b);
      const assignedGroups = Object.values(assignment).sort();

      // Every third-place slot is filled exactly once.
      expect(assignedMatchIds).toEqual([...THIRD_PLACE_MATCH_IDS].sort((a, b) => a - b));
      // Each qualifying group is used exactly once.
      expect(assignedGroups).toEqual([...combo].sort());
      // Each group sits in a slot it is eligible for.
      for (const [matchId, group] of Object.entries(assignment)) {
        expect(eligibleByMatch[Number(matchId)]).toContain(group);
      }
    }
  });

  it('forces K into match 80 (its only eligible slot) whenever K qualifies', () => {
    for (const combo of ALL_COMBINATIONS) {
      if (combo.includes('K' as GroupId)) {
        expect(assignThirdPlace(combo)[80]).toBe('K');
      }
    }
  });

  it('forces L into match 87 (its only eligible slot) whenever L qualifies', () => {
    for (const combo of ALL_COMBINATIONS) {
      if (combo.includes('L' as GroupId)) {
        expect(assignThirdPlace(combo)[87]).toBe('L');
      }
    }
  });

  it('is deterministic (same input → same output)', () => {
    const combo: GroupId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    expect(assignThirdPlace(combo)).toEqual(assignThirdPlace(combo));
  });

  it('throws when not given exactly 8 groups', () => {
    expect(() => assignThirdPlace(['A', 'B', 'C'])).toThrow();
  });

  it('matches FIFA table for the 2026 live qualifying combination', () => {
    const result = assignThirdPlace(['B', 'D', 'E', 'F', 'I', 'J', 'K', 'L']);
    expect(result[74]).toBe('D'); // Germany (E winner) vs Paraguay (D 3rd)
    expect(result[81]).toBe('B'); // USA (D winner) vs Bosnia and Herzegovina (B 3rd)
  });
});
