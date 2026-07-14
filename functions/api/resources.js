/**
 * Cloudflare Pages Function: POST /api/resources
 *
 * Ressourcen-Analyse einer Seite: lädt das HTML-Dokument, extrahiert
 * Bilder, CSS und JavaScript und misst jede Ressource einzeln
 * (Ladezeit + Größe) vom Cloudflare Edge aus.
 *
 * Limits (Free-Plan: max. 50 Subrequests pro Aufruf):
 *   1 HTML + max. 12 Bilder + 8 CSS + 8 JS = max. 29 Requests.
 *
 * Input : { url: string }
 * Output: { url, timestamp, document, byType: {images, css, js}, totals }
 */

const FETCH_TIMEOUT_MS = 10000;
const RESOURCE_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2_000_000;
const LIMITS = { images: 12, css: 8, js: 8 };
const CONCURRENCY = 6;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0 (compatible; WebsiteSpeedTest/1.0)';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  let target;
  try {
    target = new URL(String(body?.url ?? ''));
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error();
    if (!target.hostname.includes('.')) throw new Error();
  } catch {
    return jsonResponse({ error: 'Invalid URL. Try https://example.com' }, 400);
  }

  // 1. HTML-Dokument laden und messen
  const doc = await timedFetch(target.href, FETCH_TIMEOUT_MS, { wantText: true });
  if (!doc || doc.error) {
    return jsonResponse({ error: `Document not loadable: ${doc?.error ?? 'timeout'}` }, 502);
  }

  // 2. Ressourcen extrahieren (relativ → absolut, dedupliziert, gedeckelt)
  const extracted = extractResources(doc.text ?? '', doc.finalUrl ?? target.href);

  // 3. Jede Ressource einzeln messen (Batches, fehlerisoliert)
  const measured = { images: [], css: [], js: [] };
  let failed = 0;
  for (const type of Object.keys(measured)) {
    const urls = extracted[type].slice(0, LIMITS[type]);
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = await Promise.all(
        urls.slice(i, i + CONCURRENCY).map(async (resourceUrl) => {
          const result = await timedFetch(resourceUrl, RESOURCE_TIMEOUT_MS);
          return { url: resourceUrl, result };
        }),
      );
      for (const { url, result } of batch) {
        if (result && !result.error && result.status < 400) {
          measured[type].push({ url, bytes: result.bytes, timeMs: result.timeMs });
        } else {
          failed++;
        }
      }
    }
  }

  // 4. Aggregieren
  const byType = {};
  for (const type of Object.keys(measured)) {
    const items = measured[type].sort((a, b) => b.timeMs - a.timeMs);
    byType[type] = {
      found: extracted[type].length,
      tested: items.length,
      bytes: items.reduce((sum, item) => sum + item.bytes, 0),
      timeMs: items.reduce((sum, item) => sum + item.timeMs, 0),
      items,
    };
  }

  const resourceTimeTotal = Object.values(byType).reduce((sum, t) => sum + t.timeMs, 0);
  const slowestMs = Math.max(0, ...Object.values(byType).flatMap((t) => t.items.map((i) => i.timeMs)));
  const totalBytes = doc.bytes + Object.values(byType).reduce((sum, t) => sum + t.bytes, 0);

  return jsonResponse({
    url: target.href,
    timestamp: new Date().toISOString(),
    document: { timeMs: doc.timeMs, bytes: doc.bytes, status: doc.status },
    byType,
    totals: {
      requests: 1 + Object.values(byType).reduce((sum, t) => sum + t.tested, 0),
      bytes: totalBytes,
      failed,
      truncated: Object.keys(LIMITS).some((type) => extracted[type].length > LIMITS[type]),
      // Grobe Schätzung: Browser laden ~6 Ressourcen parallel →
      // Dokument + max(langsamste Ressource, Gesamtzeit/6)
      estimatedLoadMs: Math.round(doc.timeMs + Math.max(slowestMs, resourceTimeTotal / 6)),
    },
  });
}

// ---------- Ressourcen aus HTML extrahieren (Regex, läuft in Workers UND Node) ----------

export function extractResources(html, baseUrl) {
  const images = new Set();
  const css = new Set();
  const js = new Set();

  const resolve = (raw) => {
    try {
      const url = new URL(raw.trim(), baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.href;
    } catch {
      return null;
    }
  };

  // <img src / data-src (Lazy Loading) / erste srcset-Quelle>
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src =
      tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bsrcset\s*=\s*["']\s*([^\s,"']+)/i)?.[1];
    const resolved = src && resolve(src);
    if (resolved) images.add(resolved);
  }

  // <link rel="stylesheet" href> (rel/href in beliebiger Reihenfolge)
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const resolved = href && resolve(href);
    if (resolved) css.add(resolved);
  }

  // <script src>
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const resolved = src && resolve(src);
    if (resolved) js.add(resolved);
  }

  return { images: [...images], css: [...css], js: [...js] };
}

// ---------- Einzelmessung ----------

async function timedFetch(url, timeoutMs, { wantText = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: '*/*', 'cache-control': 'no-cache' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    const buffer = await response.arrayBuffer();
    clearTimeout(timer);
    const result = {
      timeMs: Date.now() - started,
      bytes: buffer.byteLength,
      status: response.status,
      finalUrl: response.url,
    };
    if (wantText) {
      result.text = new TextDecoder('utf-8', { fatal: false }).decode(
        buffer.slice(0, MAX_HTML_BYTES),
      );
    }
    return result;
  } catch (error) {
    clearTimeout(timer);
    return { error: String(error?.message ?? error) };
  }
}
