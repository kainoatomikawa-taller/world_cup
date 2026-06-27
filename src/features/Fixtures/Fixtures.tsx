import { useTournamentStore } from '../../store/tournamentStore';
import { groupFixtures } from '../../domain/fixtures';
import type { Match, Team } from '../../domain/types';

function formatKickoff(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function FixtureRow({
  match,
  teams,
}: {
  match: Match;
  teams: Record<string, Team>;
}) {
  const home = teams[match.homeId];
  const away = teams[match.awayId];

  return (
    <div className={`fixture-row${match.played ? ' fixture-row--played' : ''}`}>
      <span className="fixture-team fixture-team--home">
        <span className="fixture-team__flag">{home?.flag}</span>
        <span className="fixture-team__name">{home?.name ?? match.homeId}</span>
      </span>

      <span className="fixture-center tnum">
        {match.groupId && (
          <span className="group-badge fixture-group-badge">{match.groupId}</span>
        )}
        <span className="fixture-score">
          {match.played
            ? `${match.homeGoals} – ${match.awayGoals}`
            : formatKickoff(match.kickoff)}
        </span>
      </span>

      <span className="fixture-team fixture-team--away">
        <span className="fixture-team__name">{away?.name ?? match.awayId}</span>
        <span className="fixture-team__flag">{away?.flag}</span>
      </span>
    </div>
  );
}

export function Fixtures() {
  const matches = useTournamentStore((s) => s.matches);
  const teams = useTournamentStore((s) => s.teams);
  const groups = groupFixtures(matches);

  if (groups.length === 0) {
    return (
      <p className="screen-intro">
        No fixtures loaded — scores will appear once live data is available.
      </p>
    );
  }

  return (
    <div className="fixtures-screen">
      {groups.map((group) => (
        <section key={group.label} className="fixture-group">
          <h2 className="fixture-group__label">{group.label}</h2>
          <div className="card fixture-list">
            {group.matches.map((match) => (
              <FixtureRow key={match.id} match={match} teams={teams} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
