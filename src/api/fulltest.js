/**
 * api/fulltest – EIN Durchlauf, in dem beide Tests zusammenarbeiten:
 * die Einstellungen (Länder + Wiederholungen) gelten für den GESAMTEN Lauf.
 *
 *   1. Crawl + Subdomains + Ressourcen + Sicherheit + Lighthouse/CWV (runAudit)
 *   2. Länder-Speed über ALLE gecrawlten Seiten (nicht nur die Startseite),
 *      jeweils über die gewählten Länder × Wiederholungen (runSpeedTest)
 *
 * Ehrliche Grenze: Lighthouse/Render-Metriken laufen immer von Googles
 * Standort (PageSpeed Insights kennt keinen Länder-Parameter). Die echte
 * Länder-Messung ist die Netzwerk-Ebene (Globalping) – die deckt jetzt die
 * ganze gecrawlte Seite ab.
 *
 * onProgress(phaseKey, done, total).
 */
import { runSpeedTest } from './client';
import { runAudit } from './audit';

// So viele gecrawlte Seiten werden zusätzlich zur Startseite je Land gemessen.
// Deckelt die Zahl der Globalping-Messungen (Seiten × Länder) auf ein Maß,
// das das Free-Tier verkraftet (Fallback auf Edge greift bei Rate-Limits).
const MAX_SPEED_PAGES = 12;

export async function runEverything(options, onProgress) {
  const {
    url,
    proxies = [],
    repeats = 5,
    crawlLimit = 50,
    wantSubdomains = true,
    wantLighthouse = true,
    lighthouseCount = 5,
    desktop = false,
  } = options;

  // 1. Crawl + Subdomains + Ressourcen + Security + Lighthouse
  const audit = await runAudit(
    { url, crawlLimit, wantSubdomains, wantLighthouse, lighthouseCount, desktop },
    (phase, done, total) => onProgress?.(phase, done, total),
  );

  // 2. Länder-Speed über die gecrawlten HTML-Seiten (Startseite immer zuerst)
  let speed = null;
  if (proxies.length) {
    const crawled = audit.pages
      .filter(
        (p) =>
          p.url !== url &&
          p.status >= 200 &&
          p.status < 300 &&
          (!p.type || p.type.includes('html')),
      )
      .map((p) => p.url);
    const pages = [url, ...crawled].slice(0, MAX_SPEED_PAGES);

    speed = await runSpeedTest(
      pages,
      proxies,
      repeats,
      (done, total) => onProgress?.('speed', done, total),
      { resourceUrls: [url] }, // Ressourcen-Detail nur für die Startseite
    );
  }

  return { speed, audit };
}
