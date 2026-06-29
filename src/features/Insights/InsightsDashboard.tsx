import { useFixtures, type StaticFixture } from '../../data/useFixtures';
import { useStandings, type StaticStanding } from '../../data/useStandings';
import { useScorers, type StaticScorer } from '../../data/useScorers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  group: 'Group Stage',
  round32: 'Round of 32',
  round16: 'Round of 16',
  quarter: 'Quarter-final',
  semi: 'Semi-final',
  thirdPlacePlayoff: '3rd Place Play-off',
  final: 'Final',
};

function formatKickoff(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
  };
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="insights-section">
      <h2 className="insights-section-title">{title}</h2>
      {children}
    </section>
  );
}

function Skeleton() {
  return <div className="insights-skeleton" aria-busy="true" />;
}

function PanelError({ message }: { message: string }) {
  return <p className="insights-error">Could not load data: {message}</p>;
}

// ---------------------------------------------------------------------------
// Upcoming Fixtures panel
// ---------------------------------------------------------------------------

function FixturesPanel({ fixtures }: { fixtures: StaticFixture[] }) {
  const upcoming = fixtures.filter((f) => !f.played).slice(0, 10);

  const byDate = upcoming.reduce<Record<string, StaticFixture[]>>((acc, f) => {
    const { date } = formatKickoff(f.kickoff);
    (acc[date] ??= []).push(f);
    return acc;
  }, {});

  if (upcoming.length === 0) {
    return <p className="screen-intro">No upcoming fixtures.</p>;
  }

  return (
    <div className="insights-fixtures">
      {Object.entries(byDate).map(([date, matches]) => (
        <div key={date} className="insights-fixture-day">
          <div className="insights-fixture-date">{date}</div>
          {matches.map((f) => {
            const { time } = formatKickoff(f.kickoff);
            const stageLabel = STAGE_LABELS[f.stage] ?? f.stage;
            return (
              <div key={f.match_id} className="insights-fixture-row card">
                <span className="insights-fixture-stage">{stageLabel}</span>
                <span className="insights-fixture-team insights-fixture-team--home">
                  <span className="insights-fixture-flag">{f.home_flag}</span>
                  <span className="insights-fixture-name">{f.home_team}</span>
                </span>
                <span className="insights-fixture-vs">vs</span>
                <span className="insights-fixture-team insights-fixture-team--away">
                  <span className="insights-fixture-name">{f.away_team}</span>
                  <span className="insights-fixture-flag">{f.away_flag}</span>
                </span>
                <span className="insights-fixture-time">{time}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group Standings panel
// ---------------------------------------------------------------------------

function GroupCard({ groupId, rows }: { groupId: string; rows: StaticStanding[] }) {
  const sorted = [...rows].sort((a, b) => {
    if (a.position != null && b.position != null) return a.position - b.position;
    return b.points - a.points;
  });

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-head__title">Group {groupId}</span>
      </div>
      <table className="insights-standings-table tnum">
        <thead>
          <tr>
            <th className="ist-col-team" />
            <th title="Played">P</th>
            <th title="Won">W</th>
            <th title="Drawn">D</th>
            <th title="Lost">L</th>
            <th title="Goal difference">GD</th>
            <th title="Points">Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.code} className={i < 2 ? 'ist-row--qualifies' : ''}>
              <td className="ist-col-team">
                <span className="insights-fixture-flag">{row.flag}</span>
                <span className="ist-team-name">{row.team}</span>
                <span className="ist-team-code">{row.code}</span>
              </td>
              <td>{row.played}</td>
              <td>{row.won}</td>
              <td>{row.drawn}</td>
              <td>{row.lost}</td>
              <td className={row.goal_diff > 0 ? 'ist-pos' : row.goal_diff < 0 ? 'ist-neg' : ''}>
                {row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}
              </td>
              <td className="ist-pts">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandingsPanel({ standings }: { standings: StaticStanding[] }) {
  const byGroup = standings.reduce<Record<string, StaticStanding[]>>((acc, row) => {
    (acc[row.group_id] ??= []).push(row);
    return acc;
  }, {});

  return (
    <div className="group-grid">
      {Object.entries(byGroup)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([groupId, rows]) => (
          <GroupCard key={groupId} groupId={groupId} rows={rows} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Scorers panel
// ---------------------------------------------------------------------------

function ScorersPanel({ scorers }: { scorers: StaticScorer[] }) {
  return (
    <div className="card">
      <table className="insights-scorers-table tnum">
        <thead>
          <tr>
            <th className="ist-col-rank">#</th>
            <th className="ist-col-player">Player</th>
            <th title="Goals">G</th>
            <th title="Assists">A</th>
            <th title="Penalties scored">Pen</th>
          </tr>
        </thead>
        <tbody>
          {scorers.map((s) => (
            <tr key={`${s.player_name}-${s.team_code}`}>
              <td className="ist-col-rank ist-rank">{s.rank}</td>
              <td className="ist-col-player">
                <span className="insights-fixture-flag">{s.team_flag}</span>
                <span className="ist-player-name">{s.player_name}</span>
                <span className="ist-team-code">{s.team_code}</span>
              </td>
              <td className="ist-goals">{s.goals}</td>
              <td>{s.assists}</td>
              <td>{s.penalties || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export function InsightsDashboard() {
  const { fixtures, loading: fLoading, error: fError } = useFixtures();
  const { standings, loading: sLoading, error: sError } = useStandings();
  const { scorers, loading: scLoading, error: scError } = useScorers();

  return (
    <div className="insights-dashboard">
      <p className="screen-intro">
        Live stats and standings from the local database — refreshed whenever you run{' '}
        <code>npm run export:data</code>.
      </p>

      <Section title="Upcoming Fixtures">
        {fLoading && <Skeleton />}
        {fError && <PanelError message={fError} />}
        {!fLoading && !fError && <FixturesPanel fixtures={fixtures} />}
      </Section>

      <Section title="Group Standings">
        {sLoading && <Skeleton />}
        {sError && <PanelError message={sError} />}
        {!sLoading && !sError && <StandingsPanel standings={standings} />}
      </Section>

      <Section title="Top Scorers">
        {scLoading && <Skeleton />}
        {scError && <PanelError message={scError} />}
        {!scLoading && !scError && <ScorersPanel scorers={scorers} />}
      </Section>
    </div>
  );
}
