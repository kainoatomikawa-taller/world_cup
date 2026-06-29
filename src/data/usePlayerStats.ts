import { useState, useEffect } from 'react';
import type { StaticPlayerStat } from './staticTypes';

export type { StaticPlayerStat };

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
