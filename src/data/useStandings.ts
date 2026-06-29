import { useState, useEffect } from 'react';
import type { StaticStanding } from './staticTypes';

export type { StaticStanding };

export interface UseStandingsResult {
  standings: StaticStanding[];
  loading: boolean;
  error: string | null;
}

export function useStandings(): UseStandingsResult {
  const [standings, setStandings] = useState<StaticStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/standings.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StaticStanding[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setStandings(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load standings');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { standings, loading, error };
}
