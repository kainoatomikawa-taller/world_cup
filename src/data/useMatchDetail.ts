import { useState, useEffect } from 'react';
import type { StaticMatchDetail } from './staticTypes';
import { useDataContext } from './DataContext';
import { versionedUrl, STATIC_DATA_BASE } from './api';

export type { StaticMatchDetail };

export interface UseMatchDetailResult {
  detail: StaticMatchDetail | null;
  loading: boolean;
  error: string | null;
}

// Fetches matches/<matchId>.json only when matchId is non-null.
// Returns { detail: null, loading: false, error: null } when matchId is null,
// so callers can conditionally render without extra guards.
export function useMatchDetail(matchId: string | null): UseMatchDetailResult {
  const { contentHash, manifestReady } = useDataContext();
  const [detail, setDetail] = useState<StaticMatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifestReady || !matchId) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = versionedUrl(
      `${STATIC_DATA_BASE}/matches/${matchId}.json`,
      contentHash,
    );
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StaticMatchDetail>;
      })
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load match detail');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manifestReady, contentHash, matchId]);

  return { detail, loading, error };
}
