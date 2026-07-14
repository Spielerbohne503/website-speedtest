/**
 * api/audit – Orchestrierung des vollständigen Website-Audits.
 *
 * Ablauf (client-seitig, damit Fortschritt + Fehlerisolierung sauber sind):
 *   1. Crawl in Wellen (loop /api/crawl bis done)      → Seitenliste, Broken Links
 *   2. Subdomain-Discovery (/api/subdomains)           → CT-Log-Hosts
 *   3. Pro Seite (gedeckelt): /api/resources + /api/security
 *   4. Lighthouse via /api/lighthouse für die Top-N-Seiten (mobil + optional desktop)
 *
 * Jeder Schritt ist fehlertolerant: ein Ausfall stoppt das Audit nicht,
 * er landet in `errors` und der Rest läuft weiter.
 */
import axios from 'axios';

const api = axios.create({ timeout: 120000 });

const RESOURCE_CONCURRENCY = 3;

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

/**
 * @param options { url, crawlLimit, wantSubdomains, wantLighthouse, lighthouseCount, desktop, lighthousePages }
 * @param onProgress (phaseKey, done, total, label?) => void
 */
export async function runAudit(options, onProgress) {
  const {
    url,
    crawlLimit = 50,
    wantSubdomains = true,
    wantLighthouse = true,
    lighthouseCount = 5,
    desktop = false,
  } = options;

  const errors = [];
  const report = {
    url,
    origin: new URL(url).origin,
    timestamp: new Date().toISOString(),
    pages: [],
    subdomains: null,
    lighthouse: [],
    perPage: [],
    errors,
  };

  // ---------- 1. Crawl (Wellen) ----------
  let visited = [];
  let frontier = [];
  let done = false;
  let guard = 0;
  onProgress?.('crawl', 0, crawlLimit);
  while (!done && guard++ < crawlLimit + 5) {
    try {
      const { data } = await api.post('/api/crawl', { url, limit: crawlLimit, visited, frontier });
      report.pages.push(...data.results);
      visited = data.visited;
      frontier = data.frontier;
      done = data.done;
      onProgress?.('crawl', Math.min(data.count, crawlLimit), crawlLimit);
    } catch (error) {
      errors.push({ phase: 'crawl', message: error.message });
      break;
    }
  }
  report.brokenLinks = report.pages.filter((p) => p.status === 0 || p.status >= 400);

  // ---------- 2. Subdomains ----------
  if (wantSubdomains) {
    onProgress?.('subdomains', 0, 1);
    try {
      const { data } = await api.post('/api/subdomains', { domain: new URL(url).hostname });
      report.subdomains = data;
    } catch (error) {
      errors.push({ phase: 'subdomains', message: error.message });
    }
    onProgress?.('subdomains', 1, 1);
  }

  // ---------- 3. Ressourcen + Security pro Seite ----------
  // HTML-Seiten mit Status 2xx, gedeckelt (Subrequest-/Zeit-Budget)
  const htmlPages = report.pages
    .filter((p) => p.status >= 200 && p.status < 300 && (!p.type || p.type.includes('html')))
    .slice(0, Math.min(crawlLimit, 25));
  onProgress?.('resources', 0, htmlPages.length);
  let resDone = 0;
  report.perPage = await runPool(htmlPages, RESOURCE_CONCURRENCY, async (page) => {
    const entry = { url: page.url, resources: null, security: null };
    const [res, sec] = await Promise.allSettled([
      api.post('/api/resources', { url: page.url }),
      api.post('/api/security', { url: page.url }),
    ]);
    if (res.status === 'fulfilled') entry.resources = res.value.data;
    else errors.push({ phase: 'resources', url: page.url, message: res.reason?.message });
    if (sec.status === 'fulfilled') entry.security = sec.value.data;
    else errors.push({ phase: 'security', url: page.url, message: sec.reason?.message });
    onProgress?.('resources', ++resDone, htmlPages.length);
    return entry;
  });

  // ---------- 4. Lighthouse (Top-N) ----------
  if (wantLighthouse) {
    const targets = htmlPages.slice(0, lighthouseCount);
    const strategies = desktop ? ['mobile', 'desktop'] : ['mobile'];
    const jobs = targets.flatMap((page) => strategies.map((strategy) => ({ url: page.url, strategy })));
    onProgress?.('lighthouse', 0, jobs.length);
    let lhDone = 0;
    // Sequenziell: PSI ist langsam und rate-limitiert
    for (const job of jobs) {
      try {
        const { data } = await api.post('/api/lighthouse', job);
        if (data.error) {
          errors.push({ phase: 'lighthouse', url: job.url, message: data.error, rateLimited: data.rateLimited });
        } else {
          report.lighthouse.push(data);
        }
      } catch (error) {
        errors.push({ phase: 'lighthouse', url: job.url, message: error.message });
      }
      onProgress?.('lighthouse', ++lhDone, jobs.length);
    }
  }

  report.summary = summarize(report);
  return report;
}

