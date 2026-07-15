/**
 * exporters – PDF / Excel / CSV / JSON für das kombinierte Ergebnis
 * ({ speed, audit }). Fallback-Ketten:
 *   PDF   → Druckansicht (window.print) → CSV
 *   Excel → CSV
 *   CSV   → JSON-Clipboard
 * jsPDF/XLSX werden dynamisch importiert (Code-Splitting).
 *
 * JSON-Export erzeugt eine wieder-importierbare Datei (_format/_version).
 */
import { t, countryName, cityName } from './i18n';
import { statusTextKey, summarize } from './metrics';
import { msToSeconds, formatBytes, formatTimestamp, exportFilename } from './formatters';

export const JSON_FORMAT = 'website-speedtest';
export const JSON_VERSION = 1;

// Theme-Farben als [r,g,b]
const C = {
  navy: [15, 23, 42],
  navy2: [30, 41, 89],
  blue: [37, 99, 235],
  violet: [124, 92, 255],
  slate: [71, 85, 105],
  muted: [148, 163, 184],
  line: [226, 232, 240],
  success: [16, 145, 100],
  warning: [214, 138, 9],
  danger: [214, 59, 59],
  white: [255, 255, 255],
};

const LEVEL_COLOR = { success: C.success, warning: C.warning, danger: C.danger };

// Flache Speed-Zeilen (URL×Land) für Tabellen/CSV
function speedRows(result, lang, { plain = false } = {}) {
  const rows = result.speed?.rows ?? [];
  return rows.map((row) => {
    const hasData = row.meanMs != null;
    const statusText = t(lang, statusTextKey(row.level, hasData));
    return {
      url: row.url,
      country: countryName(lang, row.country),
      city: cityName(lang, row.country) || row.city || '',
      loadTime: hasData ? msToSeconds(row.meanMs) : t(lang, 'noData'),
      status: plain ? statusText : `${row.statusEmoji} ${statusText}`,
      recommendation: t(lang, row.recommendationKey) || row.recommendation,
      level: row.level,
      tech: row,
    };
  });
}

