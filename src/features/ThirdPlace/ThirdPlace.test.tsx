import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThirdPlace } from './ThirdPlace';
import { firstJointlyIllegalThirdPlaceRank } from '../../domain/thirdPlace';
import { useThirdPlaceData } from './useThirdPlaceData';
import type { ThirdPlaceEntry } from '../../domain/thirdPlace';

// ── DnD mocks ─────────────────────────────────────────────────────────────────

// Capture the onDragEnd handler so tests can invoke it directly.
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

// ── Domain mock ───────────────────────────────────────────────────────────────

vi.mock('../../domain/thirdPlace', () => ({
  firstJointlyIllegalThirdPlaceRank: vi.fn(() => null),
}));

// ── Hook and store mocks ──────────────────────────────────────────────────────

vi.mock('./useThirdPlaceData', () => ({
  useThirdPlaceData: vi.fn(),
}));

const mockRankThirdPlace = vi.fn();
let storeState: Record<string, any> = {};

vi.mock('../../store/tournamentStore', () => ({
  useTournamentStore: vi.fn((selector: (s: any) => any) => selector(storeState)),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(teamId: string, groupId: string, points = 5): ThirdPlaceEntry {
  return { teamId, groupId: groupId as any, played: 3, points, goalDifference: 0, goalsFor: 0 };
}

function makeTeam(id: string, name: string, groupId: string) {
  return { id, name, code: id.toUpperCase(), groupId, flag: '🏳️' };
}

const ENTRIES_2 = [makeEntry('t1', 'A', 7), makeEntry('t2', 'B', 5)];
const TEAMS_2 = {
  t1: makeTeam('t1', 'Alpha', 'A'),
  t2: makeTeam('t2', 'Beta', 'B'),
};
const ENTRY_BY_ID_2 = Object.fromEntries(ENTRIES_2.map((e) => [e.teamId, e]));

const GROUPS_12 = 'ABCDEFGHIJKL'.split('');
const ENTRIES_12 = GROUPS_12.map((g, i) => makeEntry(`t${i + 1}`, g, 12 - i));
const TEAMS_12 = Object.fromEntries(
  GROUPS_12.map((g, i) => {
    const id = `t${i + 1}`;
    return [id, makeTeam(id, `Team ${id.toUpperCase()}`, g)];
  }),
);
const ENTRY_BY_ID_12 = Object.fromEntries(ENTRIES_12.map((e) => [e.teamId, e]));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ThirdPlace – empty state', () => {
  beforeEach(() => {
    storeState = { teams: {}, matches: [], rankThirdPlace: mockRankThirdPlace, thirdPlaceRanking: [] };
    vi.mocked(useThirdPlaceData).mockReturnValue({ rankedEntries: [], allGroupsComplete: false, entryById: {} });
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(null);
  });

  it('shows placeholder text when no entries are available', () => {
    render(<ThirdPlace />);
    expect(screen.getByText('Set the group stage standings first.')).toBeInTheDocument();
  });

  it('does not render the ranking list', () => {
    const { container } = render(<ThirdPlace />);
    expect(container.querySelector('.tp-list')).not.toBeInTheDocument();
  });
});

describe('ThirdPlace – advancing vs eliminated visual states', () => {
  beforeEach(() => {
    storeState = {
      teams: TEAMS_12,
      matches: [],
      rankThirdPlace: mockRankThirdPlace,
      thirdPlaceRanking: ENTRIES_12.map((e) => e.teamId),
    };
    vi.mocked(useThirdPlaceData).mockReturnValue({
      rankedEntries: ENTRIES_12,
      allGroupsComplete: false,
      entryById: ENTRY_BY_ID_12,
    });
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(null);
  });

  it('applies is-advancing to the top 8 rows', () => {
    const { container } = render(<ThirdPlace />);
    expect(container.querySelectorAll('.tp-row.is-advancing')).toHaveLength(8);
  });

  it('applies is-out to the bottom 4 rows', () => {
    const { container } = render(<ThirdPlace />);
    expect(container.querySelectorAll('.tp-row.is-out')).toHaveLength(4);
  });

  it('shows the ADVANCE badge on each of the 8 qualifying rows', () => {
    render(<ThirdPlace />);
    expect(screen.getAllByText('ADVANCE')).toHaveLength(8);
  });

  it('renders the qualification cut divider between rank 8 and 9', () => {
    render(<ThirdPlace />);
    expect(screen.getByText(/QUALIFICATION CUT/)).toBeInTheDocument();
  });

  it('renders legend labels for advancing and eliminated', () => {
    render(<ThirdPlace />);
    expect(screen.getByText(/Advances to Round of 32/)).toBeInTheDocument();
    expect(screen.getByText(/Eliminated/)).toBeInTheDocument();
  });
});

describe('ThirdPlace – locked state', () => {
  beforeEach(() => {
    storeState = {
      teams: TEAMS_12,
      matches: [],
      rankThirdPlace: mockRankThirdPlace,
      thirdPlaceRanking: ENTRIES_12.map((e) => e.teamId),
    };
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(null);
  });

  it('shows the locked intro text when all groups are complete', () => {
    vi.mocked(useThirdPlaceData).mockReturnValue({
      rankedEntries: ENTRIES_12,
      allGroupsComplete: true,
      entryById: ENTRY_BY_ID_12,
    });
    render(<ThirdPlace />);
    expect(screen.getByText(/All groups are complete/)).toBeInTheDocument();
  });

  it('applies is-locked to all 12 rows when groups are complete', () => {
    vi.mocked(useThirdPlaceData).mockReturnValue({
      rankedEntries: ENTRIES_12,
      allGroupsComplete: true,
      entryById: ENTRY_BY_ID_12,
    });
    const { container } = render(<ThirdPlace />);
    expect(container.querySelectorAll('.tp-row.is-locked')).toHaveLength(12);
  });

  it('does not apply is-locked when groups are still incomplete', () => {
    vi.mocked(useThirdPlaceData).mockReturnValue({
      rankedEntries: ENTRIES_12,
      allGroupsComplete: false,
      entryById: ENTRY_BY_ID_12,
    });
    const { container } = render(<ThirdPlace />);
    expect(container.querySelectorAll('.tp-row.is-locked')).toHaveLength(0);
  });

  it('shows drag instructions when groups are incomplete', () => {
    vi.mocked(useThirdPlaceData).mockReturnValue({
      rankedEntries: ENTRIES_12,
      allGroupsComplete: false,
      entryById: ENTRY_BY_ID_12,
    });
    render(<ThirdPlace />);
    expect(screen.getByText(/Drag to rank the 12 third-place teams/)).toBeInTheDocument();
  });
});

describe('ThirdPlace – infeasible row highlight', () => {
  beforeEach(() => {
    storeState = { teams: TEAMS_2, matches: [], rankThirdPlace: mockRankThirdPlace, thirdPlaceRanking: ['t1', 't2'] };
    vi.mocked(useThirdPlaceData).mockReturnValue({
      rankedEntries: ENTRIES_2,
      allGroupsComplete: false,
      entryById: ENTRY_BY_ID_2,
    });
  });

  it('marks the first row with is-infeasible when index 0 is jointly illegal', () => {
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(0);
    const { container } = render(<ThirdPlace />);
    const rows = container.querySelectorAll('.tp-row');
    expect(rows[0].classList.contains('is-infeasible')).toBe(true);
    expect(rows[1].classList.contains('is-infeasible')).toBe(false);
  });

  it('applies no is-infeasible class when the ranking is valid', () => {
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(null);
    const { container } = render(<ThirdPlace />);
    expect(container.querySelectorAll('.tp-row.is-infeasible')).toHaveLength(0);
  });
});

describe('ThirdPlace – drag constraint enforcement', () => {
  beforeEach(() => {
    capturedOnDragEnd = undefined;
    mockRankThirdPlace.mockClear();
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(null);
    storeState = { teams: TEAMS_2, matches: [], rankThirdPlace: mockRankThirdPlace, thirdPlaceRanking: ['t1', 't2'] };
    vi.mocked(useThirdPlaceData).mockReturnValue({
      rankedEntries: ENTRIES_2,
      allGroupsComplete: false,
      entryById: ENTRY_BY_ID_2,
    });
  });

  it('accepts a valid reordering and commits the new ranking', () => {
    render(<ThirdPlace />);
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });
    expect(mockRankThirdPlace).toHaveBeenCalledWith(['t2', 't1']);
    expect(screen.queryByText(/cannot finish above/)).not.toBeInTheDocument();
  });

  it('rejects a jointly-impossible reordering and shows an explanatory error', () => {
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(0);
    render(<ThirdPlace />);
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });
    expect(mockRankThirdPlace).not.toHaveBeenCalled();
    expect(
      screen.getByText('Beta cannot finish above Alpha — no remaining result produces this order.'),
    ).toBeInTheDocument();
  });

  it('does not commit when dropping onto the same slot', () => {
    render(<ThirdPlace />);
    act(() => { capturedOnDragEnd!({ active: { id: 't1' }, over: { id: 't1' } }); });
    expect(mockRankThirdPlace).not.toHaveBeenCalled();
  });

  it('does nothing when there is no drop target', () => {
    render(<ThirdPlace />);
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: null }); });
    expect(mockRankThirdPlace).not.toHaveBeenCalled();
  });

  it('clears a previous error when a subsequent valid drag is accepted', () => {
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(0);
    render(<ThirdPlace />);

    // First drag: infeasible — error appears.
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });
    expect(screen.getByText(/cannot finish above/)).toBeInTheDocument();

    // Second drag: valid — error disappears and order is committed.
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(null);
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });
    expect(screen.queryByText(/cannot finish above/)).not.toBeInTheDocument();
    expect(mockRankThirdPlace).toHaveBeenCalledWith(['t2', 't1']);
  });

  it('uses team name in error message, falling back to teamId when name is absent', () => {
    // Replace team lookup so t1 has no entry → falls back to teamId.
    storeState = { teams: { t2: TEAMS_2.t2 }, matches: [], rankThirdPlace: mockRankThirdPlace, thirdPlaceRanking: ['t1', 't2'] };
    vi.mocked(firstJointlyIllegalThirdPlaceRank).mockReturnValue(0);
    render(<ThirdPlace />);
    act(() => { capturedOnDragEnd!({ active: { id: 't2' }, over: { id: 't1' } }); });
    expect(screen.getByText(/Beta cannot finish above t1/)).toBeInTheDocument();
  });
});
