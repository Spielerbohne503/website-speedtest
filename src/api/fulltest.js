/**
 * api/fulltest – ein Durchlauf, der WIRKLICH alles misst:
 *   1. Länder-Speed (Globalping) für die Haupt-URL
 *   2. Crawl aller internen Seiten
 *   3. Subdomain-Discovery (Certificate Transparency)
 *   4. Ressourcen + Sicherheit pro Seite
 *   5. Lighthouse / Core Web Vitals / Filmstrip (PageSpeed Insights)
 *
 * Fasst runSpeedTest + runAudit zu einem Lauf mit einheitlichem
 * Fortschritt zusammen. onProgress(phaseKey, done, total).
 */
import { runSpeedTest } from './client';
import { runAudit } from './audit';

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

  // 1. Länder-Speed (optional – nur wenn Länder gewählt sind)
  let speed = null;
  if (proxies.length) {
    speed = await runSpeedTest([url], proxies, repeats, (done, total) =>
      onProgress?.('speed', done, total),
    );
  }

  // 2.–5. Crawl / Subdomains / Ressourcen / Security / Lighthouse
  const audit = await runAudit(
    { url, crawlLimit, wantSubdomains, wantLighthouse, lighthouseCount, desktop },
    (phase, done, total) => onProgress?.(phase, done, total),
  );

  return { speed, audit };
}