function downloadBlob(content, filename, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================ PDF (schön designt) ============================

export async function exportPDF(result, lang) {
  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210;
    const M = 14; // Rand
    const CW = W - 2 * M; // Inhaltsbreite
    const audit = result.audit;
    const speed = result.speed;
    const mainUrl = audit?.url ?? speed?.rows?.[0]?.url ?? '';
    const lh = audit?.lighthouse?.[0] ?? null;

    let y = 0;

    // ---- Kopfband ----
    doc.setFillColor(...C.navy);
    doc.rect(0, 0, W, 32, 'F');
    doc.setFillColor(...C.violet);
    doc.rect(0, 30, W, 2, 'F');
    doc.setTextColor(...C.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    doc.text('Website Performance Report', M, 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(200, 214, 240);
    doc.text(truncate(doc, mainUrl, CW - 40), M, 22);
    doc.setFontSize(8.5);
    doc.text(
      `${t(lang, 'testedAt')}: ${formatTimestamp(audit?.timestamp ?? new Date().toISOString(), lang)}`,
      M,
      27.5,
    );
    y = 42;

    // ---- Overview-KPIs ----
    const s = audit?.summary;
    if (s) {
      const kpis = [
        { label: t(lang, 'ovPerf'), value: s.avgPerformance != null ? String(s.avgPerformance) : '–', level: scoreLevel(s.avgPerformance) },
        { label: t(lang, 'ovPages'), value: String(s.pageCount) },
        { label: t(lang, 'ovSubdomains'), value: String(s.subdomainCount) },
        { label: t(lang, 'ovBroken'), value: String(s.brokenCount), level: s.brokenCount > 0 ? 'danger' : 'success' },
        { label: t(lang, 'ovWeight'), value: formatBytes(s.htmlPageCount ? s.totalBytes / s.htmlPageCount : 0, lang) },
        { label: t(lang, 'ovSecurity'), value: s.worstSecurityGrade ?? '–', level: gradeLevel(s.worstSecurityGrade) },
      ];
      const gap = 3;
      const bw = (CW - gap * 5) / 6;
      kpis.forEach((k, i) => {
        const x = M + i * (bw + gap);
        doc.setFillColor(247, 249, 252);
        doc.roundedRect(x, y, bw, 20, 1.5, 1.5, 'F');
        const accent = LEVEL_COLOR[k.level] ?? C.blue;
        doc.setFillColor(...accent);
        doc.roundedRect(x, y, bw, 2, 1.5, 1.5, 'F');
        doc.setTextColor(...C.navy);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(k.value, x + bw / 2, y + 11, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.4);
        doc.setTextColor(...C.slate);
        doc.text(fit(doc, k.label, bw - 2), x + bw / 2, y + 16.5, { align: 'center' });
      });
      y += 28;
    }

    // ---- Core Web Vitals ----
    if (lh?.pagePerf) {
      y = sectionTitle(doc, y, `${t(lang, 'secPerf')} · ${lh.strategy}`, M);
      const pp = lh.pagePerf;
      const cwv = [
        { k: 'LCP', v: msToSeconds(pp.lcp), lvl: band(pp.lcp, 2500, 4000) },
        { k: 'FCP', v: msToSeconds(pp.fcp), lvl: band(pp.fcp, 1800, 3000) },
        { k: 'CLS', v: pp.cls == null ? '–' : pp.cls.toFixed(3), lvl: band(pp.cls, 0.1, 0.25) },
        { k: 'TBT', v: pp.tbt == null ? '–' : `${Math.round(pp.tbt)} ms`, lvl: band(pp.tbt, 200, 600) },
        { k: 'Speed Index', v: msToSeconds(pp.speedIndex), lvl: band(pp.speedIndex, 3400, 5800) },
        { k: 'TTFB', v: msToSeconds(pp.ttfb), lvl: band(pp.ttfb, 800, 1800) },
      ];
      const gap = 3;
      const bw = (CW - gap * 5) / 6;
      cwv.forEach((m, i) => {
        const x = M + i * (bw + gap);
        const accent = LEVEL_COLOR[m.lvl] ?? C.slate;
        doc.setDrawColor(...C.line);
        doc.setFillColor(252, 252, 253);
        doc.roundedRect(x, y, bw, 16, 1.5, 1.5, 'FD');
        doc.setFillColor(...accent);
        doc.circle(x + 3.5, y + 4, 1.1, 'F');
        doc.setTextColor(...C.slate);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.2);
        doc.text(m.k, x + 6, y + 5);
        doc.setTextColor(...C.navy);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(String(m.v), x + bw / 2, y + 12, { align: 'center' });
      });
      y += 22;

      // Lighthouse-Kategorien
      if (lh.scores) {
        const cats = Object.entries(lh.scores);
        const gap2 = 3;
        const bw2 = (CW - gap2 * (cats.length - 1)) / cats.length;
        cats.forEach(([cat, score], i) => {
          const x = M + i * (bw2 + gap2);
          const accent = LEVEL_COLOR[scoreLevel(score)] ?? C.slate;
          doc.setDrawColor(...accent);
          doc.setLineWidth(0.4);
          doc.roundedRect(x, y, bw2, 14, 1.5, 1.5, 'D');
          doc.setTextColor(...accent);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text(score == null ? '–' : String(score), x + bw2 / 2, y + 7.5, { align: 'center' });
          doc.setTextColor(...C.slate);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6);
          doc.text(fit(doc, cat.replace('-', ' '), bw2 - 2), x + bw2 / 2, y + 11.5, { align: 'center' });
        });
        doc.setLineWidth(0.2);
        y += 20;
      }
    }

    // ---- Länder-Speed-Tabelle ----
    const sr = speedRows(result, lang, { plain: true });
    if (sr.length) {
      y = ensure(doc, y, 30);
      y = sectionTitle(doc, y, t(lang, 'chartTitle'), M);
      const multi = new Set(sr.map((r) => r.url)).size > 1;
      const cols = multi
        ? [
            { key: 'url', label: t(lang, 'colUrl'), w: 52 },
            { key: 'country', label: t(lang, 'colCountry'), w: 34 },
            { key: 'city', label: t(lang, 'colCity'), w: 30 },
            { key: 'loadTime', label: t(lang, 'colLoadTime'), w: 26 },
            { key: 'status', label: t(lang, 'colStatus'), w: 30 },
          ]
        : [
            { key: 'country', label: t(lang, 'colCountry'), w: 46 },
            { key: 'city', label: t(lang, 'colCity'), w: 40 },
            { key: 'loadTime', label: t(lang, 'colLoadTime'), w: 40 },
            { key: 'status', label: t(lang, 'colStatus'), w: 56 },
          ];
      y = drawTable(doc, y, M, cols, sr, { dotKey: 'level' });
      y += 4;
    }

    // ---- Empfehlungen ----
    const recs = audit?.summary?.recommendations ?? [];
    if (recs.length) {
      y = ensure(doc, y, 24);
      y = sectionTitle(doc, y, t(lang, 'secRecs'), M);
      const prioColor = { high: C.danger, medium: C.warning, low: C.blue };
      for (const rec of recs.slice(0, 12)) {
        y = ensure(doc, y, 9);
        const col = prioColor[rec.priority] ?? C.slate;
        doc.setFillColor(...col);
        doc.circle(M + 1.5, y - 1, 1.1, 'F');
        doc.setTextColor(...col);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.text(t(lang, `prio${cap(rec.priority)}`).toUpperCase(), M + 4, y);
        doc.setTextColor(...C.navy);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        const lines = doc.splitTextToSize(rec.text + (rec.gain ? ` (${rec.gain})` : ''), CW - 22);
        doc.text(lines, M + 20, y);
        y += Math.max(5, lines.length * 4);
      }
      y += 2;
    }

    // ---- Sicherheit ----
    const secPages = (audit?.perPage ?? []).filter((p) => p.security);
    if (secPages.length) {
      y = ensure(doc, y, 24);
      y = sectionTitle(doc, y, t(lang, 'secSecurity'), M);
      const secRows = secPages.slice(0, 14).map((p) => ({
        page: pathOf(p.url),
        grade: p.security.grade,
        https: p.security.https ? 'Ja' : 'Nein',
        hsts: p.security.headers.HSTS ? 'Ja' : 'Nein',
        csp: p.security.headers.CSP ? 'Ja' : 'Nein',
        cdn: p.security.headers.cdn ?? '–',
        level: gradeLevel(p.security.grade),
      }));
      const cols = [
        { key: 'page', label: t(lang, 'colPage'), w: 60 },
        { key: 'grade', label: t(lang, 'colGrade'), w: 20 },
        { key: 'https', label: 'HTTPS', w: 22 },
        { key: 'hsts', label: 'HSTS', w: 22 },
        { key: 'csp', label: 'CSP', w: 22 },
        { key: 'cdn', label: 'CDN', w: 36 },
      ];
      y = drawTable(doc, y, M, cols, secRows, { dotKey: 'level' });
    }

    // ---- Fußzeile mit Seitenzahlen ----
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(...C.line);
      doc.line(M, 288, W - M, 288);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      doc.text('Website Speed Test', M, 292);
      doc.text(`${p} / ${pages}`, W - M, 292, { align: 'right' });
    }

    doc.save(exportFilename('pdf'));
    return t(lang, 'exportDone');
  } catch {
    return printFallback(result, lang);
  }
}

