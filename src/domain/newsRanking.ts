import type { StaticArticle } from '../data/staticTypes';
import { selectClusterRepresentative } from './newsClustering';

// ---------------------------------------------------------------------------
// Story-cluster priority ranking — pure TypeScript, no React, no network.
//
// Four signals combine into a weighted priority score in [0, 1]:
//
//   priority = (sourceCoverage × w1) + (recencyDecay × w2)
//            + (sourceWeight  × w3) + (fixtureRelevance × w4)
//
// Default weights: w1=0.40, w2=0.25, w3=0.15, w4=0.20
// Cross-source coverage (distinct outlets per cluster) is the primary signal.
//
// The Python pipeline (rank_news.py) computes the same formula and writes an
// integer priority (0–1000) back to the news table, so news.json arrives
// pre-ranked.  This module mirrors that logic for Vitest coverage and
// optional client-side re-ranking after cluster collapsing.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of configured RSS feed sources — used to normalise coverage signal. */
const MAX_SOURCES = 4;

/** Exponential-decay half-life for the recency signal (hours). */
export const RECENCY_HALF_LIFE_HOURS = 12;

/** Upcoming-match window for fixture_relevance (hours before kickoff). */
export const UPCOMING_WINDOW_HOURS = 24;

/** Just-played window for fixture_relevance (hours after kickoff). */
export const JUST_PLAYED_WINDOW_HOURS = 6;

/**
 * Outlet tier weights.  Unlisted outlets fall back to DEFAULT_SOURCE_WEIGHT.
 * Tiers are based on reach and editorial consistency.
 */
export const SOURCE_TIER_WEIGHTS: Readonly<Record<string, number>> = {
  'espn':       1.0,
  'bbc-sport':  1.0,
  'sky-sports': 0.8,
  'fox-sports': 0.8,
};

export const DEFAULT_SOURCE_WEIGHT = 0.5;

/**
 * Stage importance multiplier for fixture_relevance.
 * Applied on top of the raw proximity score, then capped at 1.0.
 * Later-round matches surface more prominently even if the kickoff is further away.
 */
