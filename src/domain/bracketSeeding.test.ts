import { describe, it, expect } from 'vitest';
import { seedRound32 } from './bracketSeeding';
import { GROUP_IDS } from './types';
import type { GroupId } from './types';

// Synthetic group order: index 0 = winner, 1 = runner-up, 2 = third, 3 = fourth.
const ORDER: Record<GroupId, string[]> = Object.fromEntries(
  GROUP_IDS.map((g) => [g, [`w-${g}`, `ru-${g}`, `3-${g}`, `4-${g}`]]),
) as Record<GroupId, string[]>;

// A valid set of 8 qualifying groups (all 495 combos work; use a simple one).
const QUAL_GROUPS: GroupId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

describe('seedRound32', () => {
  it('produces exactly 32 slots', () => {
    const b = seedRound32(ORDER, QUAL_GROUPS);
    expect(Object.keys(b)).toHaveLength(32);
  });

  it('match 73: RU-A vs RU-B', () => {
    const b = seedRound32(ORDER, QUAL_GROUPS);
    expect(b[73].homeId).toBe('ru-A');
    expect(b[73].awayId).toBe('ru-B');
  });

  it('match 74: W-E home; third-place away resolved from assignment', () => {
    const b = seedRound32(ORDER, QUAL_GROUPS);
    expect(b[74].homeId).toBe('w-E');
    // awayId should be the 3rd-place team of whichever group was assigned to slot 74.
    expect(b[74].awayId).toMatch(/^3-[ABCDF]$/); // slot 74 eligible: A,B,C,D,F
  });

  it('match 75: W-F vs RU-C', () => {
    const b = seedRound32(ORDER, QUAL_GROUPS);
    expect(b[75].homeId).toBe('w-F');
    expect(b[75].awayId).toBe('ru-C');
  });

  it('match 88: RU-D vs RU-G', () => {
    const b = seedRound32(ORDER, QUAL_GROUPS);
    expect(b[88].homeId).toBe('ru-D');
    expect(b[88].awayId).toBe('ru-G');
  });

  it('all 16 R32 slots have both participants when input is complete', () => {
    const b = seedRound32(ORDER, QUAL_GROUPS);
    for (let id = 73; id <= 88; id++) {
      expect(b[id].homeId, `match ${id} homeId`).toBeDefined();
      expect(b[id].awayId, `match ${id} awayId`).toBeDefined();
    }
  });

  it('R16+ slots start with no participants', () => {
    const b = seedRound32(ORDER, QUAL_GROUPS);
    const laterIds = [89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104];
    for (const id of laterIds) {
      expect(b[id].homeId).toBeUndefined();
      expect(b[id].awayId).toBeUndefined();
    }
  });

  it('third-place slots are undefined when fewer than 8 groups qualify', () => {
    const b = seedRound32(ORDER, ['A', 'B', 'C', 'D', 'E', 'F', 'G']); // only 7
    const thirdSlots = [74, 77, 79, 80, 81, 82, 85, 87];
    for (const id of thirdSlots) {
      expect(b[id].awayId).toBeUndefined();
    }
  });

  it('no slot is locked (no live results)', () => {
    const b = seedRound32(ORDER, QUAL_GROUPS);
    for (const slot of Object.values(b)) {
      expect(slot.locked).toBe(false);
    }
  });
});
