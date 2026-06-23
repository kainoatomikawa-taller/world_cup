import type { BracketSlot, Team } from '../../domain/types';

interface Props {
  slot: BracketSlot;
  teams: Record<string, Team>;
  onPick: (teamId: string) => void;
}

const STAGE_SHORT: Record<string, string> = {
  round32: 'R32',
  round16: 'R16',
  quarter: 'QF',
  semi:    'SF',
  thirdPlacePlayoff: '3rd Place',
  final:   'Final',
};

interface RowProps {
  teamId?: string;
  teams: Record<string, Team>;
  isWinner: boolean;
  isLoser: boolean;
  locked: boolean;
  onClick: () => void;
}

function TeamRow({ teamId, teams, isWinner, isLoser, locked, onClick }: RowProps) {
  const team = teamId ? teams[teamId] : undefined;

  if (!teamId) {
    return (
      <div className="match-team is-tbd">
        <span className="match-team__name">— TBD</span>
      </div>
    );
  }

  const className = [
    'match-team',
    isWinner ? 'is-winner' : '',
    isLoser ? 'is-loser' : '',
    locked ? 'is-locked' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} onClick={locked ? undefined : onClick}>
      <span className="match-team__flag">{team?.flag ?? '🏳️'}</span>
      <span className="match-team__name">{team?.name ?? teamId}</span>
      {isWinner && <span className="match-team__check">✓</span>}
    </div>
  );
}

export function BracketMatch({ slot, teams, onPick }: Props) {
  const { homeId, awayId, winnerId, locked, matchId, stage } = slot;

  return (
    <div className="match-card">
      <div className="match-head">
        <span className="match-head__stage">{STAGE_SHORT[stage] ?? stage}</span>
        <span className="match-head__id">#{matchId}</span>
      </div>

      <TeamRow
        teamId={homeId}
        teams={teams}
        isWinner={Boolean(winnerId && winnerId === homeId)}
        isLoser={Boolean(winnerId && winnerId !== homeId && homeId !== undefined)}
        locked={locked}
        onClick={() => homeId && onPick(homeId)}
      />

      <TeamRow
        teamId={awayId}
        teams={teams}
        isWinner={Boolean(winnerId && winnerId === awayId)}
        isLoser={Boolean(winnerId && winnerId !== awayId && awayId !== undefined)}
        locked={locked}
        onClick={() => awayId && onPick(awayId)}
      />
    </div>
  );
}
