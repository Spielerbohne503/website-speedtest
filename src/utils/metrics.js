/**
 * metrics – Status-Schwellen und Auswertung der Messergebnisse (Frontend-Seite).
 * Die Statistik selbst (mean/stdDev/…) berechnet der Worker; hier wird
 * klassifiziert, zusammengefasst und für die Anzeige aufbereitet.
 */

// Schwellen in Millisekunden: ✅ < 1500 · ⚠️ 1500–2500 · ❌ > 2500
export const THRESHOLDS = { good: 1500, warn: 2500 };

export function classify(meanMs) {
  if (meanMs == null || !Number.isFinite(meanMs)) return 'danger';
  if (meanMs < THRESHOLDS.good) return 'success';
  if (meanMs <= THRESHOLDS.warn) return 'warning';
  return 'danger';
}

export function statusEmoji(level) {
  return { success: '✅', warning: '⚠️', danger: '❌' }[level] ?? '❌';
}

// i18n-Schlüssel für den Status-Text (SUPER/OK/LANGSAM bzw. GREAT/OK/SLOW)
export function statusTextKey(level, hasData = true) {
  if (!hasData) return 'statusError';
  return { success: 'statusSuper', warning: 'statusOk', danger: 'statusSlow' }[level] ?? 'statusError';
}

// Zählt Ergebnisse pro Status für die Zusammenfassung (Export-Header, Summary-Zeile)
export function summarize(rows) {
  const counts = { success: 0, warning: 0, danger: 0 };
  for (const row of rows) counts[row.level] = (counts[row.level] ?? 0) + 1;
  return counts;
}
