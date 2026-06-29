import { useState, useEffect } from 'react';

// Shape produced by scripts/export_json.py → all_fixtures() in query.py.
// SQLite doesn't have a boolean type, so `played` is 0 or 1.
export interface StaticFixture {
  match_id: string;
  kickoff: string;
  stage: string;
  group_id: string | null;
  home_team_id: string;
  home_team: string;
  home_code: string;
  home_flag: string;
  home_goals: number | null;
  away_team_id: string;
  away_team: string;
  away_code: string;
  away_flag: string;
  away_goals: number | null;
  played: number;
}

export interface UseFixturesResult {
  fixtures: StaticFixture[];
  loading: boolean;
  error: string | null;
}

// Upgrade path — object storage:
//   Replace the fetch URL below with a CDN/bucket URL (S3, Cloudflare R2,
//   GCS, etc.).  Cache-bust via manifest.json's content_hash as a query
//   param:  `/data/fixtures.json?v=<content_hash>`
//   Everything else in this hook stays the same because the JSON schema is stable.
export function useFixtures(): UseFixturesResult {
  const [fixtures, setFixtures] = useState<StaticFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/fixtures.json')
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
  }, []);

  return { fixtures, loading, error };
}
