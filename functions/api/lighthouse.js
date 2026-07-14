/**
 * POST /api/lighthouse – Render-Metriken via Google PageSpeed Insights (PSI).
 *
 * PSI führt echtes Lighthouse in Google-Infrastruktur aus und liefert alle
 * Metriken, die ein Cloudflare Worker selbst nicht messen kann (echter
 * Browser nötig): LCP, FCP, CLS, INP, TBT, Speed Index, TTI sowie die
 * Lighthouse-Kategorien (Performance/A11y/Best Practices/SEO/PWA) und die
 * Feld-Daten (CrUX, falls vorhanden).
 *
 * API-Key optional (Umgebungsvariable PSI_API_KEY): ohne Key gelten strenge
 * Rate-Limits, mit kostenlosem Key ~25.000 Anfragen/Tag.
 *
 * Input : { url, strategy?: "mobile"|"desktop" }
 * Output: siehe buildResult() – lab, field, categories, audits, diagnostics
 */
import { jsonResponse, corsPreflight, fetchWithTimeout, parseUrl } from './_shared.js';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PSI_TIMEOUT_MS = 60000;

export function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const target = parseUrl(body?.url);
  if (!target) return jsonResponse({ error: 'Invalid URL' }, 400);
  const strategy = body?.strategy === 'desktop' ? 'desktop' : 'mobile';

  const params = new URLSearchParams({ url: target.href, strategy });
  for (const cat of ['performance', 'accessibility', 'best-practices', 'seo']) {
    params.append('category', cat);
  }
  const apiKey = env?.PSI_API_KEY;
  if (apiKey) params.set('key', apiKey);

  let payload;
  try {
    const response = await fetchWithTimeout(`${PSI_ENDPOINT}?${params}`, {}, PSI_TIMEOUT_MS);
    payload = await response.json();
    if (!response.ok || payload.error) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      const rateLimited = response.status === 429 || /quota|rate/i.test(message);
      return jsonResponse({ error: message, rateLimited, url: target.href, strategy }, response.status || 502);
    }
  } catch (error) {
    return jsonResponse({ error: `PSI request failed: ${String(error?.message ?? error)}` }, 502);
  }

  return jsonResponse(buildResult(payload, target.href, strategy));
}

function buildResult(payload, url, strategy) {
  const lhr = payload.lighthouseResult ?? {};
  const audits = lhr.audits ?? {};
  const categories = lhr.categories ?? {};
  const loadingExperience = payload.loadingExperience ?? {};

  const numeric = (id) => audits[id]?.numericValue ?? null;
  const display = (id) => audits[id]?.displayValue ?? null;

  // Lab-Daten (Lighthouse, ein Lauf)
  const lab = {
    fcp: numeric('first-contentful-paint'),
    lcp: numeric('largest-contentful-paint'),
    cls: numeric('cumulative-layout-shift'),
    tbt: numeric('total-blocking-time'),
    speedIndex: numeric('speed-index'),
    tti: numeric('interactive'),
    ttfb: numeric('server-response-time'),
    maxFid: numeric('max-potential-fid'),
  };

  // Feld-Daten (Chrome UX Report – echte Nutzer, falls verfügbar)
  const fieldMetrics = loadingExperience.metrics ?? {};
  const field = {
    hasData: Object.keys(fieldMetrics).length > 0,
    overall: loadingExperience.overall_category ?? null,
    lcp: pickField(fieldMetrics.LARGEST_CONTENTFUL_PAINT_MS),
    inp: pickField(fieldMetrics.INTERACTION_TO_NEXT_PAINT),
    cls: pickField(fieldMetrics.CUMULATIVE_LAYOUT_SHIFT_SCORE, 100),
    fcp: pickField(fieldMetrics.FIRST_CONTENTFUL_PAINT_MS),
    ttfb: pickField(fieldMetrics.EXPERIMENTAL_TIME_TO_FIRST_BYTE),
  };

  const scores = {};
  for (const [key, cat] of Object.entries(categories)) {
    scores[key] = cat.score == null ? null : Math.round(cat.score * 100);
  }

  // Wichtigste Optimierungs-Chancen (nach eingesparter Zeit sortiert)
  const opportunities = Object.values(audits)
    .filter((audit) => audit.details?.type === 'opportunity' && (audit.numericValue ?? 0) > 0)
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      savingsMs: Math.round(audit.numericValue),
      displayValue: audit.displayValue ?? null,
    }))
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 8);

  // Fehlgeschlagene Diagnose-Audits (Best Practices, Sicherheit, etc.)
  const diagnostics = Object.values(audits)
    .filter((audit) => audit.score !== null && audit.score < 0.9 && audit.details?.type !== 'opportunity')
    .filter((audit) => ['error', 'warning'].includes(audit.scoreDisplayMode) || audit.score < 0.5)
    .map((audit) => ({ id: audit.id, title: audit.title, score: audit.score }))
    .slice(0, 12);

  // Beobachtete Timings (WebPageTest-Stil): Start Render, DOMContentLoaded, Load
  const observed = audits.metrics?.details?.items?.[0] ?? {};
  const resourceSummary = extractResourceSummary(audits);
  const pagePerf = {
    fcp: lab.fcp,
    lcp: lab.lcp,
    cls: lab.cls,
    ttfb: lab.ttfb,
    startRender: observed.observedFirstVisualChange ?? observed.observedFirstPaint ?? lab.fcp,
    speedIndex: lab.speedIndex,
    tbt: lab.tbt,
    tti: lab.tti,
    domContentLoaded: observed.observedDomContentLoaded ?? null,
    load: observed.observedLoad ?? null,
    totalTime: observed.observedLastVisualChange ?? lab.tti,
    pageWeight: numeric('total-byte-weight'),
    requests: Object.values(resourceSummary).reduce((sum, r) => sum + (r.requests ?? 0), 0) || null,
  };

  // Filmstrip: base64-JPEG-Thumbnails mit Zeitstempel (data:-URIs)
  const filmstrip = (audits['screenshot-thumbnails']?.details?.items ?? []).map((frame) => ({
    timing: frame.timing,
    data: frame.data,
  }));
  const finalScreenshot = audits['final-screenshot']?.details?.data ?? null;

  return {
    url,
    strategy,
    timestamp: new Date().toISOString(),
    scores,
    lab,
    labDisplay: {
      fcp: display('first-contentful-paint'),
      lcp: display('largest-contentful-paint'),
      cls: display('cumulative-layout-shift'),
      tbt: display('total-blocking-time'),
      speedIndex: display('speed-index'),
      tti: display('interactive'),
    },
    field,
    pagePerf,
    filmstrip,
    finalScreenshot,
    opportunities,
    diagnostics,
    resourceSummary,
  };
}

function pickField(metric, divisor = 1) {
  if (!metric) return null;
  return {
    percentile: divisor === 1 ? metric.percentile : metric.percentile / divisor,
    category: metric.category ?? null,
  };
}

// "Resource Summary"-Audit: Requests + Bytes pro Ressourcen-Typ
function extractResourceSummary(audits) {
  const items = audits['resource-summary']?.details?.items ?? [];
  const summary = {};
  for (const item of items) {
    summary[item.resourceType] = { requests: item.requestCount, bytes: item.transferSize };
  }
  return summary;
}
