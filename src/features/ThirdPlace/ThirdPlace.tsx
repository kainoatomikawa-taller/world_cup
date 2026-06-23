import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { useThirdPlaceData } from './useThirdPlaceData';
import { ThirdPlaceRow } from './ThirdPlaceRow';
import { useTournamentStore } from '../../store/tournamentStore';

const QUALIFYING_COUNT = 8;

export function ThirdPlace() {
  const teams = useTournamentStore((s) => s.teams);
  const rankThirdPlace = useTournamentStore((s) => s.rankThirdPlace);
  const thirdPlaceRanking = useTournamentStore((s) => s.thirdPlaceRanking);
  const { rankedEntries, allGroupsComplete } = useThirdPlaceData();

  // See GroupCard: press-and-hold so a quick swipe scrolls instead of dragging.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = thirdPlaceRanking.indexOf(active.id as string);
    const newIndex = thirdPlaceRanking.indexOf(over.id as string);
    rankThirdPlace(arrayMove(thirdPlaceRanking, oldIndex, newIndex));
  }

  if (rankedEntries.length === 0) {
    return (
      <section>
        <h2>Third-place ranking</h2>
        <p className="screen-intro">Set the group stage standings first.</p>
      </section>
    );
  }

  return (
    <section>
      <h2 style={{ marginBottom: 4 }}>Third-place ranking</h2>
      <p className="screen-intro">
        {allGroupsComplete
          ? 'All groups are complete — the ranking is locked to the final results.'
          : 'Drag to rank the 12 third-place teams. The top 8 advance to the Round of 32.'}
      </p>

      <div className="tp-list">
        {/* Column headers */}
        <div className="tp-head tnum">
          <span style={{ width: 22 }} />
          <span style={{ flex: 1 }}>Team</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <span style={{ minWidth: 20, textAlign: 'right' }}>Pts</span>
            <span style={{ minWidth: 28, textAlign: 'right' }}>GD</span>
            <span style={{ minWidth: 20, textAlign: 'right' }}>GF</span>
          </span>
          <span style={{ minWidth: 56 }} />
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={thirdPlaceRanking}
            strategy={verticalListSortingStrategy}
          >
            {rankedEntries.map((entry, i) => (
              <div key={entry.teamId}>
                {/* Qualification cut line between rank 8 and 9 */}
                {i === QUALIFYING_COUNT && (
                  <div className="cut-divider">
                    ── QUALIFICATION CUT · top 8 advance ──
                  </div>
                )}
                <ThirdPlaceRow
                  rank={i + 1}
                  entry={entry}
                  team={teams[entry.teamId]}
                  advancing={i < QUALIFYING_COUNT}
                  locked={allGroupsComplete}
                />
              </div>
            ))}
          </SortableContext>
        </DndContext>

        {/* Legend */}
        <div className="legend">
          <span>
            <span className="dot" style={{ background: 'var(--green)' }} />
            Advances to Round of 32
          </span>
          <span>
            <span className="dot" style={{ background: 'var(--border-strong)' }} />
            Eliminated
          </span>
        </div>
      </div>
    </section>
  );
}
