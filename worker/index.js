/**
 * Worker-Einstiegspunkt für Cloudflare Workers mit statischen Assets
 * (Workers-Builds-Deploy via `npx wrangler deploy`).
 * Routet die API-Pfade auf die bestehende Handler-Logik und liefert
 * alle übrigen Requests aus dem Asset-Verzeichnis (dist/) aus.
 * Die Pages-Variante (functions/api/*.js) bleibt unverändert nutzbar.
 */
import * as speedTest from '../functions/api/speed-test.js';
import * as resources from '../functions/api/resources.js';

const ROUTES = {
  '/api/speed-test': speedTest,
  '/api/resources': resources,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (route) {
      if (request.method === 'OPTIONS') return route.onRequestOptions();
      if (request.method === 'POST') return route.onRequestPost({ request, env, ctx });
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json', allow: 'POST, OPTIONS' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
