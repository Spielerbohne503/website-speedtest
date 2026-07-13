/**
 * Worker-Einstiegspunkt für Cloudflare Workers mit statischen Assets
 * (Workers-Builds-Deploy via `npx wrangler deploy`).
 * Routet /api/speed-test auf die bestehende Handler-Logik und liefert
 * alle übrigen Requests aus dem Asset-Verzeichnis (dist/) aus.
 * Die Pages-Variante (functions/api/speed-test.js) bleibt unverändert nutzbar.
 */
import { onRequestPost, onRequestOptions } from '../functions/api/speed-test.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/speed-test') {
      if (request.method === 'OPTIONS') return onRequestOptions();
      if (request.method === 'POST') return onRequestPost({ request, env, ctx });
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json', allow: 'POST, OPTIONS' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
