/**
 * exporters – PDF / Excel / CSV / JSON mit Fallback-Ketten:
 *   PDF   → Druckansicht (window.print) → CSV
 *   Excel → CSV
 *   CSV   → JSON-Clipboard
 *   JSON  → execCommand-Fallback für ältere Browser
 * jsPDF und XLSX werden dynamisch importiert (Code-Splitting, kleineres Initial-Bundle).
 */
import { t, countryName, cityName } from './i18n';
import { statusTextKey, summarize } from './metrics';
import { msToSeconds, formatTimestamp, exportFilename } from './formatters';

// Zeilen für Exporte lokalisiert aufbereiten. `plain: true` → ohne Emojis (jsPDF-Fonts
// können keine Emojis darstellen).
function exportRows(results, lang, { plain = false } = {}) {
  return results.rows.map((row) => {
    const hasData = row.meanMs != null;
    const statusText = t(lang, statusTextKey(row.level, hasData));
    return {
      url: row.url,
      country: countryName(lang, row.country),
      city: cityName(lang, row.country) || row.city || '',
      loadTime: hasData ? msToSeconds(row.meanMs) : t(lang, 'noData'),
      status: plain ? statusText : `${row.statusEmoji} ${statusText}`,
      recommendation: t(lang, row.recommendationKey) || row.recommendation,
      tech: row,
    };
  });
}

function headerLabels(lang) {
  return {
    country: t(lang, 'colCountry'),
    city: t(lang, 'colCity'),
    loadTime: t(lang, 'colLoadTime'),
    status: t(lang, 'colStatus'),
    recommendation: t(lang, 'colRecommendation'),
    url: t(lang, 'colUrl'),
  };
}

function summaryLine(results, lang) {
  const counts = summarize(results.rows);
  return `${t(lang, 'summary')}: ✅ ${counts.success} · ⚠️ ${counts.warning} · ❌ ${counts.danger}`;
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

// ---------- PDF ----------

export async function exportPDF(results, lang) {
  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    const rows = exportRows(results, lang, { plain: true });
    const labels = headerLabels(lang);
    const counts = summarize(results.rows);
    // Spalten-Positionen (A4 Hochformat, 210mm breit)
    const cols = [
      { key: 'country', x: 14, width: 30 },
      { key: 'city', x: 44, width: 28 },
      { key: 'loadTime', x: 72, width: 24 },
      { key: 'status', x: 96, width: 26 },
      { key: 'recommendation', x: 122, width: 74 },
    ];

    doc.setFontSize(16);
    doc.text('Website Speed Test Report', 14, 18);
    doc.setFontSize(10);
    doc.text(`${t(lang, 'testedAt')}: ${formatTimestamp(results.timestamp, lang)}`, 14, 26);
    doc.text(
      `${t(lang, 'summary')}: ${t(lang, 'statusSuper')} ${counts.success} / ${t(lang, 'statusOk')} ${counts.warning} / ${t(lang, 'statusSlow')} ${counts.danger}`,
      14,
      32,
    );

    let y = 42;
    const urls = [...new Set(rows.map((row) => row.url))];
    for (const url of urls) {
      doc.setFont(undefined, 'bold');
      doc.text(doc.splitTextToSize(`${labels.url}: ${url}`, 180), 14, y);
      doc.setFont(undefined, 'normal');
      y += 7;
      doc.setFont(undefined, 'bold');
      for (const col of cols) doc.text(labels[col.key], col.x, y);
      doc.setFont(undefined, 'normal');
      y += 6;
      for (const row of rows.filter((r) => r.url === url)) {
        const cells = cols.map((col) => doc.splitTextToSize(String(row[col.key]), col.width - 2));
        const height = Math.max(...cells.map((lines) => lines.length)) * 5 + 2;
        if (y + height > 285) {
          doc.addPage();
          y = 20;
        }
        cols.forEach((col, index) => doc.text(cells[index], col.x, y));
        y += height;
      }
      y += 6;
    }
    doc.save(exportFilename('pdf'));
    return t(lang, 'exportDone');
  } catch {
    return printFallback(results, lang);
  }
}

