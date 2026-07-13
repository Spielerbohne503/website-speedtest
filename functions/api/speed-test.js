/**
 * Cloudflare Pages Function: POST /api/speed-test
 *
 * Messstrategie (Cloudflare Workers können ihren Abrufstandort NICHT wählen,
 * echte Proxy-Server in 9 Ländern existieren nicht):
 *   1. PRIMÄR  – Globalping API (api.globalping.io): echte HTTP-Messungen von
 *      echten Probes im gewünschten Land (TTFB, Total, Statuscode).
 *   2. FALLBACK – direkte fetch()-Messung vom Cloudflare Edge (bis 30 Repeats),
 *      als source:"edge" gekennzeichnet (kein echter Länderstandort).
 *
 * Jede URL×Land-Kombination ist fehlerisoliert: Fehler → error-Eintrag,
 * die übrigen Kombinationen laufen weiter.
 *
 * Input : { urls: [string], proxies: [{country, city}], repeats: 1..30 }
 * Output: { timestamp, data: [technisch], simplified: [einfache Sprache], warnings }
 */

const GLOBALPING_API = 'https://api.globalping.io/v1/measurements';
const FETCH_TIMEOUT_MS = 10000;
const GP_POLL_INTERVAL_MS = 750;
const GP_POLL_MAX = 24; // ~18s Gesamtwartezeit pro Messung
const MAX_URLS = 10;
const MAX_PROXIES = 9;
const MAX_REPEATS = 30;
const MAX_GP_PROBES = 5; // Free-Tier: wenige Probes pro Land statt 30 Wiederholungen

// Schwellen in ms: ✅ <1500 · ⚠️ 1500–2500 · ❌ >2500
const THRESHOLD_GOOD = 1500;
const THRESHOLD_WARN = 2500;

// Empfehlungstexte (Deutsch = API-Standard; das Frontend übersetzt über den Key)
const REC_TEXT = {
  rec_none: 'Nichts ändern',
  rec_cdn: 'CDN aktivieren',
  rec_server: 'Server upgraden',
  rec_images: 'Bilder optimieren',
  rec_unreachable: 'Erreichbarkeit prüfen (Server/DNS)',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const { urls, proxies, repeats, warnings, error } = validateInput(body);
  if (error) return jsonResponse({ error }, 400);

  const data = [];
  const simplified = [];
  for (const url of urls) {
    for (const proxy of proxies) {
      // Fehlerisolierung: eine kaputte Kombination bricht die übrigen nicht ab
      const combo = await measureCombo(url, proxy, repeats);
      data.push(combo.data);
      simplified.push(combo.simplified);
    }
  }

  return jsonResponse({
    timestamp: new Date().toISOString(),
    data,
    simplified,
    ...(warnings.length ? { warnings } : {}),
  });
}

// ---------- Validierung ----------

export function validateInput(body) {
  const warnings = [];
  if (!body || !Array.isArray(body.urls) || !Array.isArray(body.proxies)) {
    return { error: 'Expected { urls: [], proxies: [], repeats }' };
  }

  const urls = [];
  for (const raw of body.urls.slice(0, MAX_URLS)) {
    try {
      const parsed = new URL(String(raw));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
      if (!parsed.hostname.includes('.')) throw new Error();
      urls.push(parsed.href);
    } catch {
      // Ungültige URL überspringen, andere trotzdem testen (Spec Szenario 3)
      warnings.push(`Invalid URL skipped: ${String(raw).slice(0, 200)}`);
    }
  }
  if (!urls.length) return { error: 'No valid URLs. Try https://example.com' };

  const proxies = [];
  for (const proxy of body.proxies.slice(0, MAX_PROXIES)) {
    const country = String(proxy?.country ?? '').toUpperCase();
    if (/^[A-Z]{2}$/.test(country)) {
      proxies.push({ country, city: String(proxy?.city ?? '').slice(0, 60) });
    } else {
      warnings.push(`Invalid proxy skipped: ${JSON.stringify(proxy).slice(0, 100)}`);
    }
  }
  if (!proxies.length) return { error: 'No valid proxies (need [{country: "DE", city: "Berlin"}])' };

  const repeats = Math.min(MAX_REPEATS, Math.max(1, Math.trunc(Number(body.repeats) || 5)));
  return { urls, proxies, repeats, warnings };
}

