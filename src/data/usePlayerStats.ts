import { useState, useEffect } from 'react';

// Shape produced by scripts/export_json.py → enriched_player_stats() in query.py.
export interface StaticPlayerStat {
  player_id: string;
  display_name: string;
  source: string | null;
  team: string;
  team_code: string;
  matches_played: number;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  passes: number;
  pass_accuracy: number | null;
}

export interface UsePlayerStatsResult {
  playerStats: StaticPlayerStat[];
  loading: boolean;
  error: string | null;
}

export function usePlayerStats(): UsePlayerStatsResult {
  const [playerStats, setPlayerStats] = useState<StaticPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/player_stats.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StaticPlayerStat[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setPlayerStats(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load player stats');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { playerStats, loading, error };
}
