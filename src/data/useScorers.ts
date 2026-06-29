import { useState, useEffect } from 'react';

// Shape produced by scripts/export_json.py → top_scorers() in query.py.
export interface StaticScorer {
  rank: number;
  player_name: string;
  team: string;
  team_code: string;
  team_flag: string;
  goals: number;
  assists: number;
  penalties: number;
}

export interface UseScorersResult {
  scorers: StaticScorer[];
  loading: boolean;
  error: string | null;
}

export function useScorers(): UseScorersResult {
  const [scorers, setScorers] = useState<StaticScorer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/scorers.json')
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
  }, []);

  return { scorers, loading, error };
}
