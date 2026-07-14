/**
 * POST /api/security – Sicherheits- und Infrastruktur-Checks.
 *
 * Analysiert die Response-Header des Dokuments: HTTPS-Redirect, HSTS, CSP,
 * X-Frame-Options, weitere Security-Header, Cookie-Flags, Kompression,
 * CDN, Server, HTTP-Redirect-Kette. TLS-Version/Protokoll ist aus einem
 * Worker-`fetch` nicht auslesbar und wird als Limitation ausgewiesen.
 *
 * Input : { url }
 * Output: { url, https, headers:{...}, grade, findings:[{level,key,text}] }
 */
import { UA, jsonResponse, corsPreflight, fetchWithTimeout, parseUrl } from './_shared.js';

const TIMEOUT_MS = 12000;

const SECURITY_HEADERS = {
  'strict-transport-security': 'HSTS',
  'content-security-policy': 'CSP',
  'x-frame-options': 'X-Frame-Options',
  'x-content-type-options': 'X-Content-Type-Options',
  'referrer-policy': 'Referrer-Policy',
  'permissions-policy': 'Permissions-Policy',
};

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

  const target = parseUrl(body?.url);
  if (!target) return jsonResponse({ error: 'Invalid URL' }, 400);

  // HTTP → prüfen, ob auf HTTPS umgeleitet wird
  let httpRedirectsToHttps = null;
  try {
    const httpUrl = new URL(target.href);
    httpUrl.protocol = 'http:';
    const httpResponse = await fetchWithTimeout(
      httpUrl.href,
      { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA } },
      TIMEOUT_MS,
    );
    const location = httpResponse.headers.get('location') ?? '';
    httpRedirectsToHttps =
      httpResponse.status >= 300 && httpResponse.status < 400 && location.startsWith('https://');
  } catch {
    httpRedirectsToHttps = null;
  }

  let response;
  try {
    response = await fetchWithTimeout(
      target.href,
      { method: 'GET', redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' } },
      TIMEOUT_MS,
    );
  } catch (error) {
    return jsonResponse({ error: `Request failed: ${String(error?.message ?? error)}` }, 502);
  }

  const headers = response.headers;
  const present = {};
  for (const [key, label] of Object.entries(SECURITY_HEADERS)) {
    present[label] = headers.get(key);
  }

  const cookies = analyzeCookies(headers);
  const findings = [];
  const add = (level, key, text) => findings.push({ level, key, text });

  // HTTPS / HSTS
  if (target.protocol !== 'https:') add('critical', 'https', 'Seite wird nicht über HTTPS ausgeliefert');
  if (httpRedirectsToHttps === false) add('serious', 'https-redirect', 'HTTP leitet nicht auf HTTPS um');
  if (!present.HSTS) add('serious', 'hsts', 'Kein HSTS-Header (Strict-Transport-Security)');

  // Security-Header
  if (!present.CSP) add('warning', 'csp', 'Keine Content-Security-Policy gesetzt');
  if (!present['X-Content-Type-Options']) add('warning', 'nosniff', 'X-Content-Type-Options: nosniff fehlt');
  if (!present['X-Frame-Options'] && !present.CSP) add('warning', 'clickjacking', 'Kein Clickjacking-Schutz (X-Frame-Options / CSP frame-ancestors)');
  if (!present['Referrer-Policy']) add('info', 'referrer', 'Keine Referrer-Policy gesetzt');
  if (!present['Permissions-Policy']) add('info', 'permissions', 'Keine Permissions-Policy gesetzt');

  // Cookies
  for (const cookie of cookies) {
    if (!cookie.secure) add('serious', 'cookie-secure', `Cookie "${cookie.name}" ohne Secure-Flag`);
    if (!cookie.httpOnly) add('warning', 'cookie-httponly', `Cookie "${cookie.name}" ohne HttpOnly-Flag`);
    if (!cookie.sameSite) add('info', 'cookie-samesite', `Cookie "${cookie.name}" ohne SameSite-Attribut`);
  }

  // Infrastruktur
  const compression = (headers.get('content-encoding') ?? '').toLowerCase();
  if (!/br|gzip|deflate/.test(compression)) add('warning', 'compression', 'Dokument wird nicht komprimiert (weder Brotli noch Gzip)');

  const grade = computeGrade(findings);

  return jsonResponse({
    url: target.href,
    https: target.protocol === 'https:',
    httpRedirectsToHttps,
    headers: {
      ...present,
      server: headers.get('server'),
      compression: /br/.test(compression) ? 'brotli' : /gzip/.test(compression) ? 'gzip' : compression || 'none',
      cdn: detectCdn(headers),
      // Alt-Svc verrät oft HTTP/3-Unterstützung
      http3: /h3/.test(headers.get('alt-svc') ?? ''),
    },
    cookies,
    findings,
    grade,
    note: 'TLS-Version und ausgehandeltes HTTP-Protokoll sind aus einem Cloudflare-Worker nicht direkt auslesbar.',
  });
}

function analyzeCookies(headers) {
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  // Cloudflare/Workers liefern Set-Cookie oft als eine kombinierte Zeile
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((chunk) => {
      const name = chunk.split('=')[0]?.trim();
      return {
        name: name?.slice(0, 40) ?? '?',
        secure: /;\s*secure/i.test(chunk),
        httpOnly: /;\s*httponly/i.test(chunk),
        sameSite: /;\s*samesite=(\w+)/i.exec(chunk)?.[1] ?? null,
      };
    })
    .slice(0, 10);
}

function detectCdn(headers) {
  const server = (headers.get('server') ?? '').toLowerCase();
  if (headers.get('cf-ray') || server.includes('cloudflare')) return 'Cloudflare';
  if (headers.get('x-amz-cf-id')) return 'CloudFront';
  if (headers.get('x-fastly-request-id') || server.includes('fastly')) return 'Fastly';
  if (headers.get('x-vercel-id')) return 'Vercel';
  if (headers.get('x-nf-request-id')) return 'Netlify';
  return null;
}

// Schulnote A–F aus gewichteten Findings
function computeGrade(findings) {
  const weights = { critical: 4, serious: 2, warning: 1, info: 0 };
  const penalty = findings.reduce((sum, f) => sum + (weights[f.level] ?? 0), 0);
  if (penalty === 0) return 'A';
  if (penalty <= 2) return 'B';
  if (penalty <= 4) return 'C';
  if (penalty <= 7) return 'D';
  if (penalty <= 11) return 'E';
  return 'F';
}