// ---------- Messung pro Kombination ----------

async function measureCombo(url, proxy, repeats) {
  let samples = [];
  let attempts = 0;
  let source = 'globalping';
  let sourceCity = null;
  let comboError = null;

  try {
    const gp = await measureViaGlobalping(url, proxy, repeats);
    samples = gp.samples;
    attempts = gp.attempts;
    sourceCity = gp.city;
  } catch (gpError) {
    // Fallback: direkte Messung vom Cloudflare Edge (Spec Szenario 2)
    source = 'edge';
    try {
      const edge = await measureViaEdge(url, repeats);
      samples = edge.samples;
      attempts = edge.attempts;
    } catch (edgeError) {
      source = 'error';
      comboError = `globalping: ${gpError.message}; edge: ${edgeError.message}`;
      attempts = repeats;
    }
  }

  return buildResult({ url, proxy, samples, attempts, source, sourceCity, comboError });
}

// ---------- Globalping (echte Länder-Messung) ----------

async function measureViaGlobalping(url, proxy, repeats) {
  const target = new URL(url);
  const createResponse = await fetchWithTimeout(
    GLOBALPING_API,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'http',
        target: target.hostname,
        inProgressUpdates: false,
        locations: [{ country: proxy.country, limit: Math.min(repeats, MAX_GP_PROBES) }],
        measurementOptions: {
          protocol: target.protocol === 'http:' ? 'HTTP' : 'HTTPS',
          ...(target.port ? { port: Number(target.port) } : {}),
          request: {
            method: 'GET',
            path: target.pathname || '/',
            ...(target.search ? { query: target.search.slice(1) } : {}),
          },
        },
      }),
    },
    FETCH_TIMEOUT_MS,
  );

  if (createResponse.status === 429) throw new Error('rate-limited');
  if (createResponse.status === 422) throw new Error(`no probes in ${proxy.country}`);
  if (createResponse.status !== 202) throw new Error(`create failed (${createResponse.status})`);
  const { id } = await createResponse.json();

  for (let poll = 0; poll < GP_POLL_MAX; poll++) {
    await sleep(GP_POLL_INTERVAL_MS);
    const pollResponse = await fetchWithTimeout(`${GLOBALPING_API}/${id}`, {}, FETCH_TIMEOUT_MS);
    if (!pollResponse.ok) continue;
    const measurement = await pollResponse.json();
    if (measurement.status === 'finished') return extractGlobalpingSamples(measurement);
  }
  throw new Error('poll timeout');
}

function extractGlobalpingSamples(measurement) {
  const samples = [];
  let city = null;
  const results = measurement.results ?? [];
  for (const probeResult of results) {
    const result = probeResult.result ?? {};
    city = city ?? probeResult.probe?.city ?? null;
    const timings = result.timings ?? {};
    if (result.status === 'finished' && Number.isFinite(timings.total)) {
      samples.push({
        totalMs: timings.total,
        ttfbMs: Number.isFinite(timings.firstByte) ? timings.firstByte : null,
        statusCode: result.statusCode ?? 0,
        bytes: null, // Globalping kürzt Response-Bodies, Größe wäre irreführend
      });
    }
  }
  if (!samples.length) throw new Error('no successful probes');
  return { samples, attempts: results.length, city };
}

// ---------- Edge-Fallback (direkte Messung) ----------

async function measureViaEdge(url, repeats) {
  const samples = [];
  let attempts = 0;
  for (let i = 0; i < repeats; i++) {
    attempts++;
    const sample = await timedFetch(url);
    if (sample) samples.push(sample);
  }
  if (!samples.length) throw new Error('all requests failed or timed out');
  return { samples, attempts };
}

// Einzelmessung mit Timeout 10s; bei Fehler 1 Retry, dann null (Spec: Retry 1x, dann skip)
async function timedFetch(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; WebsiteSpeedTest/1.0)',
          accept: 'text/html,application/xhtml+xml,*/*',
          'cache-control': 'no-cache',
        },
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      const ttfbMs = Date.now() - started;
      const buffer = await response.arrayBuffer();
      clearTimeout(timer);
      return {
        totalMs: Date.now() - started,
        ttfbMs,
        statusCode: response.status,
        bytes: buffer.byteLength,
      };
    } catch {
      clearTimeout(timer);
      // weiter zum Retry bzw. null
    }
  }
  return null;
}