// Fallback: HTML-Report in neuem Fenster + window.print() (Browser-PDF-Dialog)
function printFallback(results, lang) {
  try {
    const rows = exportRows(results, lang);
    const labels = headerLabels(lang);
    const esc = (value) =>
      String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Speed Test Report</title>
      <style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #999;padding:6px;text-align:left;font-size:12px}</style></head><body>
      <h1>Website Speed Test Report</h1>
      <p>${esc(t(lang, 'testedAt'))}: ${esc(formatTimestamp(results.timestamp, lang))}</p>
      <p>${esc(summaryLine(results, lang))}</p>
      <table><thead><tr><th>${esc(labels.url)}</th><th>${esc(labels.country)}</th><th>${esc(labels.city)}</th>
      <th>${esc(labels.loadTime)}</th><th>${esc(labels.status)}</th><th>${esc(labels.recommendation)}</th></tr></thead>
      <tbody>${rows
        .map(
          (row) =>
            `<tr><td>${esc(row.url)}</td><td>${esc(row.country)}</td><td>${esc(row.city)}</td><td>${esc(row.loadTime)}</td><td>${esc(row.status)}</td><td>${esc(row.recommendation)}</td></tr>`,
        )
        .join('')}</tbody></table></body></html>`;
    const win = window.open('', '_blank');
    if (!win) throw new Error('popup blocked');
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    return t(lang, 'pdfFailed');
  } catch {
    // letzte Stufe: CSV
    return exportCSV(results, lang);
  }
}

// ---------- Excel ----------

export async function exportExcel(results, lang) {
  try {
    const XLSX = await import('xlsx');
    const rows = exportRows(results, lang);
    const labels = headerLabels(lang);
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Einfache Sprache (mit Emojis)
    const simple = rows.map((row) => ({
      [labels.url]: row.url,
      [labels.country]: row.country,
      [labels.city]: row.city,
      [labels.loadTime]: row.loadTime,
      [labels.status]: row.status,
      [labels.recommendation]: row.recommendation,
    }));
    appendSheet(XLSX, workbook, t(lang, 'sheetSimple'), simple);

    // Sheet 2: Technical Data (IT-Jargon, Rohwerte in ms)
    const tech = rows.map(({ tech: r }) => ({
      url: r.url,
      country: r.country,
      city: r.city,
      mean_ms: r.meanMs,
      stdDev_ms: r.stdDev,
      min_ms: r.min,
      max_ms: r.max,
      median_ms: r.median,
      ttfb_mean_ms: r.ttfbMean,
      http_status: r.httpStatus,
      success_rate: r.successRate,
      content_length: r.contentLength,
      source: r.source,
      error: r.error ?? '',
    }));
    appendSheet(XLSX, workbook, t(lang, 'sheetTech'), tech);

    // Sheet 3: Empfehlungen
    const recs = rows.map((row) => ({
      [labels.country]: row.country,
      [labels.city]: row.city,
      [labels.status]: row.status,
      [labels.recommendation]: row.recommendation,
    }));
    appendSheet(XLSX, workbook, t(lang, 'sheetRec'), recs);

    XLSX.writeFile(workbook, exportFilename('xlsx'));
    return t(lang, 'exportDone');
  } catch {
    await exportCSV(results, lang);
    return t(lang, 'excelFailed');
  }
}

function appendSheet(XLSX, workbook, name, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  // Auto-Breite: längster Zellinhalt pro Spalte
  const keys = rows.length ? Object.keys(rows[0]) : [];
  sheet['!cols'] = keys.map((key) => ({
    wch: Math.min(
      60,
      Math.max(key.length, ...rows.map((row) => String(row[key] ?? '').length)) + 2,
    ),
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

// ---------- CSV ----------

export async function exportCSV(results, lang) {
  try {
    const rows = exportRows(results, lang);
    const labels = headerLabels(lang);
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      [labels.url, labels.country, labels.city, labels.loadTime, labels.status, labels.recommendation]
        .map(esc)
        .join(','),
      ...rows.map((row) =>
        [row.url, row.country, row.city, row.loadTime, row.status, row.recommendation]
          .map(esc)
          .join(','),
      ),
    ];
    // BOM, damit Excel UTF-8 (Umlaute/Emojis) korrekt erkennt
    downloadBlob('\uFEFF' + lines.join('\r\n'), exportFilename('csv'), 'text/csv;charset=utf-8');
    return t(lang, 'exportDone');
  } catch {
    await copyJSON(results, lang);
    return t(lang, 'csvFailed');
  }
}

// ---------- JSON → Clipboard ----------

export async function copyJSON(results, lang) {
  const json = JSON.stringify(results.raw ?? results, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    return t(lang, 'copied');
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = json;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok ? t(lang, 'copied') : t(lang, 'copyFailed');
    } catch {
      return t(lang, 'copyFailed');
    }
  }
}
