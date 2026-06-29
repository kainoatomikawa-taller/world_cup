import type { StaticArticle } from '../data/staticTypes';

// ---------------------------------------------------------------------------
// Story cluster collapsing — pure TypeScript, no React, no network.
//
// The Python pipeline (cluster_news.py) assigns cluster_id to articles that
// cover the same story across multiple outlets.  This module:
//   1. Groups articles by cluster_id.
//   2. Picks one representative per cluster (scored by thumbnail, summary
//      length, and recency — see representativeScore).
//   3. Returns unclustered articles (cluster_id === null) unchanged.
//   4. Sorts the final list by published_at DESC.
//
// This keeps the UI at one card per story rather than N near-duplicate cards.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal scoring helper
// ---------------------------------------------------------------------------

function representativeScore(article: StaticArticle): number {
  let score = 0;
  // Thumbnail presence is the strongest signal: a card with an image is
  // substantially more engaging than a text-only card.
  if (article.thumbnail_url) score += 2;
  // Longer summaries (up to 3 bonus points) give users more context.
  if (article.summary) {
    score += Math.min(3, Math.floor(article.summary.length / 80));
  }
  // Recency bonus (0–1) over a 7-day window so freshness is a tiebreaker
  // but doesn't override the structural signals above.
  const ageMs = Date.now() - new Date(article.published_at).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  score += Math.max(0, 1 - ageMs / sevenDaysMs);
  return score;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the single best article from a cluster of related articles.
 *
 * Scoring priority: thumbnail present (+2) > summary length (+0–3) >
 * recency (+0–1).  On a tie the first article (stable input order) wins.
 */
export function selectClusterRepresentative(cluster: StaticArticle[]): StaticArticle {
  if (cluster.length === 0) throw new RangeError('cluster must be non-empty');
  return cluster.reduce((best, current) =>
    representativeScore(current) > representativeScore(best) ? current : best
  );
}

/**
 * Collapse a flat list of articles into one card per story cluster.
 *
 * - Articles with a cluster_id are grouped; only the best representative
 *   from each group is kept.
 * - Articles with cluster_id === null are passed through unchanged.
 * - Output is sorted by priority DESC (Python-computed rank), then
 *   published_at DESC as a tiebreaker within the same priority tier.
 */
export function collapseNewsClusters(articles: StaticArticle[]): StaticArticle[] {
  const clusters = new Map<string, StaticArticle[]>();
  const solo: StaticArticle[] = [];

  for (const article of articles) {
    if (article.cluster_id === null) {
      solo.push(article);
    } else {
      const group = clusters.get(article.cluster_id) ?? [];
      group.push(article);
      clusters.set(article.cluster_id, group);
    }
  }

  const representatives: StaticArticle[] = [];
  for (const group of clusters.values()) {
    representatives.push(selectClusterRepresentative(group));
  }

  return [...representatives, ...solo].sort((a, b) => {
    const pDiff = b.priority - a.priority;
    if (pDiff !== 0) return pDiff;
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
  });
}
