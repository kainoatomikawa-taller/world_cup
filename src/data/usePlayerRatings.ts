import { useState, useEffect } from 'react';
import type { StaticPlayerRating } from './staticTypes';
import { useDataContext } from './DataContext';
import { versionedUrl, STATIC_DATA_BASE } from './api';

export type { StaticPlayerRating };

export interface UsePlayerRatingsResult {
  playerRatings: StaticPlayerRating[];
  loading: boolean;
  error: string | null;
}

export function usePlayerRatings(): UsePlayerRatingsResult {
  const { contentHash, manifestReady } = useDataContext();
  const [playerRatings, setPlayerRatings] = useState<StaticPlayerRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifestReady) return;
    let cancelled = false;
    const url = versionedUrl(`${STATIC_DATA_BASE}/player_ratings.json`, contentHash);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StaticPlayerRating[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setPlayerRatings(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load player ratings');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manifestReady, contentHash]);

  return { playerRatings, loading, error };
}
