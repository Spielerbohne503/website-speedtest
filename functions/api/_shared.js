/**
 * Gemeinsame Helfer für alle API-Endpunkte (Dateiname mit _ → keine Route).
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const UA = 'Mozilla/5.0 (compatible; WebsiteSpeedTest/1.0; +https://github.com)';

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// fetch mit hartem Timeout (AbortController)
export async function fetchWithTimeout(resource, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function parseUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url;
  } catch {
    return null;
  }
}

// Registrable-Domain-Heuristik (ohne PSL): letzte zwei Labels,
// bzw. drei bei bekannten zweistufigen TLDs (co.uk etc.)
const TWO_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'co.nz', 'com.au', 'com.br', 'co.za', 'com.mx',
]);

export function registrableDomain(hostname) {
  const parts = hostname.replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}
