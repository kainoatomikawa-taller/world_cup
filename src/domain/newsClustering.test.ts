import { describe, it, expect } from 'vitest';
import type { StaticArticle } from '../data/staticTypes';
import { collapseNewsClusters, selectClusterRepresentative } from './newsClustering';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeArticle(overrides: Partial<StaticArticle> & { id: string }): StaticArticle {
  return {
    source: 'bbc-sport',
    source_name: 'BBC Sport',
    headline: 'Default headline',
    url: `https://example.com/${overrides.id}`,
    thumbnail_url: null,
    summary: null,
    published_at: '2026-06-15T12:00:00+00:00',
    teams: [],
    entities: [],
    cluster_id: null,
    priority: 0,
    ...overrides,
  };
}

// Three outlets covering the same Argentina vs France final
const BBC_ARG_FRA = makeArticle({
  id: 'bbc-arg-fra',
  source: 'bbc-sport',
  source_name: 'BBC Sport',
  headline: 'Argentina beat France in World Cup final',
  url: 'https://bbc.com/arg-fra',
  thumbnail_url: 'https://bbc.com/img/arg-fra.jpg',
  summary: 'A classic final ended with Argentina lifting the trophy after extra time.',
  published_at: '2026-07-19T20:30:00+00:00',
  teams: ['argentina', 'france'],
  cluster_id: 'cluster-arg-fra',
});

const ESPN_ARG_FRA = makeArticle({
  id: 'espn-arg-fra',
  source: 'espn',
  source_name: 'ESPN',
  headline: 'Argentina crowned World Cup champions over France',
  url: 'https://espn.com/arg-fra',
  thumbnail_url: null,
  summary: 'Messi lifts the trophy in stunning final against France.',
  published_at: '2026-07-19T20:45:00+00:00',
  teams: ['argentina', 'france'],
  cluster_id: 'cluster-arg-fra',
});

const SKY_ARG_FRA = makeArticle({
  id: 'sky-arg-fra',
  source: 'sky-sports',
  source_name: 'Sky Sports',
  headline: 'France fall to Argentina in dramatic World Cup final',
  url: 'https://sky.com/arg-fra',
  thumbnail_url: null,
  summary: null,
  published_at: '2026-07-19T21:00:00+00:00',
  teams: ['argentina', 'france'],
  cluster_id: 'cluster-arg-fra',
});

// A second cluster (England vs Spain, solo — only one article)
const ENG_ESP = makeArticle({
  id: 'bbc-eng-esp',
  source: 'bbc-sport',
  source_name: 'BBC Sport',
  headline: 'England defeat Spain in semi-final',
  url: 'https://bbc.com/eng-esp',
  thumbnail_url: 'https://bbc.com/img/eng-esp.jpg',
  summary: 'England reach their first World Cup final in dramatic fashion.',
  published_at: '2026-07-16T19:00:00+00:00',
  teams: ['england', 'spain'],
  cluster_id: 'cluster-eng-esp',
});

// Unclustered (standalone) article
const UNCLUSTERED = makeArticle({
  id: 'fox-attendance',
  source: 'fox-sports',
  source_name: 'Fox Sports',
  headline: 'World Cup 2026 breaks all-time attendance record',
  url: 'https://fox.com/attendance',
  thumbnail_url: null,
  summary: 'Over 3.5 million tickets sold across all venues.',
  published_at: '2026-07-20T10:00:00+00:00',
  teams: [],
  cluster_id: null,
});

// ---------------------------------------------------------------------------
// selectClusterRepresentative
// ---------------------------------------------------------------------------

