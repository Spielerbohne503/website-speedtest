/**
 * api/client – Orchestrierung der Speed-Tests.
 *
 * Sendet pro URL×Land-Kombination EINEN Request an /api/speed-test
 * (statt einem großen Batch), weil:
 *  - Cloudflare Free-Plan max. 50 Subrequests pro Worker-Invocation erlaubt
 *  - die ProgressBar so echte Granularität bekommt
 *  - ein Fehler nur eine Kombination betrifft (Fehlerisolierung)
 *
 * Retry: max. 3 Wiederholungen mit 5s Abstand bei Timeout/Netzwerk/5xx.
 */
import axios from 'axios';
import { classify, statusEmoji } from '../utils/metrics';

const api = axios.create({ timeout: 90000 });
const CONCURRENCY = 2;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(error) {
  if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK') return true;
  const status = error.response?.status;
  return status != null && status >= 500;
}

async function testCombo(url, proxy, repeats) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await api.post('/api/speed-test', {
        urls: [url],
        proxies: [proxy],
        repeats,
      });
      return data;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_RETRIES) break;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

// data[i] + simplified[i] aus der Worker-Antwort zu einer Anzeige-Zeile mergen
function toRow(tech, simple) {
  const meanMs = Number.isFinite(tech?.mean) ? tech.mean : null;
  const level = simple?.status ?? classify(meanMs);
  return {
    url: tech?.url ?? simple?.url,
    country: simple?.country ?? tech?.proxy,
    city: simple?.city ?? tech?.city,
    meanMs,
    stdDev: tech?.stdDev ?? null,
    min: tech?.min ?? null,
    max: tech?.max ?? null,
    median: tech?.median ?? null,
    ttfbMean: tech?.ttfbMean ?? null,
    httpStatus: tech?.status ?? null,
    successRate: tech?.successRate ?? 0,
    contentLength: tech?.contentLength ?? null,
    source: tech?.source ?? 'error',
    sourceCity: tech?.sourceCity ?? null,
    level,
    statusEmoji: simple?.statusEmoji ?? statusEmoji(level),
    recommendationKey: simple?.recommendationKey ?? 'rec_unreachable',
    recommendation: simple?.recommendation ?? '',
    loadTime: simple?.loadTime ?? '–',
    error: tech?.error ?? null,
  };
}

// Ressourcen-Analyse (Bilder/CSS/JS) einer URL – ein Aufruf pro URL,
// Fehler werden toleriert (dann fehlt nur die Ressourcen-Karte)
async function analyzeResources(url) {
  const { data } = await api.post('/api/resources', { url });
  return data;
}

/**
 * Führt alle URL×Land-Kombinationen aus (Concurrency 2) und meldet Fortschritt.
 * Parallel läuft pro URL eine Ressourcen-Analyse (Bilder/CSS/JS).
 * Fehler einzelner Kombinationen brechen NICHT ab, sondern landen in `errors`.
 * @returns {Promise<{timestamp, rows, raw, resources, errors}>}
 */
export async function runSpeedTest(urls, proxies, repeats, onProgress) {
  const combos = [];
  for (const url of urls) for (const proxy of proxies) combos.push({ url, proxy });

  const total = combos.length + urls.length; // + 1 Ressourcen-Analyse pro URL
  let done = 0;
  const rows = new Array(combos.length).fill(null);
  const raw = { timestamp: new Date().toISOString(), data: [], simplified: [] };
  const errors = [];
  onProgress?.(0, total);

  const resourcesPromise = Promise.all(
    urls.map(async (url) => {
      try {
        const analysis = await analyzeResources(url);
        done++;
        onProgress?.(done, total);
        return analysis;
      } catch (error) {
        errors.push({ url, country: null, message: `resources: ${error.message}` });
        done++;
        onProgress?.(done, total);
        return null;
      }
    }),
  );

  let cursor = 0;
  async function worker() {
    while (cursor < combos.length) {
      const index = cursor++;
      const { url, proxy } = combos[index];
      try {
        const res = await testCombo(url, proxy, repeats);
        rows[index] = toRow(res.data?.[0], res.simplified?.[0]);
      } catch (error) {
        errors.push({ url, country: proxy.country, message: error.message });
        rows[index] = toRow(
          { url, proxy: proxy.country, city: proxy.city, source: 'error', error: error.message },
          null,
        );
      }
      done++;
      onProgress?.(done, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, combos.length) }, worker));
  const resources = (await resourcesPromise).filter(Boolean);
  raw.resources = resources;

  const validRows = rows.filter(Boolean);
  for (const row of validRows) {
    raw.data.push({
      url: row.url,
      proxy: row.country,
      city: row.city,
      mean: row.meanMs,
      stdDev: row.stdDev,
      min: row.min,
      max: row.max,
      median: row.median,
      status: row.httpStatus,
      successRate: row.successRate,
      source: row.source,
      error: row.error ?? undefined,
    });
    raw.simplified.push({
      country: row.country,
      city: row.city,
      loadTime: row.loadTime,
      status: row.level,
      statusEmoji: row.statusEmoji,
      recommendation: row.recommendation,
    });
  }

  return { timestamp: raw.timestamp, rows: validRows, raw, resources, errors };
}

// Fehler → benutzerfreundlicher i18n-Schlüssel (kein technischer Stacktrace)
export function errorKey(error) {
  if (!isOnline()) return 'offline';
  if (error?.code === 'ECONNABORTED') return 'errorTimeout';
  if (error?.code === 'ERR_NETWORK') return 'errorNetwork';
  const status = error?.response?.status;
  if (status === 404) return 'error404';
  if (status != null && status >= 500) return 'error500';
  return 'errorGeneric';
}