// ---------- Statistik & Aufbereitung ----------

export function computeStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mean = sum / sorted.length;
  const variance = sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sorted.length;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return {
    mean: Math.round(mean),
    stdDev: Math.round(Math.sqrt(variance)),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
    median: Math.round(median),
  };
}

export function classify(meanMs) {
  if (meanMs == null || !Number.isFinite(meanMs)) return 'danger';
  if (meanMs < THRESHOLD_GOOD) return 'success';
  if (meanMs <= THRESHOLD_WARN) return 'warning';
  return 'danger';
}

// Empfehlung aus dem Mess-Breakdown ableiten
export function recommend({ ok, meanMs, ttfbMeanMs, bytesMean }) {
  if (!ok) return 'rec_unreachable';
  if (meanMs < THRESHOLD_GOOD) return 'rec_none';
  // Langsam: dominiert die Server-Antwortzeit (TTFB) oder der Download?
  if (ttfbMeanMs != null && ttfbMeanMs > meanMs * 0.6) {
    return meanMs > THRESHOLD_WARN ? 'rec_server' : 'rec_cdn';
  }
  if (bytesMean != null && bytesMean > 1_500_000) return 'rec_images';
  return 'rec_cdn';
}

function mostCommonStatus(samples) {
  const counts = new Map();
  for (const sample of samples) {
    counts.set(sample.statusCode, (counts.get(sample.statusCode) ?? 0) + 1);
  }
  let best = null;
  for (const [code, count] of counts) {
    if (!best || count > best.count) best = { code, count };
  }
  return best?.code ?? 0;
}

function buildResult({ url, proxy, samples, attempts, source, sourceCity, comboError }) {
  // "Erfolg" = HTTP < 400; 4xx/5xx zählen als erreichbar, aber fehlgeschlagen
  const okSamples = samples.filter((s) => s.statusCode > 0 && s.statusCode < 400);
  const stats = computeStats(okSamples.map((s) => s.totalMs));
  const ttfbValues = okSamples.map((s) => s.ttfbMs).filter((v) => Number.isFinite(v));
  const bytesValues = okSamples.map((s) => s.bytes).filter((v) => Number.isFinite(v));
  const ttfbMean = ttfbValues.length
    ? Math.round(ttfbValues.reduce((a, b) => a + b, 0) / ttfbValues.length)
    : null;
  const bytesMean = bytesValues.length
    ? Math.round(bytesValues.reduce((a, b) => a + b, 0) / bytesValues.length)
    : null;
  const successRate = attempts ? Math.round((okSamples.length / attempts) * 100) : 0;

  const ok = stats != null;
  const level = ok ? classify(stats.mean) : 'danger';
  const recommendationKey = recommend({ ok, meanMs: stats?.mean, ttfbMeanMs: ttfbMean, bytesMean });

  return {
    data: {
      url,
      proxy: proxy.country,
      city: proxy.city,
      mean: stats?.mean ?? null,
      stdDev: stats?.stdDev ?? null,
      min: stats?.min ?? null,
      max: stats?.max ?? null,
      median: stats?.median ?? null,
      ttfbMean,
      contentLength: bytesMean,
      status: ok ? mostCommonStatus(okSamples) : mostCommonStatus(samples),
      successRate,
      samples: samples.length,
      attempts,
      source,
      sourceCity,
      ...(comboError ? { error: comboError } : {}),
    },
    simplified: {
      url,
      country: proxy.country,
      city: proxy.city,
      loadTime: ok ? `${(stats.mean / 1000).toFixed(2)}s` : '–',
      status: level,
      statusEmoji: { success: '✅', warning: '⚠️', danger: '❌' }[level],
      statusText: ok
        ? { success: 'SUPER', warning: 'OK', danger: 'LANGSAM' }[level]
        : 'FEHLER',
      recommendation: REC_TEXT[recommendationKey],
      recommendationKey,
      source,
      successRate,
    },
  };
}

// fetch mit hartem Timeout (AbortController), wirft bei Abbruch
async function fetchWithTimeout(resource, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
