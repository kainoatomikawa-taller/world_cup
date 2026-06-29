// Static-JSON data layer. All public/data/* files are served directly by the
// dev server (or CDN); no serverless proxy is needed.
import type { Match } from '../domain/types';
import type { ManifestData, StaticFixture } from './staticTypes';
import { staticFixtureToMatch } from './adapter';

export const STATIC_DATA_BASE = '/data';

export async function fetchManifest(): Promise<ManifestData> {
  const res = await fetch(`${STATIC_DATA_BASE}/manifest.json`);
  if (!res.ok) throw new Error(`fetchManifest failed: ${res.status}`);
  return res.json() as Promise<ManifestData>;
}

export async function fetchStaticMatches(): Promise<Match[]> {
  const res = await fetch(`${STATIC_DATA_BASE}/fixtures.json`);
  if (!res.ok) throw new Error(`fetchStaticMatches failed: ${res.status}`);
  const fixtures = (await res.json()) as StaticFixture[];
  return fixtures.filter((f) => f.stage === 'group').map(staticFixtureToMatch);
}
