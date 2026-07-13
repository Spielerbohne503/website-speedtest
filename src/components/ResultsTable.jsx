/**
 * ResultsTable – sortierbare, farbcodierte Ergebnistabelle (DE/EN).
 * Spalten: Land | Stadt | Ladezeit | Status | Empfehlung (+ URL bei mehreren URLs).
 * Sortierung: Klick auf Spaltentitel toggelt ASC/DESC (aria-sort gesetzt).
 * Props: language, results ({rows, timestamp}).
 */
import { useMemo, useState } from 'react';
import { t, countryName, cityName } from '../utils/i18n';
import { statusTextKey, summarize } from '../utils/metrics';
import { msToSeconds, formatMs, formatTimestamp } from '../utils/formatters';

const SORT_KEYS = {
  url: (row) => row.url ?? '',
  country: (row) => row.country ?? '',
  city: (row) => row.city ?? '',
  meanMs: (row) => (row.meanMs == null ? Number.POSITIVE_INFINITY : row.meanMs),
  level: (row) => ({ success: 0, warning: 1, danger: 2 }[row.level] ?? 3),
};

export default function ResultsTable({ language, results }) {
  const [sort, setSort] = useState({ key: 'meanMs', dir: 'asc' });
  const rows = results.rows;
  const multiUrl = useMemo(() => new Set(rows.map((row) => row.url)).size > 1, [rows]);
  const maxMean = useMemo(
    () => Math.max(1, ...rows.map((row) => row.meanMs ?? 0)),
    [rows],
  );
  const counts = useMemo(() => summarize(rows), [rows]);

  const sorted = useMemo(() => {
    const getter = SORT_KEYS[sort.key] ?? SORT_KEYS.meanMs;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (va < vb) return -factor;
      if (va > vb) return factor;
      return 0;
    });
  }, [rows, sort]);

  const toggleSort = (key) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );

  const headers = [
    ...(multiUrl ? [{ key: 'url', label: t(language, 'colUrl') }] : []),
    { key: 'country', label: t(language, 'colCountry') },
    { key: 'city', label: t(language, 'colCity') },
    { key: 'meanMs', label: t(language, 'colLoadTime') },
    { key: 'level', label: t(language, 'colStatus') },
    { key: null, label: t(language, 'colRecommendation') },
  ];

  return (
    <section className="card results-card">
      <div className="results-head">
        <h2>{t(language, 'resultsTitle')}</h2>
        <p className="results-meta">
          {t(language, 'testedAt')}: {formatTimestamp(results.timestamp, language)} · ✅ {counts.success} · ⚠️{' '}
          {counts.warning} · ❌ {counts.danger}
        </p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((header) =>
                header.key ? (
                  <th
                    key={header.label}
                    aria-sort={
                      sort.key === header.key
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button type="button" className="sort-btn" onClick={() => toggleSort(header.key)}>
                      {header.label} {sort.key === header.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </button>
                  </th>
                ) : (
                  <th key={header.label}>{header.label}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => {
              const hasData = row.meanMs != null;
              return (
                <tr key={`${row.url}-${row.country}-${index}`} className={`row-${row.level}`}>
                  {multiUrl && <td className="cell-url">{row.url}</td>}
                  <td>{countryName(language, row.country)}</td>
                  <td>{cityName(language, row.country) || row.city}</td>
                  <td className="cell-time">
                    <strong>{hasData ? msToSeconds(row.meanMs) : t(language, 'noData')}</strong>
                    {hasData && (
                      <>
                        <span
                          className={`bar bar-${row.level}`}
                          style={{ width: `${Math.max(4, (row.meanMs / maxMean) * 100)}%` }}
                          aria-hidden="true"
                        />
                        <small>
                          {formatMs(row.min)} / {formatMs(row.median)} / {formatMs(row.max)} · ±
                          {formatMs(row.stdDev)}
                        </small>
                      </>
                    )}
                  </td>
                  <td className="cell-status">
                    <span className={`status-pill status-${row.level}`}>
                      {row.statusEmoji} {t(language, statusTextKey(row.level, hasData))}
                    </span>
                    <small>
                      {row.source === 'globalping'
                        ? `${t(language, 'sourceGlobalping')}${row.sourceCity ? ` (${row.sourceCity})` : ''}`
                        : row.source === 'edge'
                          ? t(language, 'sourceEdge')
                          : ''}
                    </small>
                  </td>
                  <td>{t(language, row.recommendationKey) || row.recommendation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
