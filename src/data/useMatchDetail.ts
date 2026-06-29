import { useState, useEffect } from 'react';
import type { StaticFixture } from './useFixtures';

// Each matches/<id>.json file has the same shape as an entry in fixtures.json.
export type StaticMatchDetail = StaticFixture;

export interface UseMatchDetailResult {
  detail: StaticMatchDetail | null;
  loading: boolean;
  error: string | null;
}

// Fetches matches/<matchId>.json only when matchId is non-null.
// Returns { detail: null, loading: false, error: null } when matchId is null,
// so callers can conditionally render without extra guards.
export function useMatchDetail(matchId: string | null): UseMatchDetailResult {
  const [detail, setDetail] = useState<StaticMatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/data/matches/${matchId}.json`)
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
  }, [matchId]);

  return { detail, loading, error };
}
