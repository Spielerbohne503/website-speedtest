/**
 * POST /api/subdomains – Subdomain-Discovery über Certificate Transparency Logs.
 *
 * Quelle: crt.sh (öffentliche CT-Log-Datenbank). Liefert alle je für die
 * Domain ausgestellten Zertifikats-Namen. Anschließend wird jede gefundene
 * Subdomain einmal geprobt (Status, Redirect, Server-Header).
 *
 * Hinweis: Nur öffentliche, passive Quellen. Bitte nur Domains auditieren,
 * die dir gehören oder für die du eine Freigabe hast.
 *
 * Input : { domain, probe?: bool }
 * Output: { domain, subdomains: [{host, status, server, redirectedTo, error}], source, total }
 */
import { UA, jsonResponse, corsPreflight, fetchWithTimeout, registrableDomain } from './_shared.js';

const CRT_TIMEOUT_MS = 20000;
const PROBE_TIMEOUT_MS = 8000;
const CONCURRENCY = 8;
const MAX_PROBE = 40;

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

  let host;
  try {
    host = String(body?.domain ?? '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (!host.includes('.')) throw new Error();
  } catch {
    return jsonResponse({ error: 'Invalid domain (e.g. example.com)' }, 400);
  }

  const base = registrableDomain(host);
  const names = await discoverNames(base);
  if (names.error) return jsonResponse({ error: `CT lookup failed: ${names.error}`, subdomains: [] }, 502);

  const hosts = names.hosts.slice(0, MAX_PROBE);
  const probe = body?.probe !== false;

  let subdomains;
  if (probe) {
    subdomains = [];
    for (let i = 0; i < hosts.length; i += CONCURRENCY) {
      const slice = hosts.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(slice.map(probeHost));
      subdomains.push(...settled);
    }
    // Erreichbare zuerst
    subdomains.sort((a, b) => (b.status > 0 ? 1 : 0) - (a.status > 0 ? 1 : 0) || a.host.localeCompare(b.host));
  } else {
    subdomains = hosts.map((host) => ({ host, status: null, server: null, redirectedTo: null, error: null }));
  }

  return jsonResponse({
    domain: base,
    subdomains,
    total: names.hosts.length,
    tested: subdomains.length,
    truncated: names.hosts.length > MAX_PROBE,
    source: names.source,
  });
}

// Zwei öffentliche CT-Quellen: crt.sh (primär, aber flaky) → CertSpotter (Fallback)
async function discoverNames(domain) {
  const crt = await withRetries(() => tryCrtSh(domain), 2);
  if (!crt.error && crt.hosts.length) return { ...crt, source: 'crt.sh (Certificate Transparency)' };
  const cs = await tryCertSpotter(domain);
  if (!cs.error && cs.hosts.length) return { ...cs, source: 'CertSpotter (Certificate Transparency)' };
  return { error: crt.error ?? cs.error ?? 'no results', hosts: [] };
}

async function withRetries(fn, retries) {
  let last = { error: 'unknown', hosts: [] };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
    last = await fn();
    if (!last.error) return last;
  }
  return last;
}

function dedupeHosts(set, domain) {
  return [...set].sort((a, b) => (a === domain ? -1 : b === domain ? 1 : a.localeCompare(b)));
}

// CertSpotter (kostenlose CT-Log-API, ohne Key für einfache Abfragen)
async function tryCertSpotter(domain) {
  try {
    const response = await fetchWithTimeout(
      `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names`,
      { headers: { 'user-agent': UA, accept: 'application/json' } },
      CRT_TIMEOUT_MS,
    );
    if (!response.ok) return { error: `HTTP ${response.status}`, hosts: [] };
    const entries = await response.json();
    const set = new Set();
    for (const entry of entries) {
      for (const name of entry.dns_names ?? []) {
        const host = String(name).toLowerCase().replace(/^\*\./, '');
        if (host.endsWith(domain) && !host.includes(' ') && host.includes('.')) set.add(host);
      }
    }
    return { hosts: dedupeHosts(set, domain) };
  } catch (error) {
    return { error: String(error?.message ?? error), hosts: [] };
  }
}

async function tryCrtSh(domain) {
  try {
    const response = await fetchWithTimeout(
      `https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`,
      { headers: { 'user-agent': UA, accept: 'application/json' } },
      CRT_TIMEOUT_MS,
    );
    if (!response.ok) return { error: `HTTP ${response.status}`, hosts: [] };
    const entries = await response.json();
    const set = new Set();
    for (const entry of entries) {
      for (const name of String(entry.name_value ?? '').split('\n')) {
        const host = name.trim().toLowerCase().replace(/^\*\./, '');
        if (host.endsWith(domain) && !host.includes(' ') && host.includes('.')) set.add(host);
      }
    }
    // Registrable-Domain selbst zuerst, dann alphabetisch
    return { hosts: dedupeHosts(set, domain) };
  } catch (error) {
    return { error: String(error?.message ?? error), hosts: [] };
  }
}

async function probeHost(host) {
  for (const scheme of ['https://', 'http://']) {
    try {
      const response = await fetchWithTimeout(
        `${scheme}${host}/`,
        { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA, accept: '*/*' }, cf: { cacheTtl: 0 } },
        PROBE_TIMEOUT_MS,
      );
      const location = response.headers.get('location');
      return {
        host,
        status: response.status,
        scheme: scheme.replace('://', ''),
        server: response.headers.get('server'),
        redirectedTo: response.status >= 300 && response.status < 400 ? location : null,
        error: null,
      };
    } catch {
      // nächstes Schema versuchen
    }
  }
  return { host, status: 0, scheme: null, server: null, redirectedTo: null, error: 'unreachable' };
}