// Zeichnet eine Tabelle mit Kopfzeile, Zebra-Streifen und optionalem Status-Punkt.
function drawTable(doc, startY, M, cols, rows, { dotKey } = {}) {
  const totalW = cols.reduce((sum, c) => sum + c.w, 0);
  let y = startY;
  // Kopf
  doc.setFillColor(...C.navy);
  doc.rect(M, y, totalW, 7, 'F');
  doc.setTextColor(...C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  let x = M;
  for (const c of cols) {
    doc.text(c.label, x + 2, y + 4.8);
    x += c.w;
  }
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  rows.forEach((row, i) => {
    if (y > 282) {
      doc.addPage();
      y = 16;
    }
    if (i % 2 === 1) {
      doc.setFillColor(247, 249, 252);
      doc.rect(M, y, totalW, 6.5, 'F');
    }
    x = M;
    for (const c of cols) {
      doc.setTextColor(...C.navy);
      const val = String(row[c.key] ?? '');
      doc.text(truncate(doc, val, c.w - 3), x + 2, y + 4.5);
      x += c.w;
    }
    // Status-Punkt vor der ersten Spalte, falls level vorhanden
    if (dotKey && row[dotKey]) {
      const col = LEVEL_COLOR[row[dotKey]];
      if (col) {
        doc.setFillColor(...col);
        doc.circle(M + totalW - 3, y + 3.2, 1, 'F');
      }
    }
    y += 6.5;
  });
  doc.setDrawColor(...C.line);
  doc.line(M, y, M + totalW, y);
  return y + 2;
}

function sectionTitle(doc, y, text, M) {
  doc.setFillColor(...C.blue);
  doc.rect(M, y - 3.5, 1.6, 5, 'F');
  doc.setTextColor(...C.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(text, M + 4, y);
  return y + 6;
}

function ensure(doc, y, need) {
  if (y + need > 285) {
    doc.addPage();
    return 16;
  }
  return y;
}

function truncate(doc, text, maxW) {
  if (doc.getTextWidth(text) <= maxW) return text;
  let s = text;
  while (s.length > 1 && doc.getTextWidth(s + '…') > maxW) s = s.slice(0, -1);
  return s + '…';
}

const fit = truncate;

function pathOf(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

function band(v, good, warn) {
  if (v == null) return 'none';
  return v <= good ? 'success' : v <= warn ? 'warning' : 'danger';
}

function scoreLevel(score) {
  if (score == null) return 'none';
  return score >= 90 ? 'success' : score >= 50 ? 'warning' : 'danger';
}

function gradeLevel(grade) {
  if (!grade) return 'none';
  if (grade <= 'B') return 'success';
  if (grade <= 'C') return 'warning';
  return 'danger';
}

const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);

// Fallback: HTML-Report + window.print()
function printFallback(result, lang) {
  try {
    const rows = speedRows(result, lang);
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const summary = summarize(result.speed?.rows ?? []);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Report</title>
      <style>body{font-family:sans-serif;padding:24px;color:#0f172a}h1{color:#1e3a8a}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:6px;font-size:12px;text-align:left}
      th{background:#0f172a;color:#fff}</style></head><body>
      <h1>Website Performance Report</h1>
      <p>${esc(result.audit?.url ?? '')} · ${esc(formatTimestamp(result.audit?.timestamp ?? '', lang))}</p>
      <p>✅ ${summary.success} · ⚠️ ${summary.warning} · ❌ ${summary.danger}</p>
      <table><thead><tr><th>${t(lang, 'colUrl')}</th><th>${t(lang, 'colCountry')}</th><th>${t(lang, 'colLoadTime')}</th><th>${t(lang, 'colStatus')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.url)}</td><td>${esc(r.country)}</td><td>${esc(r.loadTime)}</td><td>${esc(r.status)}</td></tr>`).join('')}</tbody></table>
      </body></html>`;
    const win = window.open('', '_blank');
    if (!win) throw new Error('popup blocked');
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    return t(lang, 'pdfFailed');
  } catch {
    return exportCSV(result, lang);
  }
}

// ============================ Excel ============================

export async function exportExcel(result, lang) {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const rows = speedRows(result, lang);
    const L = {
      url: t(lang, 'colUrl'), country: t(lang, 'colCountry'), city: t(lang, 'colCity'),
      loadTime: t(lang, 'colLoadTime'), status: t(lang, 'colStatus'), recommendation: t(lang, 'colRecommendation'),
    };

    if (rows.length) {
      appendSheet(XLSX, wb, t(lang, 'sheetSimple'), rows.map((r) => ({
        [L.url]: r.url, [L.country]: r.country, [L.city]: r.city,
        [L.loadTime]: r.loadTime, [L.status]: r.status, [L.recommendation]: r.recommendation,
      })));
      appendSheet(XLSX, wb, t(lang, 'sheetTech'), rows.map(({ tech: r }) => ({
        url: r.url, country: r.country, city: r.city, mean_ms: r.meanMs, stdDev_ms: r.stdDev,
        min_ms: r.min, max_ms: r.max, median_ms: r.median, ttfb_mean_ms: r.ttfbMean,
        http_status: r.httpStatus, success_rate: r.successRate, source: r.source, error: r.error ?? '',
      })));
    }

    // Lighthouse / Core Web Vitals
    const lhs = result.audit?.lighthouse ?? [];
    if (lhs.length) {
      appendSheet(XLSX, wb, 'Lighthouse', lhs.map((lh) => ({
        url: lh.url, strategy: lh.strategy,
        performance: lh.scores?.performance, accessibility: lh.scores?.accessibility,
        best_practices: lh.scores?.['best-practices'], seo: lh.scores?.seo,
        LCP_ms: lh.lab?.lcp, FCP_ms: lh.lab?.fcp, CLS: lh.lab?.cls, TBT_ms: lh.lab?.tbt,
        SpeedIndex_ms: lh.lab?.speedIndex, TTI_ms: lh.lab?.tti, TTFB_ms: lh.lab?.ttfb,
        page_weight_bytes: lh.pagePerf?.pageWeight, requests: lh.pagePerf?.requests,
      })));
    }

    // Sicherheit
    const secPages = (result.audit?.perPage ?? []).filter((p) => p.security);
    if (secPages.length) {
      appendSheet(XLSX, wb, t(lang, 'secSecurity'), secPages.map((p) => ({
        page: p.url, grade: p.security.grade, https: p.security.https,
        HSTS: !!p.security.headers.HSTS, CSP: !!p.security.headers.CSP,
        server: p.security.headers.server ?? '', cdn: p.security.headers.cdn ?? '',
        compression: p.security.headers.compression, http3: p.security.headers.http3,
      })));
    }

    // Subdomains
    const subs = result.audit?.subdomains?.subdomains ?? [];
    if (subs.length) {
      appendSheet(XLSX, wb, t(lang, 'secSubs'), subs.map((sd) => ({
        host: sd.host, status: sd.status ?? '', server: sd.server ?? '', redirect: sd.redirectedTo ?? '',
      })));
    }

    // Gecrawlte Seiten
    const pages = result.audit?.pages ?? [];
    if (pages.length) {
      appendSheet(XLSX, wb, t(lang, 'secPages'), pages.map((p) => ({
        url: p.url, status: p.status, time_ms: p.timeMs, type: p.type ?? '', bytes: p.bytes ?? '',
        redirect: p.redirectedTo ?? '',
      })));
    }

    if (!wb.SheetNames.length) throw new Error('no data');
    XLSX.writeFile(wb, exportFilename('xlsx'));
    return t(lang, 'exportDone');
  } catch {
    await exportCSV(result, lang);
    return t(lang, 'excelFailed');
  }
}

function appendSheet(XLSX, wb, name, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const keys = rows.length ? Object.keys(rows[0]) : [];
  sheet['!cols'] = keys.map((key) => ({
    wch: Math.min(60, Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2),
  }));
  XLSX.utils.book_append_sheet(wb, sheet, name.slice(0, 31));
}

// ============================ CSV ============================

export async function exportCSV(result, lang) {
  try {
    const rows = speedRows(result, lang);
    const L = [t(lang, 'colUrl'), t(lang, 'colCountry'), t(lang, 'colCity'), t(lang, 'colLoadTime'), t(lang, 'colStatus'), t(lang, 'colRecommendation')];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      L.map(esc).join(','),
      ...rows.map((r) => [r.url, r.country, r.city, r.loadTime, r.status, r.recommendation].map(esc).join(',')),
    ];
    downloadBlob('﻿' + lines.join('\r\n'), exportFilename('csv'), 'text/csv;charset=utf-8');
    return t(lang, 'exportDone');
  } catch {
    await copyJSON(result, lang);
    return t(lang, 'csvFailed');
  }
}

// ============================ JSON ============================

// Vollständiger, wieder-importierbarer JSON-Download.
export function exportJSON(result, lang) {
  const payload = {
    _format: JSON_FORMAT,
    _version: JSON_VERSION,
    exportedAt: new Date().toISOString(),
    speed: result.speed ?? null,
    audit: result.audit ?? null,
  };
  downloadBlob(JSON.stringify(payload, null, 2), exportFilename('json'), 'application/json');
  return t(lang, 'exportDone');
}

// Kompakter Clipboard-Copy (ohne große Filmstrip-Bilder).
export async function copyJSON(result, lang) {
  const slim = {
    _format: JSON_FORMAT,
    _version: JSON_VERSION,
    exportedAt: new Date().toISOString(),
    speed: result.speed ?? null,
    audit: result.audit
      ? {
          ...result.audit,
          lighthouse: result.audit.lighthouse?.map(({ filmstrip, finalScreenshot, ...rest }) => rest),
        }
      : null,
  };
  const json = JSON.stringify(slim, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    return t(lang, 'copied');
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = json;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok ? t(lang, 'copied') : t(lang, 'copyFailed');
    } catch {
      return t(lang, 'copyFailed');
    }
  }
}

// Import: JSON-Datei einlesen und validieren → { speed, audit }
export function parseImportedJSON(text) {
  const data = JSON.parse(text);
  if (data?._format !== JSON_FORMAT) throw new Error('Unbekanntes Format');
  return { speed: data.speed ?? null, audit: data.audit ?? null };
}
