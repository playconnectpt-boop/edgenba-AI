import { defineConfig } from 'vite';

const worker = 'http://127.0.0.1:8787';

export default defineConfig({
  server: {
    proxy: Object.fromEntries([
      '/api/login',
      '/api/logout',
      '/api/health',
      '/api/espn/scoreboard',
      '/api/espn/injuries',
      '/api/espn/summary',
      '/api/espn/player-search',
      '/api/espn/player-gamelog',
      '/api/espn/player-gamelogs',
      '/api/scan/players',
      '/api/ones-to-watch',
      '/api/ones-to-watch/history'
    ].map(route => [route, {
      target: worker,
      changeOrigin: true
    }]))
  }
});
