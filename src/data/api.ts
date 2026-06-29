// Static-JSON data layer. All public/data/* files are served directly by the
// dev server (or CDN); no serverless proxy is needed.
import type { Match } from '../domain/types';
import type { ManifestData, StaticFixture } from './staticTypes';
import { staticFixtureToMatch } from './adapter';

export const STATIC_DATA_BASE = '/data';

/** Append manifest content_hash as ?v=<hash> for cache-busting. */
export function versionedUrl(path: string, contentHash: string | null): string {
  return contentHash ? `${path}?v=${contentHash}` : path;
}

export async function fetchManifest(): Promise<ManifestData> {
  const res = await fetch(`${STATIC_DATA_BASE}/manifest.json`);
  if (!res.ok) throw new Error(`fetchManifest failed: ${res.status}`);
  return res.json() as Promise<ManifestData>;
}

export async function fetchStaticMatches(contentHash: string | null): Promise<Match[]> {
  const url = versionedUrl(`${STATIC_DATA_BASE}/fixtures.json`, contentHash);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchStaticMatches failed: ${res.status}`);
  const fixtures = (await res.json()) as StaticFixture[];
  return fixtures.map(staticFixtureToMatch);
}
