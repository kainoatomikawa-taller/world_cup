// Client-side calls to our serverless proxy (the /api/* functions). The proxy
// hides the football API key and avoids CORS — the browser never talks to the
// upstream API directly.
import type { Match } from '../domain/types';
import { toMatches } from './adapter';

/** Fetch live fixtures + results via the proxy and normalize to domain Matches. */
export async function fetchLiveMatches(): Promise<Match[]> {
  const res = await fetch('/api/matches');
  if (!res.ok) throw new Error(`fetchLiveMatches failed: ${res.status}`);
  const raw = await res.json();
  return toMatches(raw);
}
