/**
 * ResourceBreakdown – Ressourcen-Analyse pro URL:
 * Kennzahlen-Chips (HTML, Bilder, CSS, JS), gestapelter Gewichts-Balken
 * (Part-to-Whole, kategoriale Farben CVD-validiert, 2px Surface-Gaps,
 * Werte sichtbar in der Legende) und Top-5 der langsamsten Ressourcen.
 * Props: language, results ({resources: [Analyse pro URL]}).
 */
import { useMemo } from 'react';
import { t } from '../utils/i18n';
import { formatMs, formatBytes, msToSeconds } from '../utils/formatters';

// Kategoriale Farben (Referenz-Palette, validiert: worst ΔE 21.6)
const TYPE_META = [
  { key: 'document', color: '#2a78d6', icon: '📄', labelKey: 'resDocument' },
  { key: 'images', color: '#1baf7a', icon: '🖼️', labelKey: 'resImages' },
  { key: 'css', color: '#eda100', icon: '🎨', labelKey: 'resCss' },
  { key: 'js', color: '#4a3aa7', icon: '⚙️', labelKey: 'resJs' },
];

const ICON_BY_TYPE = { images: '🖼️', css: '🎨', js: '⚙️' };

function fileName(url) {
  try {
    const path = new URL(url).pathname;
    const name = path.split('/').filter(Boolean).pop() ?? path;
    return name.length > 42 ? `${name.slice(0, 39)}…` : name || '/';
  } catch {
    return url.slice(0, 42);
  }
}

function AnalysisBlock({ language, analysis, showUrl }) {
  const segments = useMemo(() => {
    const values = {
      document: { bytes: analysis.document.bytes, timeMs: analysis.document.timeMs, count: 1 },
      images: analysis.byType.images,
      css: analysis.byType.css,
      js: analysis.byType.js,
    };
    const total = Object.values(values).reduce((sum, v) => sum + (v.bytes ?? 0), 0);
    return TYPE_META.map((meta) => {
      const v = values[meta.key];
      return {
        ...meta,
        bytes: v.bytes ?? 0,
        timeMs: v.timeMs ?? 0,
        count: v.count ?? v.tested ?? 0,
        pct: total > 0 ? ((v.bytes ?? 0) / total) * 100 : 0,
      };
    });
  }, [analysis]);

  const slowest = useMemo(
    () =>
      Object.entries(analysis.byType)
        .flatMap(([type, data]) => data.items.map((item) => ({ ...item, type })))
        .sort((a, b) => b.timeMs - a.timeMs)
        .slice(0, 5),
    [analysis],
  );

  const maxSlowMs = Math.max(1, ...slowest.map((item) => item.timeMs));
  const totalBytes = analysis.totals.bytes;
  const imagesPct = totalBytes > 0 ? Math.round((analysis.byType.images.bytes / totalBytes) * 100) : 0;
  const hasResources = analysis.totals.requests > 1;

  return (
    <div className="res-block">
      {showUrl && <p className="chart-url">{analysis.url}</p>}

      <div className="res-summary">
        <span className="res-chip">
          <strong>{formatBytes(totalBytes, language)}</strong> {t(language, 'resWeight')}
        </span>
        <span className="res-chip">
          <strong>{analysis.totals.requests}</strong> {t(language, 'resRequests')}
        </span>
        <span className="res-chip">
          <strong>{msToSeconds(analysis.totals.estimatedLoadMs)}</strong>{' '}
          {t(language, 'resEstimate')}
        </span>
      </div>

      {hasResources ? (
        <>
          <div className="res-bar" role="img" aria-label={t(language, 'resWeight')}>
            {segments
              .filter((segment) => segment.bytes > 0)
              .map((segment) => (
                <span
                  key={segment.key}
                  className="res-segment"
                  style={{ width: `${Math.max(1.5, segment.pct)}%`, background: segment.color }}
                  title={`${t(language, segment.labelKey)}: ${formatBytes(segment.bytes, language)}`}
                />
              ))}
          </div>
          <ul className="res-legend">
            {segments.map((segment) => (
              <li key={segment.key}>
                <span className="legend-swatch" style={{ background: segment.color }} />
                <span className="res-legend-label">
                  {segment.icon} {t(language, segment.labelKey)}
                </span>
                <span className="res-legend-value">
                  {t(language, 'resCount', { n: segment.count })} ·{' '}
                  {formatBytes(segment.bytes, language)} · {formatMs(segment.timeMs)}
                </span>
              </li>
            ))}
          </ul>

          {slowest.length > 0 && (
            <div className="res-slowest">
              <h3>{t(language, 'resSlowest')}</h3>
              <ul>
                {slowest.map((item) => (
                  <li key={item.url}>
                    <span className="res-file" title={item.url}>
                      {ICON_BY_TYPE[item.type]} {fileName(item.url)}
                    </span>
                    <span className="res-file-bar">
                      <span
                        className="res-file-fill"
                        style={{ width: `${(item.timeMs / maxSlowMs) * 100}%` }}
                      />
                    </span>
                    <span className="res-file-meta">
                      {formatMs(item.timeMs)} · {formatBytes(item.bytes, language)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {imagesPct >= 40 && analysis.byType.images.bytes > 300_000 && (
            <p className="res-hint">
              {t(language, 'resImagesHeavy', {
                pct: imagesPct,
                size: formatBytes(analysis.byType.images.bytes, language),
              })}
            </p>
          )}
          {(analysis.totals.truncated || analysis.totals.failed > 0) && (
            <p className="res-note">
              {analysis.totals.truncated && t(language, 'resTruncated')}
              {analysis.totals.truncated && analysis.totals.failed > 0 && ' · '}
              {analysis.totals.failed > 0 &&
                t(language, 'resFailedNote', { n: analysis.totals.failed })}
            </p>
          )}
        </>
      ) : (
        <p className="res-note">{t(language, 'resNone')}</p>
      )}
    </div>
  );
}

export default function ResourceBreakdown({ language, results }) {
  const analyses = results.resources ?? [];
  if (!analyses.length) return null;

  return (
    <section className="card res-card">
      <div className="chart-head">
        <div>
          <h2>{t(language, 'resTitle')}</h2>
          <p className="chart-subtitle">{t(language, 'resSubtitle')}</p>
        </div>
      </div>
      {analyses.map((analysis) => (
        <AnalysisBlock
          key={analysis.url}
          language={language}
          analysis={analysis}
          showUrl={analyses.length > 1}
        />
      ))}
    </section>
  );
}
