import { useState, useEffect } from 'react';
import type { StaticFixture } from './staticTypes';
import { useDataContext } from './DataContext';
import { versionedUrl, STATIC_DATA_BASE } from './api';

export type { StaticFixture };

export interface UseFixturesResult {
  fixtures: StaticFixture[];
  loading: boolean;
  error: string | null;
}

export function useFixtures(): UseFixturesResult {
  const { contentHash, manifestReady } = useDataContext();
  const [fixtures, setFixtures] = useState<StaticFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifestReady) return;
    let cancelled = false;
    const url = versionedUrl(`${STATIC_DATA_BASE}/fixtures.json`, contentHash);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StaticFixture[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setFixtures(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load fixtures');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manifestReady, contentHash]);

  return { fixtures, loading, error };
}
