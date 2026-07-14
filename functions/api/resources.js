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
          measured[type].push({
            url,
            bytes: result.bytes,
            timeMs: result.timeMs,
            format: fileFormat(url, result.headers?.contentType),
            compression: result.headers?.compression ?? 'none',
            cached: result.headers?.cached ?? false,
            cdn: result.headers?.cdn ?? null,
          });
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

  // Aggregierte Optimierungs-Signale über alle Ressourcen
  const allItems = Object.values(byType).flatMap((t) => t.items);
  const insights = {
    uncompressedCount: allItems.filter((i) => i.compression === 'none' && i.bytes > 30_000).length,
    uncachedCount: allItems.filter((i) => !i.cached).length,
    cdnUsed: [...new Set(allItems.map((i) => i.cdn).filter(Boolean))],
    legacyImages: byType.images.items.filter((i) => /jpg|jpeg|png|gif/.test(i.format ?? '')).length,
  };

  return jsonResponse({
    url: target.href,
    timestamp: new Date().toISOString(),
    document: {
      timeMs: doc.timeMs,
      bytes: doc.bytes,
      status: doc.status,
      compression: doc.headers?.compression ?? 'none',
      cdn: doc.headers?.cdn ?? null,
    },
    byType,
    insights,
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

// Dateiformat aus Content-Type bzw. URL-Endung
export function fileFormat(url, contentType) {
  if (contentType) {
    const sub = contentType.split('/')[1];
    if (sub) return sub.replace('+xml', '').replace('javascript', 'js').toLowerCase();
  }
  const ext = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url)?.[1];
  return ext ? ext.toLowerCase() : null;
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
      headers: analyzeHeaders(response.headers),
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

// Kompression, Caching und CDN aus den Response-Headern ableiten
export function analyzeHeaders(headers) {
  const get = (name) => headers.get(name) ?? null;
  const encoding = (get('content-encoding') ?? '').toLowerCase();
  const cacheControl = get('cache-control');
  const server = (get('server') ?? '').toLowerCase();
  const via = (get('via') ?? '').toLowerCase();

  // CDN-Erkennung über verräterische Header
  let cdn = null;
  if (get('cf-ray') || server.includes('cloudflare')) cdn = 'Cloudflare';
  else if (get('x-amz-cf-id') || via.includes('cloudfront')) cdn = 'CloudFront';
  else if (get('x-fastly-request-id') || via.includes('fastly') || server.includes('fastly')) cdn = 'Fastly';
  else if (get('x-vercel-id') || server.includes('vercel')) cdn = 'Vercel';
  else if (get('x-nf-request-id') || server.includes('netlify')) cdn = 'Netlify';
  else if (get('x-akamai-transformed') || via.includes('akamai')) cdn = 'Akamai';
  else if (get('x-cache') || get('age')) cdn = 'CDN/Cache';

  // Cache-Bewertung: hat die Ressource eine sinnvolle Caching-Anweisung?
  const maxAge = cacheControl && /max-age=(\d+)/.exec(cacheControl)?.[1];
  const cached =
    (maxAge && Number(maxAge) > 0) || /immutable/.test(cacheControl ?? '') || Boolean(get('etag'));

  return {
    compression: /br/.test(encoding) ? 'brotli' : /gzip/.test(encoding) ? 'gzip' : /deflate/.test(encoding) ? 'deflate' : 'none',
    cacheControl,
    cached: Boolean(cached),
    maxAge: maxAge ? Number(maxAge) : null,
    cdn,
    contentType: (get('content-type') ?? '').split(';')[0] || null,
  };
}
