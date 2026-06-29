import { useState, useEffect } from 'react';
import type { StaticArticle } from './staticTypes';
import { useDataContext } from './DataContext';
import { versionedUrl, STATIC_DATA_BASE } from './api';
import { collapseNewsClusters } from '../domain/newsClustering';

export type { StaticArticle };

export interface UseInsightsResult {
  articles: StaticArticle[];
  loading: boolean;
  error: string | null;
}

export function useInsights(): UseInsightsResult {
  const { contentHash, manifestReady } = useDataContext();
  const [articles, setArticles] = useState<StaticArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifestReady) return;
    let cancelled = false;
    const url = versionedUrl(`${STATIC_DATA_BASE}/news.json`, contentHash);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StaticArticle[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setArticles(collapseNewsClusters(data));
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load news');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manifestReady, contentHash]);

  return { articles, loading, error };
}
