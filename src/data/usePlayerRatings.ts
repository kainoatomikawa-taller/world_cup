import { useState, useEffect } from 'react';

// Shape produced by scripts/export_json.py → all_player_ratings() in query.py.
// This file is empty until ingest_stats.py populates the player_ratings table.
export interface StaticPlayerRating {
  player_id: string;
  team: string;
  team_code: string;
  match_id: string;
  source: string;
  rating: number;
}

export interface UsePlayerRatingsResult {
  playerRatings: StaticPlayerRating[];
  loading: boolean;
  error: string | null;
}

export function usePlayerRatings(): UsePlayerRatingsResult {
  const [playerRatings, setPlayerRatings] = useState<StaticPlayerRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/player_ratings.json')
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
  }, []);

  return { playerRatings, loading, error };
}
