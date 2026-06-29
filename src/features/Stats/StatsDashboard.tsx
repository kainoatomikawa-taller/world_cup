import { useState, useMemo } from 'react';
import { usePlayerStats } from '../../data/usePlayerStats';
import { usePlayerRatings } from '../../data/usePlayerRatings';
import { useStandings } from '../../data/useStandings';
import type { StaticPlayerStat } from '../../data/usePlayerStats';
import type { StaticPlayerRating } from '../../data/usePlayerRatings';
import type { StaticStanding } from '../../data/useStandings';

// ── Types ────────────────────────────────────────────────────────────

type TeamSortKey = 'goals_for' | 'goals_against' | 'goal_diff' | 'points';
type PlayerSortKey = 'goals' | 'assists' | 'shots' | 'minutes' | 'matches_played';

interface RatingEntry {
  playerId: string;
  displayName: string;
  teamCode: string;
  source: string;
  avgRating: number;
  matchCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildNameMap(stats: StaticPlayerStat[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of stats) {
    map[p.player_id] = formatSlug(p.display_name);
  }
  return map;
}

function buildRatingsBoard(
  ratings: StaticPlayerRating[],
  nameMap: Record<string, string>,
): RatingEntry[] {
  const acc: Record<
    string,
    { playerId: string; teamCode: string; source: string; sum: number; count: number }
  > = {};

  for (const r of ratings) {
    const key = `${r.player_id}::${r.source}`;
    acc[key] ??= {
      playerId: r.player_id,
      teamCode: r.team_code,
      source: r.source,
      sum: 0,
      count: 0,
    };
    acc[key].sum += r.rating;
    acc[key].count++;
  }

  return Object.values(acc)
    .map((a) => ({
      playerId: a.playerId,
      displayName: nameMap[a.playerId] ?? formatSlug(a.playerId),
      teamCode: a.teamCode,
      source: a.source,
      avgRating: a.sum / a.count,
      matchCount: a.count,
    }))
    .sort((x, y) => y.avgRating - x.avgRating)
    .slice(0, 20);
}

function ratingClass(r: number): string {
  if (r >= 7.5) return 'lineup-rating--high';
  if (r >= 6.5) return 'lineup-rating--mid';
  return 'lineup-rating--low';
}

// ── Shared primitives ────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="insights-section">
      <h2 className="insights-section-title">{title}</h2>
      {children}
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="stats-subsection">
      <h3 className="stats-subsection-title">{title}</h3>
      {children}
    </div>
  );
}

function Skeleton() {
  return <div className="insights-skeleton" aria-busy="true" />;
}

function PanelError({ message }: { message: string }) {
  return (
    <p className="insights-error">
      Could not load data: <code>{message}</code>
    </p>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="card stats-empty-state">
      <p className="stats-empty-msg">{message}</p>
    </div>
  );
}

// ── Team Stats panel ─────────────────────────────────────────────────

