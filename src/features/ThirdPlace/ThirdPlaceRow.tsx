import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ThirdPlaceEntry } from '../../domain/thirdPlace';
import type { Team } from '../../domain/types';

interface Props {
  rank: number;
  entry: ThirdPlaceEntry;
  team?: Team;
  advancing: boolean;
  locked: boolean;
  /** True when this row is at the first position that makes the ranking infeasible. */
  infeasible?: boolean;
}

export function ThirdPlaceRow({ rank, entry, team, advancing, locked, infeasible }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.teamId, disabled: locked });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    cursor: locked ? 'default' : 'grab',
  };

  const className = [
    'tp-row',
    advancing ? 'is-advancing' : 'is-out',
    locked ? 'is-locked' : '',
    infeasible ? 'is-infeasible' : '',
    isDragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
      {...(locked ? {} : { ...attributes, ...listeners })}
    >
      <span className="tp-rank">{rank}</span>
      <span className="group-badge">{entry.groupId}</span>
      <span className="row-flag">{team?.flag ?? '🏳️'}</span>
      <span className="tp-name">{team?.name ?? entry.teamId}</span>

      <span className="tp-stats tnum">
        <span title="Matches played" style={{ minWidth: 20, textAlign: 'right' }}>{entry.played}</span>
        <span className="pts" title="Points">{entry.points}</span>
        <span title="Goal difference" style={{ minWidth: 28, textAlign: 'right' }}>
          {entry.goalDifference > 0 ? `+${entry.goalDifference}` : entry.goalDifference}
        </span>
        <span title="Goals scored" style={{ minWidth: 20, textAlign: 'right' }}>
          {entry.goalsFor}
        </span>
      </span>

      {advancing && <span className="badge-advance">ADVANCE</span>}
    </div>
  );
}
