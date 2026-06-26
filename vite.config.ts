import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (including non-VITE_ ones) so the proxy can read the key
  // server-side without ever exposing it to the browser bundle.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: env.FOOTBALL_API_KEY
        ? {
            // Local-dev stand-in for the Vercel edge function in api/matches.ts.
            // Vite intercepts /api/matches on the Node side, rewrites the URL,
            // and injects the API key header — the browser never sees the key.
            '/api/matches': {
              target: 'https://api.football-data.org',
              changeOrigin: true,
              rewrite: () => '/v4/competitions/WC/matches?season=2026',
              headers: { 'X-Auth-Token': env.FOOTBALL_API_KEY },
            },
          }
        : undefined,
    },
  }
})
