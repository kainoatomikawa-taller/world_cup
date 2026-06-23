import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PlacementPossibility, Standing, Team } from '../../domain/types';

interface Props {
  position: number;
  team: Team;
  standing?: Standing;
  possibility?: PlacementPossibility;
  locked: boolean;
}

export function TeamRow({ position, team, standing, possibility, locked }: Props) {
  const draggable = !locked && Boolean(
    possibility?.canFinish1st || possibility?.canFinish2nd ||
    possibility?.canFinish3rd || possibility?.canFinish4th,
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: team.id, disabled: locked });

  // Only dnd-kit's dynamic values stay inline; visuals live in App.css.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const className = [
    'team-row',
    locked ? 'is-locked' : '',
    !locked && !draggable ? 'is-static' : '',
    isDragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
      {...(locked ? {} : { ...attributes, ...listeners })}
    >
      <span className="row-pos">{position}</span>
      <span className="row-flag">{team.flag ?? '🏳️'}</span>
      <span className="row-name">{team.name}</span>
      {standing && standing.played > 0 ? (
        <span className="row-stats tnum">
          <span title="Played">{standing.played}</span>
          <span title="Won">{standing.won}</span>
          <span title="Drawn">{standing.drawn}</span>
          <span title="Lost">{standing.lost}</span>
          <span title="Goal difference" style={{ width: 28, textAlign: 'right' }}>
            {standing.goalDifference > 0 ? `+${standing.goalDifference}` : standing.goalDifference}
          </span>
          <span className="pts" title="Points">{standing.points}</span>
        </span>
      ) : (
        <span className="row-stats__empty">P W D L GD Pts</span>
      )}
    </div>
  );
}