export const STAGE_IMPORTANCE: Readonly<Record<string, number>> = {
  final:              2.0,
  semi:               1.5,
  thirdPlacePlayoff:  1.2,
  quarter:            1.3,
  round16:            1.1,
  round32:            1.05,
  group:              1.0,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankingWeights {
  /** w1 — cross-source coverage (primary signal). */
  sourceCoverage: number;
  /** w2 — exponential freshness decay. */
  recencyDecay: number;
  /** w3 — outlet tier quality. */
  sourceWeight: number;
  /** w4 — proximity to upcoming or recently-finished match. */
  fixtureRelevance: number;
}

export const DEFAULT_WEIGHTS: Readonly<RankingWeights> = {
  sourceCoverage:   0.40,
  recencyDecay:     0.25,
  sourceWeight:     0.15,
  fixtureRelevance: 0.20,
};

/** Minimal fixture shape needed for relevance scoring. Compatible with StaticFixture. */
export interface RankableFixture {
  stage: string;
  kickoff: string;     // ISO 8601
  played: number;      // 0 = unplayed, 1 = played (SQLite boolean)
  home_team_id: string;
  away_team_id: string;
}

/** Aggregate descriptor for a cluster of articles. */
export interface ClusterDescriptor {
  /** Source slug for every article in the cluster (may include duplicates). */
  sources: string[];
  /** ISO 8601 timestamp of the most-recently-published article in the cluster. */
  mostRecentPublishedAt: string;
  /** Union of all team slugs mentioned across cluster articles. */
  teams: string[];
}

// ---------------------------------------------------------------------------
// Signal 1 — source coverage (cross-outlet reach)
// ---------------------------------------------------------------------------

/**
 * Cross-source coverage: fraction of configured outlets that cover this cluster.
 *
 * Returns 0 for a single source, 1 when all configured outlets cover the story.
 * Duplicates in `sources` are deduplicated before scoring.
 *
 * @param sources  Source slugs from every article in the cluster.
 * @returns        Score in [0, 1].
 */
export function sourceCoverageSignal(sources: string[]): number {
  const n = new Set(sources).size;
  if (n <= 0 || MAX_SOURCES <= 1) return 0;
  return Math.min(1, (n - 1) / (MAX_SOURCES - 1));
}

// ---------------------------------------------------------------------------
// Signal 2 — recency decay
// ---------------------------------------------------------------------------

/**
 * True half-life exponential freshness decay.
 *
 * Uses 2^(−age/half_life) so the score halves exactly every RECENCY_HALF_LIFE_HOURS:
 * at age 0 h → 1.0; at 12 h → 0.5; at 24 h → 0.25; at 36 h → 0.125.
 * Clamped to [0, 1] so future-dated articles don't inflate the score.
 *
 * @param mostRecentPublishedAt  ISO 8601 timestamp.
 * @param nowMs                  Current wall-clock in milliseconds (required for determinism).
 * @returns                      Score in [0, 1].
 */
export function recencyDecaySignal(mostRecentPublishedAt: string, nowMs: number): number {
  const ageMs = nowMs - new Date(mostRecentPublishedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return Math.min(1, Math.max(0, Math.exp(-Math.LN2 * ageHours / RECENCY_HALF_LIFE_HOURS)));
}

// ---------------------------------------------------------------------------
// Signal 3 — source tier weight
// ---------------------------------------------------------------------------

/**
 * Best-tier outlet weight among all sources in the cluster.
 *
 * Takes the highest pre-defined weight (ESPN/BBC=1.0, Sky/Fox=0.8, other=0.5).
 * A cluster gains no penalty for including lower-tier sources.
 *
 * @param sources  Source slugs (may be from multiple articles).
 * @returns        Score in [0, 1]; 0 for empty input.
 */
export function sourceWeightSignal(sources: string[]): number {
  return sources.reduce(
    (best, src) => Math.max(best, SOURCE_TIER_WEIGHTS[src] ?? DEFAULT_SOURCE_WEIGHT),
    0,
  );
}

// ---------------------------------------------------------------------------
// Signal 4 — fixture relevance
// ---------------------------------------------------------------------------

/**
 * Proximity to an upcoming or just-finished match involving a cluster team.
 *
 * Scoring windows:
 *   Upcoming  — linearly scales from 0 at UPCOMING_WINDOW_HOURS before kickoff
 *               to 1 at the moment of kickoff.
 *   Just played — linearly scales from 1 at kickoff to 0 at JUST_PLAYED_WINDOW_HOURS
 *               after kickoff.
 *
 * The raw proximity is multiplied by the stage importance factor, then capped
 * at 1.0.  Knockout-stage matches surface more aggressively.
 *
 * @param clusterTeams  Team slugs mentioned across the cluster (deduplicated by caller).
 * @param fixtures      All known fixtures (played and unplayed).
 * @param nowMs         Current wall-clock in milliseconds.
 * @returns             Score in [0, 1].
 */
export function fixtureRelevanceSignal(
  clusterTeams: string[],
  fixtures: RankableFixture[],
  nowMs: number,
): number {
  if (clusterTeams.length === 0 || fixtures.length === 0) return 0;

  const teamSet = new Set(clusterTeams);
  let best = 0;

  for (const fix of fixtures) {
    if (!teamSet.has(fix.home_team_id) && !teamSet.has(fix.away_team_id)) continue;

    const kickMs = new Date(fix.kickoff).getTime();
    const stageMult = STAGE_IMPORTANCE[fix.stage] ?? 1.0;
    let rawRelevance = 0;

    if (fix.played === 0) {
      // Upcoming: proximity grows as kickoff approaches.
      const hoursToKick = (kickMs - nowMs) / (1000 * 60 * 60);
      if (hoursToKick >= 0 && hoursToKick <= UPCOMING_WINDOW_HOURS) {
        rawRelevance = 1 - hoursToKick / UPCOMING_WINDOW_HOURS;
      }
    } else {
      // Just played: relevance fades after kickoff.
      const hoursAfterKick = (nowMs - kickMs) / (1000 * 60 * 60);
      if (hoursAfterKick >= 0 && hoursAfterKick <= JUST_PLAYED_WINDOW_HOURS) {
        rawRelevance = 1 - hoursAfterKick / JUST_PLAYED_WINDOW_HOURS;
      }
    }

    if (rawRelevance > 0) {
      best = Math.max(best, Math.min(1, rawRelevance * stageMult));
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Combined scorer
// ---------------------------------------------------------------------------

/**
 * Weighted combination of all four signals for a single cluster.
 *
 * @param cluster   Aggregate descriptor for the cluster.
 * @param fixtures  All known fixtures.
 * @param weights   Signal weights (default: DEFAULT_WEIGHTS).
 * @param nowMs     Current wall-clock in milliseconds.
 * @returns         Priority score in [0, 1].
 */
export function scoreCluster(
  cluster: ClusterDescriptor,
  fixtures: RankableFixture[],
  weights: RankingWeights = DEFAULT_WEIGHTS,
  nowMs: number,
): number {
  const sc = sourceCoverageSignal(cluster.sources);
  const rd = recencyDecaySignal(cluster.mostRecentPublishedAt, nowMs);
  const sw = sourceWeightSignal(cluster.sources);
  const fr = fixtureRelevanceSignal(cluster.teams, fixtures, nowMs);
  return sc * weights.sourceCoverage
       + rd * weights.recencyDecay
       + sw * weights.sourceWeight
       + fr * weights.fixtureRelevance;
}

// ---------------------------------------------------------------------------
// Full pipeline: group → score → collapse → sort
// ---------------------------------------------------------------------------

/**
 * Rank and collapse a flat list of articles into one card per story cluster.
 *
 * Groups articles by cluster_id, scores each cluster with the four-signal
 * formula, selects the best representative article per cluster, and returns
 * them sorted by score descending.  Ties break deterministically on the
 * cluster key (lexicographic, ascending) so output order is stable across
 * identical inputs.
 *
 * Articles with cluster_id === null are treated as singleton clusters.
 *
 * @param articles  All fetched articles (may contain multiple per cluster).
 * @param fixtures  All known fixtures (for fixture_relevance signal).
 * @param weights   Signal weights (default: DEFAULT_WEIGHTS).
 * @param nowMs     Current wall-clock in milliseconds (default: Date.now()).
 * @returns         One article per cluster, highest priority first.
 */
export function rankAndCollapseNews(
  articles: StaticArticle[],
  fixtures: RankableFixture[],
  weights: RankingWeights = DEFAULT_WEIGHTS,
  nowMs: number = Date.now(),
): StaticArticle[] {
  // Group by cluster_id; null-cluster articles become singleton groups.
  const groups = new Map<string, StaticArticle[]>();
  for (const article of articles) {
    const key = article.cluster_id ?? `__solo__${article.id}`;
    const group = groups.get(key) ?? [];
    group.push(article);
    groups.set(key, group);
  }

  // Score each cluster and pick its representative.
  const scored: Array<{ rep: StaticArticle; score: number; key: string }> = [];
  for (const [key, group] of groups) {
    const sources = group.map((a) => a.source);
    const mostRecentPublishedAt = group.reduce(
      (best, a) => (a.published_at > best ? a.published_at : best),
      '',
    );
    const teams = [...new Set(group.flatMap((a) => a.teams))];

    const score = scoreCluster({ sources, mostRecentPublishedAt, teams }, fixtures, weights, nowMs);
    const rep = selectClusterRepresentative(group);
    scored.push({ rep, score, key });
  }

  // Sort by score DESC; break ties with cluster key ASC for determinism.
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 1e-10) return diff;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return scored.map((s) => s.rep);
}
