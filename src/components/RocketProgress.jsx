/**
 * RocketProgress – immersiver Lade-Zustand: eine Rakete steigt diagonal ins
 * All, während der Test läuft. Position folgt dem Fortschritt (0 % unten-links
 * → 100 % oben-rechts), mit Kondensstreifen, vorbeiziehenden Sternen und
 * flackernder Triebwerksflamme. Wird im Speed-Test und im Voll-Audit genutzt.
 *
 * Props: label (string), done (number), total (number), hint? (string)
 */
import { useEffect, useState } from 'react';

const ROCKET = (
  <svg viewBox="0 0 48 64" className="rocket-svg" width="40" height="54">
    <defs>
      <linearGradient id="rk-body" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#c7d2ff" />
        <stop offset="0.5" stopColor="#ffffff" />
        <stop offset="1" stopColor="#8ea2e0" />
      </linearGradient>
      <linearGradient id="rk-flame" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff3b0" />
        <stop offset="0.45" stopColor="#ffab2e" />
        <stop offset="1" stopColor="#ff4d4d" />
      </linearGradient>
    </defs>
    {/* Flamme */}
    <g className="rocket-flame">
      <path d="M17 46 Q24 74 31 46 Q24 54 17 46 Z" fill="url(#rk-flame)" />
      <path d="M20 46 Q24 62 28 46 Q24 51 20 46 Z" fill="#fff3b0" opacity="0.9" />
    </g>
    {/* Körper */}
    <path d="M24 2 C33 12 34 28 34 40 L14 40 C14 28 15 12 24 2 Z" fill="url(#rk-body)" />
    {/* Fenster */}
    <circle cx="24" cy="20" r="5" fill="#0d1226" />
    <circle cx="24" cy="20" r="5" fill="none" stroke="#5cc8ff" strokeWidth="1.5" />
    <circle cx="22.4" cy="18.4" r="1.4" fill="#bfe9ff" opacity="0.9" />
    {/* Finnen */}
    <path d="M14 34 L6 44 L14 41 Z" fill="#5b6bd6" />
    <path d="M34 34 L42 44 L34 41 Z" fill="#5b6bd6" />
    <rect x="21" y="40" width="6" height="4" rx="1" fill="#8ea2e0" />
  </svg>
);

export default function RocketProgress({ label, done, total, hint }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const launched = Math.max(4, pct); // etwas Abstand vom Boden

  return (
    <div className="card rocket-loader">
      <div className="rocket-sky">
        {/* vorbeiziehende Sterne (Geschwindigkeitsgefühl) */}
        <div className="rocket-streaks" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, i) => (
            <span key={i} className="streak" style={{ '--i': i }} />
          ))}
        </div>
        {/* Kondensstreifen: von unten-links zur Rakete */}
        <svg className="rocket-trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="3" y1="97" x2={launched} y2={100 - launched} stroke="url(#trail-grad)" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="4 4" />
          <defs>
            <linearGradient id="trail-grad" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="rgba(124,158,255,0)" />
              <stop offset="1" stopColor="rgba(124,158,255,0.8)" />
            </linearGradient>
          </defs>
        </svg>
        {/* Ziel-Planet oben rechts */}
        <div className="rocket-planet" aria-hidden="true" />
        {/* die Rakete */}
        <div
          className="rocket"
          style={{ left: `calc(${launched}% - 20px)`, bottom: `calc(${launched}% - 20px)` }}
        >
          {ROCKET}
        </div>
      </div>

      <div className="rocket-readout">
        <span className="rocket-label">
          <span className="rocket-blip" aria-hidden="true" /> {label} · {done}/{total}
        </span>
        <span className="rocket-pct">{pct}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="progress-fill" style={{ width: `${launched}%` }}>
          <span className="progress-shimmer" aria-hidden="true" />
        </div>
      </div>
      {elapsed > 45 && done < total && hint && <p className="progress-hint">{hint}</p>}
    </div>
  );
}
