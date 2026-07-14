/**
 * POST /api/crawl – Same-Origin-Crawler (Breitensuche), batchweise.
 *
 * Der Client ruft den Endpunkt wiederholt auf und reicht `visited` +
 * `frontier` zurück, bis die Frontier leer oder das Limit erreicht ist.
 * Pro Aufruf wird nur eine begrenzte Zahl Seiten geladen (WAVE), damit die
 * 50-Subrequest-Grenze pro Worker-Invocation nicht gesprengt wird.
 *
 * Findet: interne URLs, Statuscodes, Redirects, Broken Links (4xx/5xx),
 * Content-Type, Größe, Antwortzeit.
 *
 * Input : { url, limit?, visited?: [urls], frontier?: [urls] }
 * Output: { origin, results: [{url,status,timeMs,bytes,type,redirectedTo,error}],
 *           visited, frontier, done, count }
 */
import { UA, jsonResponse, corsPreflight, parseUrl } from './_shared.js';

const WAVE = 10; // Seiten pro Aufruf
const CONCURRENCY = 5;
const PAGE_TIMEOUT_MS = 12000;
const MAX_LIMIT = 60;
const MAX_HTML_BYTES = 1_500_000;

export function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const start = parseUrl(body?.url);
  if (!start) return jsonResponse({ error: 'Invalid URL' }, 400);

  const origin = start.origin;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number(body?.limit) || 50)));
  const visited = new Set(Array.isArray(body?.visited) ? body.visited : []);
  let frontier = Array.isArray(body?.frontier) && body.frontier.length ? body.frontier : [start.href];

  // Neustart: Startseite in die Frontier
  frontier = frontier.filter((url) => !visited.has(url));

  const budget = Math.max(0, limit - visited.size);
  const batch = frontier.slice(0, Math.min(WAVE, budget));
  const remaining = frontier.slice(batch.length);
  const results = [];
  const discovered = new Set();

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(slice.map((url) => crawlOne(url, origin)));
    for (const res of settled) {
      visited.add(res.url);
      results.push(res.summary);
      for (const link of res.links) {
        if (!visited.has(link) && !discovered.has(link)) discovered.add(link);
      }
    }
  }

  // Neue Links + Rest der alten Frontier, dedupliziert, gegen Limit gedeckelt
  const nextFrontier = [];
  const seen = new Set(visited);
  for (const url of [...remaining, ...discovered]) {
    if (seen.has(url)) continue;
    seen.add(url);
    nextFrontier.push(url);
  }

  const count = visited.size;
  const done = nextFrontier.length === 0 || count >= limit;

  return jsonResponse({
    origin,
    results,
    visited: [...visited],
    frontier: done ? [] : nextFrontier.slice(0, limit * 3),
    done,
    count,
    limit,
  });
}

async function crawlOne(url, origin) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' },
      cf: { cacheTtl: 0 },
    });
    const type = response.headers.get('content-type') ?? '';
    const isHtml = type.includes('text/html');
    const buffer = isHtml ? await response.arrayBuffer() : null;
    clearTimeout(timer);

    const redirectedTo = response.url !== url ? response.url : null;
    const links = isHtml
      ? extractLinks(
          new TextDecoder('utf-8', { fatal: false }).decode(buffer.slice(0, MAX_HTML_BYTES)),
          response.url,
          origin,
        )
      : [];

    return {
      url,
      links,
      summary: {
        url,
        status: response.status,
        timeMs: Date.now() - started,
        bytes: buffer ? buffer.byteLength : Number(response.headers.get('content-length')) || null,
        type: type.split(';')[0] || null,
        redirectedTo,
        error: null,
      },
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      url,
      links: [],
      summary: { url, status: 0, timeMs: Date.now() - started, bytes: null, type: null, redirectedTo: null, error: String(error?.message ?? error) },
    };
  }
}

// Interne <a href>-Links extrahieren, normalisiert (ohne #fragment, gleiche Origin)
export function extractLinks(html, baseUrl, origin) {
  const links = new Set();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1].trim();
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(raw)) continue;
    try {
      const url = new URL(raw, baseUrl);
      if (url.origin !== origin) continue;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      // Nur echte Seiten crawlen, keine Downloads/Assets
      if (/\.(pdf|zip|jpe?g|png|gif|webp|avif|svg|css|js|mp4|webm|woff2?|ttf|ico|xml|json)$/i.test(url.pathname))
        continue;
      url.hash = '';
      links.add(url.href);
    } catch {
      // ungültige URL überspringen
    }
  }
  return [...links];
}
