import { useState } from 'react';
import { usePlayerStats } from '../../data/usePlayerStats';
import { usePlayerRatings } from '../../data/usePlayerRatings';
import type { StaticPlayerStat } from '../../data/usePlayerStats';

type SortKey = 'goals' | 'assists' | 'shots' | 'minutes' | 'matches_played';

function sortStats(rows: StaticPlayerStat[], key: SortKey): StaticPlayerStat[] {
  return [...rows].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
}

function formatName(raw: string): string {
  return raw
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function PlayerStats() {
  const { playerStats, loading: psLoading, error: psError } = usePlayerStats();
  const { playerRatings, loading: prLoading, error: prError } = usePlayerRatings();
  const [sortKey, setSortKey] = useState<SortKey>('goals');

  const loading = psLoading || prLoading;
  const error = psError ?? prError;

  if (loading) {
    return <p className="screen-intro">Loading player stats…</p>;
  }

  if (error) {
    return (
      <p className="screen-intro">
        Could not load player stats ({error}).
      </p>
    );
  }

  const sorted = sortStats(playerStats, sortKey);

  const sortBtn = (key: SortKey, label: string) => (
    <button
      className={`sort-btn${sortKey === key ? ' sort-btn--active' : ''}`}
      onClick={() => setSortKey(key)}
    >
      {label}
    </button>
  );

  return (
    <div className="player-stats-screen">
      <p className="screen-intro">
        Player performance stats for the group stage — sourced from{' '}
        <code>player_stats.json</code>.
        {playerRatings.length > 0 && (
          <> Match ratings from {playerRatings.length} rating entries also loaded.</>
        )}
      </p>

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
              <th title="Team">Team</th>
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
                <td className="pst-col-player">{formatName(p.display_name)}</td>
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
