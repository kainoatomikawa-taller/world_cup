import { useState, useEffect } from 'react';
import type { StaticScorer } from './staticTypes';
import { useDataContext } from './DataContext';
import { versionedUrl, STATIC_DATA_BASE } from './api';

export type { StaticScorer };

export interface UseScorersResult {
  scorers: StaticScorer[];
  loading: boolean;
  error: string | null;
}

export function useScorers(): UseScorersResult {
  const { contentHash, manifestReady } = useDataContext();
  const [scorers, setScorers] = useState<StaticScorer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifestReady) return;
    let cancelled = false;
    const url = versionedUrl(`${STATIC_DATA_BASE}/scorers.json`, contentHash);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StaticScorer[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setScorers(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load scorers');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manifestReady, contentHash]);

  return { scorers, loading, error };
}
