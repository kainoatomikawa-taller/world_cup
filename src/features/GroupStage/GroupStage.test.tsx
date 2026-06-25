import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GroupStage } from './GroupStage';

// ── Store mock ────────────────────────────────────────────────────────────────

const mockSetGroupOrder = vi.fn();

// Group A has a user-reordered (stale) order: t2 listed before t1.
const storeState = {
  teams: {
    t1: { id: 't1', name: 'T1', code: 'T1A', groupId: 'A' },
    t2: { id: 't2', name: 'T2', code: 'T2A', groupId: 'A' },
    t3: { id: 't3', name: 'T3', code: 'T3A', groupId: 'A' },
    t4: { id: 't4', name: 'T4', code: 'T4A', groupId: 'A' },
  },
  matches: [{ id: 'm1', stage: 'group', groupId: 'A', homeId: 't1', awayId: 't2',
              homeGoals: 1, awayGoals: 0, kickoff: '2026-06-01T00:00:00Z', played: true }],
  groupOrder: {
    A: ['t2', 't1', 't3', 't4'],  // stale: user had put t2 first
    B: [], C: [], D: [], E: [], F: [],
    G: [], H: [], I: [], J: [], K: [], L: [],
  },
  setGroupOrder: mockSetGroupOrder,
};

vi.mock('../../store/tournamentStore', () => {
  const hook = vi.fn((sel: (s: any) => any) => sel(storeState));
  (hook as any).getState = vi.fn(() => storeState);
  return { useTournamentStore: hook };
});

// computeAllStandings returns t1 first (correct standings order for group A).
vi.mock('../../domain/standings', () => ({
  computeAllStandings: vi.fn(() => ({
    A: [
      { teamId: 't1', played: 3, won: 3, drawn: 0, lost: 0, goalsFor: 3, goalsAgainst: 0, goalDifference: 3, points: 9, position: 1 },
      { teamId: 't2', played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 6, position: 2 },
      { teamId: 't3', played: 3, won: 1, drawn: 0, lost: 2, goalsFor: 1, goalsAgainst: 2, goalDifference: -1, points: 3, position: 3 },
      { teamId: 't4', played: 3, won: 0, drawn: 0, lost: 3, goalsFor: 0, goalsAgainst: 3, goalDifference: -3, points: 0, position: 4 },
    ],
  })),
}));

// Group A is complete; all others are not.
vi.mock('../../domain/elimination', () => ({
  isGroupComplete: vi.fn((groupId: string) => groupId === 'A'),
  computePlacementPossibilities: vi.fn(() => []),
}));

// Stub out GroupCard and useGroupData — rendering them is not the concern here.
vi.mock('./GroupCard', () => ({ GroupCard: () => null }));
vi.mock('./useGroupData', () => ({ useGroupData: () => ({}) }));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GroupStage – snapping complete groups to final standings', () => {
  beforeEach(() => {
    mockSetGroupOrder.mockClear();
  });

  it('calls setGroupOrder with the standings order when a group is complete', () => {
    render(<GroupStage />);
    expect(mockSetGroupOrder).toHaveBeenCalledWith(
      'A',
      ['t1', 't2', 't3', 't4'],
    );
  });

  it('corrects a previously user-reordered group once it completes', () => {
    // The stale store order has t2 first; standings put t1 first.
    render(<GroupStage />);
    const call = mockSetGroupOrder.mock.calls.find(([g]) => g === 'A');
    expect(call).toBeDefined();
    expect(call![1][0]).toBe('t1');  // t1 must be first in the snapped order
    expect(call![1][1]).toBe('t2');
  });
});