function TeamStatsPanel({ standings }: { standings: StaticStanding[] }) {
  const [sortKey, setSortKey] = useState<TeamSortKey>('goals_for');

  const sorted = useMemo(() => {
    const copy = [...standings];
    if (sortKey === 'goals_against') {
      copy.sort((a, b) => a[sortKey] - b[sortKey]);
    } else {
      copy.sort((a, b) => b[sortKey] - a[sortKey]);
    }
    return copy;
  }, [standings, sortKey]);

  if (standings.length === 0) {
    return (
      <EmptyState message="Team stats are not yet available. Run the data pipeline to populate standings.json." />
    );
  }

  const sortBtn = (key: TeamSortKey, label: string) => (
    <button
      key={key}
      className={`sort-btn${sortKey === key ? ' sort-btn--active' : ''}`}
      onClick={() => setSortKey(key)}
    >
      {label}
    </button>
  );

  return (
    <div className="stats-team-section">
      <div className="sort-controls">
        {sortBtn('goals_for', 'Goals Scored')}
        {sortBtn('goals_against', 'Goals Conceded')}
        {sortBtn('goal_diff', 'Goal Diff')}
        {sortBtn('points', 'Points')}
      </div>
      <div className="card">
        <table className="player-stats-table tnum">
          <thead>
            <tr>
              <th className="pst-col-player">Team</th>
              <th title="Group">Grp</th>
              <th title="Matches played">P</th>
              <th title="Goals scored">GF</th>
              <th title="Goals against">GA</th>
              <th title="Goal difference">GD</th>
              <th title="Points">Pts</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={`${row.group_id}-${row.code}`}>
                <td className="pst-col-player">
                  <span className="stats-rank">{i + 1}</span>
                  <span className="stats-flag">{row.flag}</span>
                  <span>{row.team}</span>
                  <span className="stats-code">{row.code}</span>
                </td>
                <td>{row.group_id}</td>
                <td>{row.played}</td>
                <td className={sortKey === 'goals_for' ? 'stats-highlight' : ''}>
                  {row.goals_for}
                </td>
                <td className={sortKey === 'goals_against' ? 'stats-highlight' : ''}>
                  {row.goals_against}
                </td>
                <td
                  className={[
                    sortKey === 'goal_diff' ? 'stats-highlight' : '',
                    row.goal_diff > 0 ? 'ist-pos' : row.goal_diff < 0 ? 'ist-neg' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}
                </td>
                <td className={`ist-pts${sortKey === 'points' ? ' stats-highlight' : ''}`}>
                  {row.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Top Ratings panel ────────────────────────────────────────────────

function RatingsPanel({
  ratings,
  nameMap,
}: {
  ratings: StaticPlayerRating[];
  nameMap: Record<string, string>;
}) {
  const entries = useMemo(() => buildRatingsBoard(ratings, nameMap), [ratings, nameMap]);

  if (entries.length === 0) {
    return (
      <EmptyState message="Player ratings are not yet available. Enrich match data to populate player_ratings.json." />
    );
  }

  return (
    <div className="card">
      <table className="player-stats-table tnum">
        <thead>
          <tr>
            <th className="stats-col-rank">#</th>
            <th className="pst-col-player">Player</th>
            <th>Team</th>
            <th>Source</th>
            <th title="Average rating across all rated matches">Rating</th>
            <th title="Matches rated">MP</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={`${e.playerId}::${e.source}`}>
              <td className="stats-col-rank">{i + 1}</td>
              <td className="pst-col-player">{e.displayName}</td>
              <td>{e.teamCode}</td>
              <td className="stats-source">{e.source}</td>
              <td>
                <span className={`lineup-rating ${ratingClass(e.avgRating)}`}>
                  {e.avgRating.toFixed(2)}
                </span>
              </td>
              <td>{e.matchCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Most Touches panel ───────────────────────────────────────────────

function TouchesPanel() {
  return (
    <EmptyState message="Touch data is not available in the current static export. Per-match player stats are needed to compute this leaderboard — enrich the database and re-export to enable it." />
  );
}

// ── Player Performance panel ─────────────────────────────────────────

function PlayerPerformancePanel({ stats }: { stats: StaticPlayerStat[] }) {
  const [sortKey, setSortKey] = useState<PlayerSortKey>('goals');

  if (stats.length === 0) {
    return <EmptyState message="Player performance data is not yet available." />;
  }

  const sorted = [...stats].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  const sortBtn = (key: PlayerSortKey, label: string) => (
    <button
      className={`sort-btn${sortKey === key ? ' sort-btn--active' : ''}`}
      onClick={() => setSortKey(key)}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="sort-controls">
        {sortBtn('goals', 'Goals')}
        {sortBtn('assists', 'Assists')}
        {sortBtn('shots', 'Shots')}
        {sortBtn('minutes', 'Minutes')}
        {sortBtn('matches_played', 'Matches')}
      </div>
      <div className="card">
        <table className="player-stats-table tnum">
          <thead>
            <tr>
              <th className="pst-col-player">Player</th>
              <th>Team</th>
              <th title="Matches played">MP</th>
              <th title="Minutes played">Min</th>
              <th title="Goals">G</th>
              <th title="Assists">A</th>
              <th title="Shots">Sh</th>
              <th title="Shots on target">SoT</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.player_id}>
                <td className="pst-col-player">{formatSlug(p.display_name)}</td>
                <td>{p.team_code}</td>
                <td>{p.matches_played}</td>
                <td>{p.minutes}</td>
                <td>{p.goals}</td>
                <td>{p.assists}</td>
                <td>{p.shots}</td>
                <td>{p.shots_on_target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main dashboard ───────────────────────────────────────────────────

export function StatsDashboard() {
  const { standings, loading: sLoading, error: sError } = useStandings();
  const { playerStats, loading: psLoading, error: psError } = usePlayerStats();
  const { playerRatings, loading: prLoading, error: prError } = usePlayerRatings();

  const loading = sLoading || psLoading || prLoading;

  const nameMap = useMemo(() => buildNameMap(playerStats), [playerStats]);

  if (loading) {
    return (
      <div className="insights-dashboard">
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="insights-dashboard">
      <p className="screen-intro">
        Tournament-wide statistics. Team stats are drawn from group-stage standings;
        player ratings are averaged across all rated matches.
      </p>

      <Section title="Team Stats">
        {sError ? <PanelError message={sError} /> : <TeamStatsPanel standings={standings} />}
      </Section>

      <Section title="Individual Stats">
        <Subsection title="Top Player Ratings">
          {prError ? (
            <PanelError message={prError} />
          ) : (
            <RatingsPanel ratings={playerRatings} nameMap={nameMap} />
          )}
        </Subsection>

        <Subsection title="Most Touches">
          <TouchesPanel />
        </Subsection>

        <Subsection title="Player Performance">
          {psError ? (
            <PanelError message={psError} />
          ) : (
            <PlayerPerformancePanel stats={playerStats} />
          )}
        </Subsection>
      </Section>
    </div>
  );
}
