/**
 * Lokaler API-Server für die Entwicklung ohne wrangler:
 * mountet die Pages Function unter http://localhost:8788/api/speed-test
 * und serviert (falls vorhanden) den dist/-Build.
 *
 * Start:  npm run api   (parallel zu `npm run dev` → Vite proxied /api hierhin)
 * Benötigt Node 18+ (globales fetch/Request/Response).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import * as speedTest from '../functions/api/speed-test.js';
import * as resources from '../functions/api/resources.js';
import * as crawl from '../functions/api/crawl.js';
import * as subdomains from '../functions/api/subdomains.js';
import * as lighthouse from '../functions/api/lighthouse.js';
import * as security from '../functions/api/security.js';

const ROUTES = {
  '/api/speed-test': speedTest,
  '/api/resources': resources,
  '/api/crawl': crawl,
  '/api/subdomains': subdomains,
  '/api/lighthouse': lighthouse,
  '/api/security': security,
};

const PORT = process.env.PORT || 8788;
const DIST = new URL('../dist', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const route = ROUTES[req.url.split('?')[0]];
    if (route) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(`http://localhost:${PORT}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      // env aus process.env durchreichen (z.B. PSI_API_KEY für Lighthouse).
      // Secrets kommen nur aus der Shell-Umgebung, nie aus dem Repo.
      const response =
        req.method === 'OPTIONS'
          ? route.onRequestOptions()
          : await route.onRequestPost({ request, env: process.env });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    // Statische Dateien aus dist/ (nach `npm run build`)
    const safePath = normalize(req.url === '/' ? '/index.html' : req.url).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(DIST, safePath.split('?')[0]);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const content = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found (run `npm run build` first for static files)');
    }
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(error.message ?? error) }));
  }
});

server.listen(PORT, () => {
  console.log(`Local API on http://localhost:${PORT} (POST /api/speed-test)`);
});
