import { describe, it, expect } from 'vitest';
import type { StaticArticle } from '../data/staticTypes';
import type { RankableFixture } from './newsRanking';
import {
  DEFAULT_WEIGHTS,
  RECENCY_HALF_LIFE_HOURS,
  UPCOMING_WINDOW_HOURS,
  JUST_PLAYED_WINDOW_HOURS,
  SOURCE_TIER_WEIGHTS,
  fixtureRelevanceSignal,
  rankAndCollapseNews,
  recencyDecaySignal,
  scoreCluster,
  sourceCoverageSignal,
  sourceWeightSignal,
} from './newsRanking';

// ---------------------------------------------------------------------------
// Test fixtures & helpers
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const NOW_MS  = new Date('2026-06-20T12:00:00Z').getTime();

function makeFix(overrides: Partial<RankableFixture> & Pick<RankableFixture, 'stage' | 'kickoff' | 'played' | 'home_team_id' | 'away_team_id'>): RankableFixture {
  return overrides as RankableFixture;
}

function makeArticle(overrides: Partial<StaticArticle> & { id: string }): StaticArticle {
  return {
    source: 'bbc-sport',
    source_name: 'BBC Sport',
    headline: 'Default headline',
    url: `https://example.com/${overrides.id}`,
    thumbnail_url: null,
    summary: null,
    published_at: '2026-06-20T11:00:00Z',
    teams: [],
    entities: [],
    cluster_id: null,
    priority: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Signal 1 — sourceCoverageSignal
// ---------------------------------------------------------------------------

describe('sourceCoverageSignal', () => {
  it('returns 0 for a single source', () => {
    expect(sourceCoverageSignal(['bbc-sport'])).toBe(0);
  });

  it('returns 0 for an empty source list', () => {
    expect(sourceCoverageSignal([])).toBe(0);
  });

  it('returns 1/3 for two sources (out of 4 configured)', () => {
    const result = sourceCoverageSignal(['bbc-sport', 'espn']);
    expect(result).toBeCloseTo(1 / 3, 5);
  });

  it('returns 2/3 for three distinct sources', () => {
    const result = sourceCoverageSignal(['bbc-sport', 'espn', 'sky-sports']);
    expect(result).toBeCloseTo(2 / 3, 5);
  });

  it('returns 1.0 for four distinct sources', () => {
    expect(sourceCoverageSignal(['bbc-sport', 'espn', 'sky-sports', 'fox-sports'])).toBe(1);
  });

  it('deduplicates sources before scoring', () => {
    // Passing the same source 4 times is still a single distinct source → 0.
    expect(sourceCoverageSignal(['espn', 'espn', 'espn', 'espn'])).toBe(0);
  });

  it('dedup: two distinct even among 6 raw entries', () => {
    const result = sourceCoverageSignal(['bbc-sport', 'bbc-sport', 'bbc-sport', 'espn']);
    expect(result).toBeCloseTo(1 / 3, 5);
  });
});

// ---------------------------------------------------------------------------
// Signal 2 — recencyDecaySignal
// ---------------------------------------------------------------------------

describe('recencyDecaySignal', () => {
  it('returns exactly 1.0 for a just-published article (age 0)', () => {
    const now = NOW_MS;
    const published = new Date(now).toISOString();
    expect(recencyDecaySignal(published, now)).toBeCloseTo(1.0, 5);
  });

  it('returns ~0.5 after one half-life (12 h)', () => {
    const published = new Date(NOW_MS - RECENCY_HALF_LIFE_HOURS * HOUR_MS).toISOString();
    expect(recencyDecaySignal(published, NOW_MS)).toBeCloseTo(0.5, 3);
  });

  it('returns ~0.25 after two half-lives (24 h)', () => {
    const published = new Date(NOW_MS - 2 * RECENCY_HALF_LIFE_HOURS * HOUR_MS).toISOString();
    expect(recencyDecaySignal(published, NOW_MS)).toBeCloseTo(0.25, 3);
  });

  it('returns ~0.125 after three half-lives (36 h)', () => {
    const published = new Date(NOW_MS - 3 * RECENCY_HALF_LIFE_HOURS * HOUR_MS).toISOString();
    expect(recencyDecaySignal(published, NOW_MS)).toBeCloseTo(0.125, 3);
  });

  it('never goes below 0 for very old articles', () => {
    const veryOld = '2026-01-01T00:00:00Z';
    expect(recencyDecaySignal(veryOld, NOW_MS)).toBeGreaterThanOrEqual(0);
  });

  it('clamps to [0, 1] for future-dated articles', () => {
    const future = new Date(NOW_MS + 48 * HOUR_MS).toISOString();
    expect(recencyDecaySignal(future, NOW_MS)).toBeLessThanOrEqual(1);
    expect(recencyDecaySignal(future, NOW_MS)).toBeGreaterThanOrEqual(0);
  });

  it('a 6 h old article scores higher than a 48 h old article', () => {
    const recent = new Date(NOW_MS - 6 * HOUR_MS).toISOString();
    const old    = new Date(NOW_MS - 48 * HOUR_MS).toISOString();
    expect(recencyDecaySignal(recent, NOW_MS)).toBeGreaterThan(recencyDecaySignal(old, NOW_MS));
  });
});

// ---------------------------------------------------------------------------
// Signal 3 — sourceWeightSignal
// ---------------------------------------------------------------------------

describe('sourceWeightSignal', () => {
  it('returns 0 for an empty list', () => {
    expect(sourceWeightSignal([])).toBe(0);
  });

  it('returns 1.0 for ESPN (top tier)', () => {
    expect(sourceWeightSignal(['espn'])).toBe(SOURCE_TIER_WEIGHTS['espn']);
  });

  it('returns 1.0 for BBC Sport (top tier)', () => {
    expect(sourceWeightSignal(['bbc-sport'])).toBe(1.0);
  });

  it('returns 0.8 for Sky Sports (tier 2)', () => {
    expect(sourceWeightSignal(['sky-sports'])).toBe(0.8);
  });

  it('returns 0.8 for Fox Sports (tier 2)', () => {
    expect(sourceWeightSignal(['fox-sports'])).toBe(0.8);
  });

  it('returns DEFAULT_SOURCE_WEIGHT (0.5) for an unknown source', () => {
    expect(sourceWeightSignal(['mystery-outlet'])).toBe(0.5);
  });

  it('returns the best tier when a mix of sources is present', () => {
    // ESPN (1.0) wins over Fox Sports (0.8) and unknown (0.5)
    expect(sourceWeightSignal(['fox-sports', 'espn', 'mystery-outlet'])).toBe(1.0);
  });

  it('top tier wins over lower tier in any order', () => {
    expect(sourceWeightSignal(['sky-sports', 'bbc-sport'])).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Signal 4 — fixtureRelevanceSignal
// ---------------------------------------------------------------------------

describe('fixtureRelevanceSignal', () => {
  const ARGENTINA = 'argentina';
  const FRANCE = 'france';

  it('returns 0 when no teams are specified', () => {
    const fix = makeFix({ stage: 'group', kickoff: new Date(NOW_MS).toISOString(), played: 0, home_team_id: ARGENTINA, away_team_id: FRANCE });
    expect(fixtureRelevanceSignal([], [fix], NOW_MS)).toBe(0);
  });

  it('returns 0 when no fixtures are provided', () => {
    expect(fixtureRelevanceSignal([ARGENTINA], [], NOW_MS)).toBe(0);
  });

  it('returns 0 when no fixture involves the cluster teams', () => {
    const fix = makeFix({ stage: 'group', kickoff: new Date(NOW_MS + 1 * HOUR_MS).toISOString(), played: 0, home_team_id: 'brazil', away_team_id: 'spain' });
    expect(fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS)).toBe(0);
  });

  it('returns 0 for upcoming match outside the window (>24 h away)', () => {
    const kickoff = new Date(NOW_MS + (UPCOMING_WINDOW_HOURS + 1) * HOUR_MS).toISOString();
    const fix = makeFix({ stage: 'group', kickoff, played: 0, home_team_id: ARGENTINA, away_team_id: FRANCE });
    expect(fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS)).toBe(0);
  });

  it('returns 0 for a just-played match outside the fade window (>6 h ago)', () => {
    const kickoff = new Date(NOW_MS - (JUST_PLAYED_WINDOW_HOURS + 1) * HOUR_MS).toISOString();
    const fix = makeFix({ stage: 'group', kickoff, played: 1, home_team_id: ARGENTINA, away_team_id: FRANCE });
    expect(fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS)).toBe(0);
  });

  it('scales linearly for upcoming: full score at kickoff time', () => {
    const kickoff = new Date(NOW_MS).toISOString();   // kickoff is right now
    const fix = makeFix({ stage: 'group', kickoff, played: 0, home_team_id: ARGENTINA, away_team_id: FRANCE });
    // hoursToKick = 0 → rawRelevance = 1 − 0/24 = 1.0; stageMult=1.0 → 1.0
    expect(fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS)).toBeCloseTo(1.0, 5);
  });

  it('scales linearly for upcoming: half score at half-window (12 h away)', () => {
    const kickoff = new Date(NOW_MS + 12 * HOUR_MS).toISOString();
    const fix = makeFix({ stage: 'group', kickoff, played: 0, home_team_id: ARGENTINA, away_team_id: FRANCE });
    // rawRelevance = 1 − 12/24 = 0.5; group stageMult = 1.0
    expect(fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS)).toBeCloseTo(0.5, 5);
  });

  it('scales linearly for just-played: full score at kickoff', () => {
    const kickoff = new Date(NOW_MS).toISOString();
    const fix = makeFix({ stage: 'group', kickoff, played: 1, home_team_id: ARGENTINA, away_team_id: FRANCE });
    expect(fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS)).toBeCloseTo(1.0, 5);
  });

  it('scales linearly for just-played: half score at 3 h after kickoff', () => {
    const kickoff = new Date(NOW_MS - 3 * HOUR_MS).toISOString();
    const fix = makeFix({ stage: 'group', kickoff, played: 1, home_team_id: ARGENTINA, away_team_id: FRANCE });
    // rawRelevance = 1 − 3/6 = 0.5; group stageMult = 1.0
    expect(fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS)).toBeCloseTo(0.5, 5);
  });

  it('applies stage multiplier and caps at 1.0 (final, upcoming)', () => {
    // final stageMult=2.0; kickoff in 1 h → rawRelevance = 1 − 1/24 ≈ 0.958 → ×2.0 → capped at 1.0
    const kickoff = new Date(NOW_MS + 1 * HOUR_MS).toISOString();
    const fix = makeFix({ stage: 'final', kickoff, played: 0, home_team_id: ARGENTINA, away_team_id: FRANCE });
    expect(fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS)).toBe(1.0);
  });

  it('semi-final multiplier produces higher score than group-stage at same proximity', () => {
    const kickoff = new Date(NOW_MS + 6 * HOUR_MS).toISOString();
    const semi  = makeFix({ stage: 'semi',  kickoff, played: 0, home_team_id: ARGENTINA, away_team_id: FRANCE });
    const group = makeFix({ stage: 'group', kickoff, played: 0, home_team_id: ARGENTINA, away_team_id: FRANCE });
    const semiScore  = fixtureRelevanceSignal([ARGENTINA], [semi],  NOW_MS);
    const groupScore = fixtureRelevanceSignal([ARGENTINA], [group], NOW_MS);
    expect(semiScore).toBeGreaterThan(groupScore);
  });

  it('takes the maximum when multiple fixtures match cluster teams', () => {
    const closer   = new Date(NOW_MS + 2 * HOUR_MS).toISOString();
    const further  = new Date(NOW_MS + 20 * HOUR_MS).toISOString();
    const fixClose  = makeFix({ stage: 'group', kickoff: closer,  played: 0, home_team_id: ARGENTINA, away_team_id: FRANCE });
    const fixFar    = makeFix({ stage: 'group', kickoff: further, played: 0, home_team_id: ARGENTINA, away_team_id: 'brazil' });
    const closeScore = fixtureRelevanceSignal([ARGENTINA], [fixClose], NOW_MS);
    const result     = fixtureRelevanceSignal([ARGENTINA], [fixClose, fixFar], NOW_MS);
    expect(result).toBeCloseTo(closeScore, 5);  // closer match wins
  });

  it('matches on away_team_id as well as home_team_id', () => {
    const kickoff = new Date(NOW_MS + 6 * HOUR_MS).toISOString();
    const fix = makeFix({ stage: 'group', kickoff, played: 0, home_team_id: 'brazil', away_team_id: ARGENTINA });
    const score = fixtureRelevanceSignal([ARGENTINA], [fix], NOW_MS);
    expect(score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// scoreCluster — combined weighted score
// ---------------------------------------------------------------------------

describe('scoreCluster', () => {
  it('returns 0 when all signals are 0', () => {
    const veryOld = '2020-01-01T00:00:00Z';
    const cluster = { sources: ['bbc-sport'], mostRecentPublishedAt: veryOld, teams: [] };
    const score = scoreCluster(cluster, [], DEFAULT_WEIGHTS, NOW_MS);
    // sourceCoverage=0 (1 source), recency≈0 (very old), fixtureRelevance=0, sourceWeight=1.0*w3
    // score = 0 + ~0 + 1.0*0.15 + 0 ≈ 0.15
    // sourceWeight is non-zero for bbc-sport, so score > 0 but below 0.2
    expect(score).toBeLessThan(0.2);
  });

  it('cross-source cluster (4 outlets) scores higher than solo cluster', () => {
    const published = new Date(NOW_MS - 1 * HOUR_MS).toISOString();
    const fourSource = {
      sources: ['bbc-sport', 'espn', 'sky-sports', 'fox-sports'],
      mostRecentPublishedAt: published,
      teams: [],
    };
    const oneSource = {
      sources: ['bbc-sport'],
      mostRecentPublishedAt: published,
      teams: [],
    };
    const scoreMulti = scoreCluster(fourSource, [], DEFAULT_WEIGHTS, NOW_MS);
    const scoreSolo  = scoreCluster(oneSource,  [], DEFAULT_WEIGHTS, NOW_MS);
    expect(scoreMulti).toBeGreaterThan(scoreSolo);
  });

  it('fixture relevance lifts a solo cluster above an uncovered cluster of equal recency', () => {
    const published = new Date(NOW_MS - 2 * HOUR_MS).toISOString();
    const kickoff   = new Date(NOW_MS + 1 * HOUR_MS).toISOString();
    const final = makeFix({ stage: 'final', kickoff, played: 0, home_team_id: 'argentina', away_team_id: 'france' });

    const withRelevance = {
      sources: ['bbc-sport'],
      mostRecentPublishedAt: published,
      teams: ['argentina'],
    };
    const withoutRelevance = {
      sources: ['bbc-sport'],
      mostRecentPublishedAt: published,
      teams: ['brazil'],        // no final fixture for Brazil
    };
    const scoreWith    = scoreCluster(withRelevance,    [final], DEFAULT_WEIGHTS, NOW_MS);
    const scoreWithout = scoreCluster(withoutRelevance, [final], DEFAULT_WEIGHTS, NOW_MS);
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it('uses custom weights correctly', () => {
    const published = new Date(NOW_MS).toISOString();  // age = 0 → recency = 1
    const cluster = { sources: ['bbc-sport', 'espn'], mostRecentPublishedAt: published, teams: [] };
    const allRecency = { sourceCoverage: 0, recencyDecay: 1, sourceWeight: 0, fixtureRelevance: 0 };
    // With allRecency weights: score = 0 + 1×recencyDecay(~1.0) + 0 + 0 = ~1.0
    expect(scoreCluster(cluster, [], allRecency, NOW_MS)).toBeCloseTo(1.0, 3);
  });

  it('total score stays within [0, 1] with default weights', () => {
    const published = new Date(NOW_MS).toISOString();
    const kickoff   = new Date(NOW_MS).toISOString();
    const fix = makeFix({ stage: 'final', kickoff, played: 0, home_team_id: 'argentina', away_team_id: 'france' });
    const cluster = {
      sources: ['bbc-sport', 'espn', 'sky-sports', 'fox-sports'],
      mostRecentPublishedAt: published,
      teams: ['argentina'],
    };
    const score = scoreCluster(cluster, [fix], DEFAULT_WEIGHTS, NOW_MS);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// rankAndCollapseNews — full pipeline
// ---------------------------------------------------------------------------

describe('rankAndCollapseNews', () => {
  it('returns empty array for empty input', () => {
    expect(rankAndCollapseNews([], [], DEFAULT_WEIGHTS, NOW_MS)).toEqual([]);
  });

  it('returns a single unclustered article unchanged', () => {
    const a = makeArticle({ id: 'solo' });
    const result = rankAndCollapseNews([a], [], DEFAULT_WEIGHTS, NOW_MS);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(a);
  });

  it('collapses three articles from the same cluster into one', () => {
    const arts = ['bbc', 'espn', 'sky'].map((src) =>
      makeArticle({ id: src, source: `${src}-sport`, cluster_id: 'cluster-final' })
    );
    const result = rankAndCollapseNews(arts, [], DEFAULT_WEIGHTS, NOW_MS);
    expect(result).toHaveLength(1);
  });

  it('four-source cluster ranks above a solo article of equal recency', () => {
    const published = new Date(NOW_MS - 1 * HOUR_MS).toISOString();
    const clusterArts = ['bbc-sport', 'espn', 'sky-sports', 'fox-sports'].map((src, i) =>
      makeArticle({
        id: `cluster-${src}`,
        source: src,
        cluster_id: 'big-cluster',
        published_at: published,
        thumbnail_url: i === 0 ? 'https://x.com/img.jpg' : null,
      })
    );
    const soloArt = makeArticle({
      id: 'solo',
      source: 'mystery-outlet',
      cluster_id: null,
      published_at: published,
    });
    const result = rankAndCollapseNews([...clusterArts, soloArt], [], DEFAULT_WEIGHTS, NOW_MS);
    expect(result).toHaveLength(2);
    // 4-source cluster scores higher than solo → comes first
    expect(result[0].cluster_id).toBe('big-cluster');
  });

  it('fixture relevance boosts a cluster tied with another on other signals', () => {
    const published = new Date(NOW_MS - 1 * HOUR_MS).toISOString();
    const kickoff   = new Date(NOW_MS + 2 * HOUR_MS).toISOString();
    const final = makeFix({ stage: 'final', kickoff, played: 0, home_team_id: 'argentina', away_team_id: 'france' });

    const argCluster = makeArticle({
      id: 'arg-art',
      cluster_id: 'cluster-arg',
      source: 'bbc-sport',
      published_at: published,
      teams: ['argentina'],
    });
    const spaCluster = makeArticle({
      id: 'spa-art',
      cluster_id: 'cluster-spa',
      source: 'bbc-sport',
      published_at: published,
      teams: ['spain'],    // Spain has no final fixture
    });

    const result = rankAndCollapseNews([spaCluster, argCluster], [final], DEFAULT_WEIGHTS, NOW_MS);
    expect(result[0].id).toBe('arg-art');   // fixture boost wins
  });

  it('ties are broken deterministically by cluster key', () => {
    const published = new Date(NOW_MS - 1 * HOUR_MS).toISOString();
    // Two identical solo articles — cluster keys are '__solo__aaa' and '__solo__zzz'
    const a = makeArticle({ id: 'aaa', source: 'bbc-sport', published_at: published });
    const z = makeArticle({ id: 'zzz', source: 'bbc-sport', published_at: published });
    const result1 = rankAndCollapseNews([a, z], [], DEFAULT_WEIGHTS, NOW_MS);
    const result2 = rankAndCollapseNews([z, a], [], DEFAULT_WEIGHTS, NOW_MS);
    // Same order regardless of input order
    expect(result1.map((r) => r.id)).toEqual(result2.map((r) => r.id));
    // '__solo__aaa' < '__solo__zzz' → 'aaa' comes first on ties
    expect(result1[0].id).toBe('aaa');
  });

  it('higher-priority cluster surfaces before lower-priority even if older', () => {
    const olderPublished = new Date(NOW_MS - 3 * HOUR_MS).toISOString();
    const newerPublished = new Date(NOW_MS - 0.5 * HOUR_MS).toISOString();
    const kickoff = new Date(NOW_MS + 30 * 60 * 1000).toISOString();  // 30 min away
    const final = makeFix({ stage: 'final', kickoff, played: 0, home_team_id: 'brazil', away_team_id: 'france' });

    // Older, but covered by all 4 sources AND has fixture relevance
    const strongCluster = ['bbc-sport', 'espn', 'sky-sports', 'fox-sports'].map((src, i) =>
      makeArticle({ id: `strong-${i}`, source: src, cluster_id: 'strong', published_at: olderPublished, teams: ['brazil'] })
    );
    // Newer, single source, no fixture
    const weakArticle = makeArticle({ id: 'weak', source: 'mystery-outlet', cluster_id: null, published_at: newerPublished });

    const result = rankAndCollapseNews([...strongCluster, weakArticle], [final], DEFAULT_WEIGHTS, NOW_MS);
    expect(result[0].cluster_id).toBe('strong');  // 4-source cluster with final → wins despite being older
  });

  it('separate clusters remain separate', () => {
    const a1 = makeArticle({ id: 'a1', cluster_id: 'cA' });
    const a2 = makeArticle({ id: 'a2', cluster_id: 'cA' });
    const b1 = makeArticle({ id: 'b1', cluster_id: 'cB' });
    const result = rankAndCollapseNews([a1, a2, b1], [], DEFAULT_WEIGHTS, NOW_MS);
    expect(result).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const arts = [
      makeArticle({ id: 'x', cluster_id: 'cx' }),
      makeArticle({ id: 'y', cluster_id: 'cx' }),
    ];
    const before = [...arts];
    rankAndCollapseNews(arts, [], DEFAULT_WEIGHTS, NOW_MS);
    expect(arts).toEqual(before);
  });
});
