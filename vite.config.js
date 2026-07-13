// Vite-Konfiguration: React-Plugin, Dev-Server auf Port 3000.
// /api wird im Dev-Modus an einen lokalen API-Server weitergeleitet
// (entweder `npm run api` auf :8788 oder `wrangler pages dev`).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
});
