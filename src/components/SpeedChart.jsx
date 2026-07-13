/**
 * SpeedChart – horizontales Balkendiagramm: Ladezeit (Mittelwert) pro Land,
 * sortiert von schnell nach langsam. Status-Farben nach Schwellen mit
 * Legende + Wert-Label an jeder Balkenspitze (Relief-Regel: Farbe trägt
 * nie allein Bedeutung; die Tabelle darunter ist die barrierefreie Zwillingsansicht).
 * Balken wachsen animiert (CSS-Transition, respektiert prefers-reduced-motion).
 * Bei mehreren URLs: ein Diagramm pro URL (Small Multiples).
 * Props: language, results ({rows}).
 */
import { useEffect, useMemo, useState } from 'react';
import { COUNTRIES, t, countryName } from '../utils/i18n';
import { msToSeconds, formatMs } from '../utils/formatters';

const FLAGS = Object.fromEntries(COUNTRIES.map((c) => [c.country, c.flag]));

// Saubere Achsen-Ticks (max. ~5), auch für sehr schnelle Seiten (<100 ms)
function niceTicks(maxMs) {
  const steps = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000];
  const step = steps.find((s) => maxMs / s <= 5) ?? 10000;
  const ticks = [];
  for (let v = 0; v <= maxMs; v += step) ticks.push(v);
  return { ticks, limit: ticks[ticks.length - 1] + step };
}

function Tooltip({ language, row }) {
  return (
    <div className="chart-tooltip" role="tooltip">
      <strong>
        {FLAGS[row.country]} {countryName(language, row.country)} · {msToSeconds(row.meanMs)}
      </strong>
      <dl>
        <div>
          <dt>{t(language, 'tooltipMedian')}</dt>
          <dd>{formatMs(row.median)}</dd>
        </div>
        <div>
          <dt>{t(language, 'tooltipRange')}</dt>
          <dd>
            {formatMs(row.min)} – {formatMs(row.max)}
          </dd>
        </div>
        {row.ttfbMean != null && (
          <div>
            <dt>{t(language, 'tooltipTtfb')}</dt>
            <dd>{formatMs(row.ttfbMean)}</dd>
          </div>
        )}
        <div>
          <dt>{t(language, 'tooltipSuccess')}</dt>
          <dd>{row.successRate}%</dd>
        </div>
        {row.sourceCity && (
          <div>
            <dt>{t(language, 'tooltipProbe')}</dt>
            <dd>{row.sourceCity}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function ChartForUrl({ language, rows, url, showUrl }) {
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const sorted = useMemo(
    () => [...rows].filter((row) => row.meanMs != null).sort((a, b) => a.meanMs - b.meanMs),
    [rows],
  );
  if (!sorted.length) return null;

  const maxMs = Math.max(...sorted.map((row) => row.meanMs));
  const { ticks, limit } = niceTicks(maxMs);
  const pct = (ms) => (ms / limit) * 100;

  return (
    <div className="chart-block">
      {showUrl && <p className="chart-url">{url}</p>}
      <div className="chart-grid" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} className="chart-gridline" style={{ left: `${pct(tick)}%` }} />
        ))}
      </div>
      <div className="chart-rows">
        {sorted.map((row, index) => (
          <div
            key={row.country}
            className="chart-row"
            tabIndex={0}
            aria-label={`${countryName(language, row.country)}: ${msToSeconds(row.meanMs)}`}
            onMouseEnter={() => setHovered(row.country)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(row.country)}
            onBlur={() => setHovered(null)}
          >
            <span className="chart-label">
              <span className="chart-flag" aria-hidden="true">
                {FLAGS[row.country]}
              </span>
              {countryName(language, row.country)}
            </span>
            <span className="chart-track">
              <span
                className={`chart-bar bar-${row.level}`}
                style={{
                  width: mounted ? `${pct(row.meanMs)}%` : '0%',
                  transitionDelay: `${index * 70}ms`,
                }}
              />
              <span
                className="chart-value"
                style={{ left: mounted ? `calc(${pct(row.meanMs)}% + 8px)` : '8px' }}
              >
                {msToSeconds(row.meanMs)}
              </span>
              {hovered === row.country && <Tooltip language={language} row={row} />}
            </span>
          </div>
        ))}
      </div>
      <div className="chart-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ left: `${pct(tick)}%` }}>
            {`${parseFloat((tick / 1000).toFixed(2))}s`}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function SpeedChart({ language, results }) {
  const byUrl = useMemo(() => {
    const groups = new Map();
    for (const row of results.rows) {
      if (!groups.has(row.url)) groups.set(row.url, []);
      groups.get(row.url).push(row);
    }
    return [...groups.entries()];
  }, [results]);

  const hasData = results.rows.some((row) => row.meanMs != null);
  if (!hasData) return null;

  return (
    <section className="card chart-card">
      <div className="chart-head">
        <div>
          <h2>{t(language, 'chartTitle')}</h2>
          <p className="chart-subtitle">{t(language, 'chartSubtitle')}</p>
        </div>
        <ul className="chart-legend" aria-label="Legende">
          <li>
            <span className="legend-swatch bar-success" /> ✅ {t(language, 'legendFast')}
          </li>
          <li>
            <span className="legend-swatch bar-warning" /> ⚠️ {t(language, 'legendOk')}
          </li>
          <li>
            <span className="legend-swatch bar-danger" /> ❌ {t(language, 'legendSlow')}
          </li>
        </ul>
      </div>
      {byUrl.map(([url, rows]) => (
        <ChartForUrl
          key={url}
          language={language}
          rows={rows}
          url={url}
          showUrl={byUrl.length > 1}
        />
      ))}
    </section>
  );
}
