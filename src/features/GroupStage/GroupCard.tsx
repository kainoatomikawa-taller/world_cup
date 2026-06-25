import { useState } from 'react';
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
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from '@dnd-kit/modifiers';
import { TeamRow } from './TeamRow';
import { firstJointlyIllegalGroupPlacement } from '../../domain/elimination';
import type { GroupData } from './useGroupData';
import type { GroupId, Team } from '../../domain/types';
import { useTournamentStore } from '../../store/tournamentStore';

interface Props {
  groupId: GroupId;
  teams: Team[];
  groupData: GroupData;
}

export function GroupCard({ groupId, teams, groupData }: Props) {
  const groupOrder = useTournamentStore((s) => s.groupOrder[groupId]);
  const setGroupOrder = useTournamentStore((s) => s.setGroupOrder);
  const matches = useTournamentStore((s) => s.matches);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { standings, possibilities, complete } = groupData;

  // Ordered team objects matching the current groupOrder.
  const orderedTeams = groupOrder
    .map((id) => teams.find((t) => t.id === id))
    .filter(Boolean) as Team[];

  // A short press-and-hold (rather than an immediate grab) so a quick finger
  // swipe still scrolls the page on touch devices; `tolerance` cancels the
  // hold if the finger moves first, i.e. the user was scrolling, not dragging.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = groupOrder.indexOf(active.id as string);
    const newIndex = groupOrder.indexOf(over.id as string);
    const newOrder = arrayMove(groupOrder, oldIndex, newIndex);

    const illegal = firstJointlyIllegalGroupPlacement(newOrder, groupId, teams, matches, standings);
    if (illegal) {
      const higherName = teams.find((t) => t.id === illegal.teamId)?.name ?? illegal.teamId;
      const lowerName = teams.find((t) => t.id === illegal.blockedById)?.name ?? illegal.blockedById;
      setErrorMsg(`${higherName} cannot finish above ${lowerName} — no remaining result produces this order.`);
      return;
    }

    setErrorMsg(null);
    setGroupOrder(groupId, newOrder);
  }

  const standingById = Object.fromEntries(standings.map((s) => [s.teamId, s]));
  const possibilityById = Object.fromEntries(possibilities.map((p) => [p.teamId, p]));

  return (
    <div className="card">
      {/* Header */}
      <div className="card-head">
        <span className="card-head__title">Group {groupId}</span>
        {complete && <span className="badge-final">FINAL</span>}
      </div>

      {/* Column labels */}
      <div className="col-labels">
        <span style={{ flex: 1 }} />
        <span className="col-labels__stats tnum">
          <span style={{ width: 14 }}>P</span>
          <span style={{ width: 14 }}>W</span>
          <span style={{ width: 14 }}>D</span>
          <span style={{ width: 14 }}>L</span>
          <span style={{ width: 28 }}>GD</span>
          <span style={{ width: 24 }}>Pts</span>
        </span>
      </div>

      {/* Sortable team list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={groupOrder} strategy={verticalListSortingStrategy}>
          {/* All rows share one parent so restrictToParentElement allows a row
              to be dragged across the whole group. Zone separators are drawn on
              the rows themselves (positions 2 and 3) rather than via wrappers. */}
          <div>
            {orderedTeams.map((team, i) => (
              <TeamRow
                key={team.id}
                position={i + 1}
                team={team}
                standing={standingById[team.id]}
                possibility={possibilityById[team.id]}
                locked={complete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Error message */}
      {errorMsg && <div className="note-error">{errorMsg}</div>}
    </div>
  );
}

