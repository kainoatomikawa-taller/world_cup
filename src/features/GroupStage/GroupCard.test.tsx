import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GroupCard } from './GroupCard';
import { firstJointlyIllegalGroupPlacement } from '../../domain/elimination';
import type { GroupData } from './useGroupData';
import type { Standing, PlacementPossibility, Team } from '../../domain/types';

// Capture the onDragEnd handler GroupCard registers with DndContext so tests
// can invoke it directly without simulating real pointer events.
let capturedOnDragEnd: ((event: any) => void) | undefined;

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...mod,
    DndContext: ({ children, onDragEnd }: any) => {
      capturedOnDragEnd = onDragEnd;
      return children;
    },
  };
});

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => children,
  verticalListSortingStrategy: {},
  arrayMove: (array: any[], from: number, to: number) => {
    const next = [...array];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  },
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('../../domain/elimination', () => ({
  firstJointlyIllegalGroupPlacement: vi.fn(),
}));

// ── Store mock ────────────────────────────────────────────────────────────────

const mockSetGroupOrder = vi.fn();

vi.mock('../../store/tournamentStore', () => ({
  useTournamentStore: vi.fn((selector: (s: any) => any) =>
    selector({
      groupOrder: { A: ['t1', 't2', 't3', 't4'] },
      setGroupOrder: mockSetGroupOrder,
      matches: [],
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
    vi.mocked(firstJointlyIllegalGroupPlacement).mockReturnValue(null);
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

describe('GroupCard – drag-and-drop joint feasibility validation', () => {
  beforeEach(() => {
    mockSetGroupOrder.mockClear();
    vi.mocked(firstJointlyIllegalGroupPlacement).mockClear();
    vi.mocked(firstJointlyIllegalGroupPlacement).mockReturnValue(null);
    capturedOnDragEnd = undefined;
  });

  it('accepts a valid reordering and commits the new group order', () => {
    render(<GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(false)} />);

    // Drag t2 (index 1) to where t1 is (index 0).
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });

    expect(mockSetGroupOrder).toHaveBeenCalledWith('A', ['t2', 't1', 't3', 't4']);
    expect(screen.queryByText(/cannot finish above/)).not.toBeInTheDocument();
  });

  it('rejects a jointly-impossible reordering and shows an explanatory error', () => {
    vi.mocked(firstJointlyIllegalGroupPlacement).mockReturnValue({
      index: 0,
      teamId: 't2',
      blockedById: 't1',
    });

    render(<GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(false)} />);

    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });

    expect(mockSetGroupOrder).not.toHaveBeenCalled();
    expect(
      screen.getByText('Team T2 cannot finish above Team T1 — no remaining result produces this order.'),
    ).toBeInTheDocument();
  });

  it('does not reorder or validate when dropping onto the same slot', () => {
    render(<GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(false)} />);

    act(() => { capturedOnDragEnd!({ active: { id: 't1' }, over: { id: 't1' } }); });

    expect(mockSetGroupOrder).not.toHaveBeenCalled();
    expect(firstJointlyIllegalGroupPlacement).not.toHaveBeenCalled();
  });

  it('does nothing when the drag has no drop target', () => {
    render(<GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(false)} />);

    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: null }); });

    expect(mockSetGroupOrder).not.toHaveBeenCalled();
    expect(firstJointlyIllegalGroupPlacement).not.toHaveBeenCalled();
  });

  it('clears a previous error when a subsequent valid drag is accepted', () => {
    vi.mocked(firstJointlyIllegalGroupPlacement).mockReturnValue({
      index: 0,
      teamId: 't2',
      blockedById: 't1',
    });

    render(<GroupCard groupId="A" teams={TEAMS} groupData={makeGroupData(false)} />);

    // First drag: produces an error.
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });
    expect(screen.getByText(/cannot finish above/)).toBeInTheDocument();

    // Second drag: valid — error clears and order is committed.
    vi.mocked(firstJointlyIllegalGroupPlacement).mockReturnValue(null);
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });

    expect(screen.queryByText(/cannot finish above/)).not.toBeInTheDocument();
    expect(mockSetGroupOrder).toHaveBeenCalledWith('A', ['t2', 't1', 't3', 't4']);
  });
});
