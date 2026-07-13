/**
 * StatTiles – KPI-Zeile über den Ergebnissen:
 * Ø Ladezeit · Schnellster Standort · Langsamster Standort · Erfolgsrate.
 * Werte zählen animiert hoch (respektiert prefers-reduced-motion).
 * Props: language, results ({rows}).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t, countryName } from '../utils/i18n';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Zählt von 0 auf `target` (requestAnimationFrame, ease-out), Snap bei reduced motion.
// Der setTimeout garantiert den exakten Endwert, auch wenn rAF gedrosselt wird
// (Hintergrund-Tab, Headless-Browser) – Zahlen dürfen nie „hängen bleiben".
function useCountUp(target, durationMs = 900) {
  const [value, setValue] = useState(target);
  const frame = useRef(null);
  useEffect(() => {
    if (target == null || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setValue(target * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    const snap = setTimeout(() => setValue(target), durationMs + 100);
    return () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(snap);
      setValue(target);
    };
  }, [target, durationMs]);
  return value;
}

function Tile({ label, value, context, accent }) {
  return (
    <div className={`stat-tile${accent ? ` stat-${accent}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {context && <span className="stat-context">{context}</span>}
    </div>
  );
}

export default function StatTiles({ language, results }) {
  const stats = useMemo(() => {
    const measured = results.rows.filter((row) => row.meanMs != null);
    if (!measured.length) return null;
    const sorted = [...measured].sort((a, b) => a.meanMs - b.meanMs);
    const avg = measured.reduce((sum, row) => sum + row.meanMs, 0) / measured.length;
    const success =
      results.rows.reduce((sum, row) => sum + (row.successRate ?? 0), 0) / results.rows.length;
    return { avg, fastest: sorted[0], slowest: sorted[sorted.length - 1], success };
  }, [results]);

  const avgAnimated = useCountUp(stats?.avg ?? 0);
  const fastAnimated = useCountUp(stats?.fastest?.meanMs ?? 0);
  const slowAnimated = useCountUp(stats?.slowest?.meanMs ?? 0);
  const successAnimated = useCountUp(stats?.success ?? 0);

  if (!stats) return null;
  const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;

  return (
    <div className="stat-tiles">
      <Tile label={t(language, 'statAvg')} value={seconds(avgAnimated)} />
      <Tile
        label={t(language, 'statFastest')}
        value={seconds(fastAnimated)}
        context={`${countryName(language, stats.fastest.country)}`}
        accent="success"
      />
      <Tile
        label={t(language, 'statSlowest')}
        value={seconds(slowAnimated)}
        context={`${countryName(language, stats.slowest.country)}`}
        accent={stats.slowest.level === 'success' ? 'success' : stats.slowest.level}
      />
      <Tile
        label={t(language, 'statSuccess')}
        value={`${Math.round(successAnimated)}%`}
        accent={stats.success >= 99 ? 'success' : stats.success >= 80 ? 'warning' : 'danger'}
      />
    </div>
  );
}