// Aggregat + priorisierte Empfehlungen
function summarize(report) {
  const totalBytes = report.perPage.reduce((sum, p) => sum + (p.resources?.totals?.bytes ?? 0), 0);
  const avgPerf = average(report.lighthouse.map((l) => l.scores?.performance).filter((n) => n != null));
  const securityGrades = report.perPage.map((p) => p.security?.grade).filter(Boolean);
  const recommendations = buildRecommendations(report);
  return {
    pageCount: report.pages.length,
    htmlPageCount: report.perPage.length,
    brokenCount: report.brokenLinks?.length ?? 0,
    subdomainCount: report.subdomains?.subdomains?.length ?? 0,
    totalBytes,
    avgPerformance: avgPerf,
    worstSecurityGrade: securityGrades.sort().pop() ?? null,
    recommendations,
  };
}

function average(nums) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

// Priorisierte, konkrete Optimierungsvorschläge über die ganze Site
function buildRecommendations(report) {
  const recs = [];
  const push = (priority, key, text, gain) => recs.push({ priority, key, text, gain });

  // Broken Links
  if (report.brokenLinks?.length) {
    push('high', 'broken', `${report.brokenLinks.length} nicht erreichbare Seite(n)/Link(s) (4xx/5xx)`, 'Stabilität & SEO');
  }

  // Lighthouse-Chancen aggregieren
  const oppMap = new Map();
  for (const lh of report.lighthouse) {
    for (const opp of lh.opportunities ?? []) {
      const cur = oppMap.get(opp.title) ?? { savingsMs: 0, count: 0 };
      oppMap.set(opp.title, { savingsMs: cur.savingsMs + opp.savingsMs, count: cur.count + 1 });
    }
  }
  for (const [title, { savingsMs, count }] of [...oppMap.entries()].sort((a, b) => b[1].savingsMs - a[1].savingsMs).slice(0, 5)) {
    push('high', 'lh', title, `≈ ${Math.round(savingsMs / count)} ms/Seite`);
  }

  // Ressourcen-Signale aggregieren
  const legacyImages = report.perPage.reduce((sum, p) => sum + (p.resources?.insights?.legacyImages ?? 0), 0);
  const uncompressed = report.perPage.reduce((sum, p) => sum + (p.resources?.insights?.uncompressedCount ?? 0), 0);
  const uncached = report.perPage.reduce((sum, p) => sum + (p.resources?.insights?.uncachedCount ?? 0), 0);
  if (legacyImages > 0) push('medium', 'img', `${legacyImages} Bild(er) im Alt-Format (JPG/PNG/GIF) – WebP/AVIF spart oft 25–50 %`, 'Bytes & LCP');
  if (uncompressed > 0) push('medium', 'compress', `${uncompressed} große Ressource(n) ohne Kompression – Brotli/Gzip aktivieren`, 'Transfergröße');
  if (uncached > 0) push('low', 'cache', `${uncached} Ressource(n) ohne wirksames Caching – Cache-Control setzen`, 'Wiederkehrende Besuche');

  // Security-Findings aggregieren
  const secKeys = new Map();
  for (const p of report.perPage) {
    for (const f of p.security?.findings ?? []) {
      if (['critical', 'serious'].includes(f.level)) secKeys.set(f.key, f);
    }
  }
  for (const f of secKeys.values()) {
    push(f.level === 'critical' ? 'high' : 'medium', 'sec', f.text, 'Sicherheit');
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}
