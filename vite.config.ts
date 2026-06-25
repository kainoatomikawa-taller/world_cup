import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/matches': {
          target: 'https://api.football-data.org/v4/competitions/WC/matches?season=2026',
          changeOrigin: true,
          rewrite: () => '',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('X-Auth-Token', env.FOOTBALL_API_KEY ?? '')
            })
          },
        },
      },
    },
  }
})
