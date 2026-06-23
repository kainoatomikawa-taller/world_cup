// Serverless proxy (Vercel edge function). The browser calls /api/matches; this
// function injects the football-data.org API key server-side so the key is never
// exposed to the client, and CORS is avoided. The raw upstream JSON is passed
// through unchanged — adapter.ts is the only place that knows the upstream shape.
//
// Local dev: this function only runs under `vercel dev`, not plain `npm run dev`.
// Set FOOTBALL_API_KEY in .env.local for local testing.

export const config = { runtime: 'edge' };

const UPSTREAM =
  'https://api.football-data.org/v4/competitions/WC/matches?season=2026';

export default async function handler(_request: Request): Promise<Response> {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'FOOTBALL_API_KEY not set' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      headers: { 'X-Auth-Token': apiKey },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'upstream fetch failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (upstream.status === 403) {
    return new Response(JSON.stringify({ error: 'API key rejected' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (upstream.status === 429) {
    return new Response(
      JSON.stringify({ error: 'rate limited by upstream — retry after 60s' }),
      {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': '60' },
      },
    );
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `upstream error ${upstream.status}` }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: string;
  try {
    body = await upstream.text();
  } catch {
    return new Response(
      JSON.stringify({ error: 'failed to read upstream response' }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // CDN caches one response for 60 s; all visitors are served from it,
      // keeping traffic well within football-data.org's free-tier rate limit.
      // stale-while-revalidate lets the CDN serve stale for 2 min while it
      // re-fetches in the background, avoiding latency spikes.
      'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
    },
  });
}
