import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GroupCard } from './GroupCard';
import type { GroupData } from './useGroupData';
import type { Standing, PlacementPossibility, Team } from '../../domain/types';

// ── Store mock ────────────────────────────────────────────────────────────────

const mockSetGroupOrder = vi.fn();

vi.mock('../../store/tournamentStore', () => ({
  useTournamentStore: vi.fn((selector: (s: any) => any) =>
    selector({
      groupOrder: { A: ['t1', 't2', 't3', 't4'] },
      setGroupOrder: mockSetGroupOrder,
    }),
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeTeam = (id: string): Team => ({
  id,
  name: `Team ${id.toUpperCase()}`,
  code: id.toUpperCase(),
  groupId: 'A',
});

const makeStanding = (teamId: string, points: number): Standing => ({
  teamId,
  played: 3,
  won: Math.floor(points / 3),
  drawn: points % 3,
  lost: 3 - Math.floor(points / 3) - (points % 3),
  goalsFor: points,
  goalsAgainst: 0,
  goalDifference: points,
  points,
  position: 1,
});

const makePossibility = (teamId: string): PlacementPossibility => ({
  teamId,
  canFinish1st: false,
  canFinish2nd: false,
  canFinish3rd: false,
  canFinish4th: true,
  locked: true,
});

const TEAMS = ['t1', 't2', 't3', 't4'].map(makeTeam);

const makeGroupData = (complete: boolean): GroupData => ({
  standings: ['t1', 't2', 't3', 't4'].map((id, i) => makeStanding(id, 9 - i * 3)),
  possibilities: ['t1', 't2', 't3', 't4'].map(makePossibility),
  complete,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GroupCard – complete/locked state', () => {
  beforeEach(() => {
    mockSetGroupOrder.mockClear();
  });

  it('shows the FINAL badge when the group is complete', () => {
    render(<GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(true)} />);
    expect(screen.getByText('FINAL')).toBeInTheDocument();
  });

  it('does not show the FINAL badge when the group is incomplete', () => {
    render(<GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(false)} />);
    expect(screen.queryByText('FINAL')).not.toBeInTheDocument();
  });

  it('applies the is-locked class to all team rows when the group is complete', () => {
    const { container } = render(
      <GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(true)} />,
    );
    const lockedRows = container.querySelectorAll('.team-row.is-locked');
    expect(lockedRows).toHaveLength(4);
  });

  it('does not apply the is-locked class to team rows when the group is incomplete', () => {
    const { container } = render(
      <GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(false)} />,
    );
    const lockedRows = container.querySelectorAll('.team-row.is-locked');
    expect(lockedRows).toHaveLength(0);
  });
});