describe('selectClusterRepresentative', () => {
  it('throws RangeError on an empty cluster', () => {
    expect(() => selectClusterRepresentative([])).toThrow(RangeError);
  });

  it('returns the only article in a single-item cluster', () => {
    expect(selectClusterRepresentative([BBC_ARG_FRA])).toBe(BBC_ARG_FRA);
  });

  it('prefers the article with a thumbnail over those without', () => {
    // BBC has thumbnail; ESPN and Sky do not.
    const result = selectClusterRepresentative([SKY_ARG_FRA, ESPN_ARG_FRA, BBC_ARG_FRA]);
    expect(result).toBe(BBC_ARG_FRA);
  });

  it('prefers a longer summary when thumbnails are equal', () => {
    const short = makeArticle({
      id: 'short',
      thumbnail_url: 'https://x.com/t.jpg',
      summary: 'Brief.',
    });
    const long = makeArticle({
      id: 'long',
      thumbnail_url: 'https://x.com/t.jpg',
      summary:
        'A much longer summary that goes into considerable detail about the match, the goals, and the atmosphere at the stadium.',
    });
    expect(selectClusterRepresentative([short, long])).toBe(long);
  });

  it('handles a cluster where all articles have no thumbnail and no summary', () => {
    const a = makeArticle({ id: 'a' });
    const b = makeArticle({ id: 'b' });
    // Should return one of them without throwing
    const result = selectClusterRepresentative([a, b]);
    expect([a, b]).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// collapseNewsClusters
// ---------------------------------------------------------------------------

describe('collapseNewsClusters', () => {
  it('returns an empty array for empty input', () => {
    expect(collapseNewsClusters([])).toEqual([]);
  });

  it('passes unclustered articles through unchanged', () => {
    const result = collapseNewsClusters([UNCLUSTERED]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(UNCLUSTERED);
  });

  it('collapses three articles from the same cluster into one card', () => {
    const result = collapseNewsClusters([BBC_ARG_FRA, ESPN_ARG_FRA, SKY_ARG_FRA]);
    expect(result).toHaveLength(1);
  });

  it('picks the best representative from a three-article cluster', () => {
    // BBC has thumbnail → wins
    const result = collapseNewsClusters([SKY_ARG_FRA, ESPN_ARG_FRA, BBC_ARG_FRA]);
    expect(result[0]).toBe(BBC_ARG_FRA);
  });

  it('keeps articles from separate clusters as separate cards', () => {
    const input = [BBC_ARG_FRA, ESPN_ARG_FRA, SKY_ARG_FRA, ENG_ESP];
    const result = collapseNewsClusters(input);
    expect(result).toHaveLength(2);
    const headlines = result.map((a) => a.headline);
    expect(headlines).toContain(BBC_ARG_FRA.headline);
    expect(headlines).toContain(ENG_ESP.headline);
  });

  it('interleaves unclustered articles correctly in date order', () => {
    const result = collapseNewsClusters([
      BBC_ARG_FRA,    // cluster-arg-fra representative; published 2026-07-19 20:30
      ESPN_ARG_FRA,   // same cluster, dropped
      SKY_ARG_FRA,    // same cluster, dropped
      UNCLUSTERED,    // no cluster; published 2026-07-20 10:00 — most recent
    ]);
    // UNCLUSTERED is the most recent → index 0
    expect(result[0]).toBe(UNCLUSTERED);
    // cluster-arg-fra representative (BBC, has thumbnail) → index 1
    expect(result[1]).toBe(BBC_ARG_FRA);
  });

  it('four outlets covering the same match → exactly one card', () => {
    const sources = [
      { id: 'bbc-eng-ger',   source: 'bbc-sport',  thumbnail: 'https://x.com/t.jpg', pub: '2026-06-15T12:00:00+00:00' },
      { id: 'sky-eng-ger',   source: 'sky-sports',  thumbnail: null,                  pub: '2026-06-15T12:30:00+00:00' },
      { id: 'espn-eng-ger',  source: 'espn',        thumbnail: null,                  pub: '2026-06-15T13:00:00+00:00' },
      { id: 'fox-eng-ger',   source: 'fox-sports',  thumbnail: null,                  pub: '2026-06-15T13:30:00+00:00' },
    ];
    const articles = sources.map(({ id, source, thumbnail, pub }) =>
      makeArticle({
        id,
        source,
        source_name: source,
        headline: `England beat Germany in quarter-final`,
        cluster_id: 'cluster-eng-ger',
        thumbnail_url: thumbnail,
        published_at: pub,
      })
    );
    const result = collapseNewsClusters(articles);
    expect(result).toHaveLength(1);
    // First article has thumbnail — it should be the representative
    expect(result[0].id).toBe('bbc-eng-ger');
  });

  it('output is sorted by published_at descending', () => {
    const early = makeArticle({ id: 'early', published_at: '2026-06-10T10:00:00+00:00', cluster_id: null });
    const mid   = makeArticle({ id: 'mid',   published_at: '2026-06-15T10:00:00+00:00', cluster_id: 'cluster-x' });
    const late  = makeArticle({ id: 'late',  published_at: '2026-06-20T10:00:00+00:00', cluster_id: null });
    const result = collapseNewsClusters([early, mid, late]);
    expect(result.map((a) => a.id)).toEqual(['late', 'mid', 'early']);
  });

  it('a solo article with cluster_id still collapses to one card', () => {
    const solo = makeArticle({ id: 'solo', cluster_id: 'unique-cluster-abc123' });
    const result = collapseNewsClusters([solo]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(solo);
  });

  it('does not mutate the input array', () => {
    const input = [BBC_ARG_FRA, ESPN_ARG_FRA, UNCLUSTERED];
    const before = [...input];
    collapseNewsClusters(input);
    expect(input).toEqual(before);
  });

  it('mixed: two clusters + two solo articles → four cards', () => {
    const clusterA1 = makeArticle({ id: 'a1', cluster_id: 'cA', published_at: '2026-06-20T10:00:00+00:00' });
    const clusterA2 = makeArticle({ id: 'a2', cluster_id: 'cA', published_at: '2026-06-20T11:00:00+00:00' });
    const clusterB1 = makeArticle({ id: 'b1', cluster_id: 'cB', published_at: '2026-06-19T10:00:00+00:00' });
    const clusterB2 = makeArticle({ id: 'b2', cluster_id: 'cB', published_at: '2026-06-19T12:00:00+00:00' });
    const solo1     = makeArticle({ id: 's1', cluster_id: null, published_at: '2026-06-21T08:00:00+00:00' });
    const solo2     = makeArticle({ id: 's2', cluster_id: null, published_at: '2026-06-18T08:00:00+00:00' });

    const result = collapseNewsClusters([clusterA1, clusterA2, clusterB1, clusterB2, solo1, solo2]);
    expect(result).toHaveLength(4);
    // Most recent first: solo1 (21st), clusterA rep (20th), clusterB rep (19th), solo2 (18th)
    expect(result[0]).toBe(solo1);
    expect(result[3]).toBe(solo2);
  });
});
