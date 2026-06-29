import { useState, useEffect } from 'react';
import type { StaticPlayerStat } from './staticTypes';
import { useDataContext } from './DataContext';
import { versionedUrl, STATIC_DATA_BASE } from './api';

export type { StaticPlayerStat };

export interface UsePlayerStatsResult {
  playerStats: StaticPlayerStat[];
  loading: boolean;
  error: string | null;
}

export function usePlayerStats(): UsePlayerStatsResult {
  const { contentHash, manifestReady } = useDataContext();
  const [playerStats, setPlayerStats] = useState<StaticPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifestReady) return;
    let cancelled = false;
    const url = versionedUrl(`${STATIC_DATA_BASE}/player_stats.json`, contentHash);
    fetch(url)
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
  }, [manifestReady, contentHash]);

  return { playerStats, loading, error };
}
