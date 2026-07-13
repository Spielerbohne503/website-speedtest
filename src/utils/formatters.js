/**
 * formatters – Zahlen-/Datumsformatierung für Anzeige und Exporte.
 */
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';

// 287 → "0.29s"; null/ungültig → "–"
export function msToSeconds(ms) {
  if (ms == null || !Number.isFinite(ms)) return '–';
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '–';
  return `${Math.round(ms)} ms`;
}

export function formatTimestamp(iso, lang) {
  try {
    const pattern = lang === 'de' ? 'dd.MM.yyyy HH:mm' : 'yyyy-MM-dd HH:mm';
    return format(new Date(iso), pattern, { locale: lang === 'de' ? de : enUS });
  } catch {
    return iso ?? '';
  }
}

// Dateiname mit Zeitstempel, z.B. speed-test-2026-07-13-1430.csv
export function exportFilename(ext) {
  const stamp = format(new Date(), 'yyyy-MM-dd-HHmm');
  return `speed-test-${stamp}.${ext}`;
}
