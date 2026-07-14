/**
 * AuditView – vollständiger Website-Audit: Formular, mehrphasiger Fortschritt
 * und Bericht (Überblick, Empfehlungen, Performance/CWV, Ressourcen,
 * Sicherheit, gecrawlte Seiten, Subdomains, Fehler, Limitationen).
 * Props: language, onToast(message).
 */
import { useState } from 'react';
import { t } from '../utils/i18n';
import { runAudit, isOnline } from '../api/audit';
import { msToSeconds, formatBytes, formatMs } from '../utils/formatters';

const PHASES = ['crawl', 'subdomains', 'resources', 'lighthouse'];
const PHASE_LABEL = {
  crawl: 'phaseCrawl',
  subdomains: 'phaseSubdomains',
  resources: 'phaseResources',
  lighthouse: 'phaseLighthouse',
};

// Core-Web-Vitals-Schwellen (Google): [good, needs-improvement]
const CWV = {
  lcp: [2500, 4000, (v) => msToSeconds(v)],
  fcp: [1800, 3000, (v) => msToSeconds(v)],
  cls: [0.1, 0.25, (v) => v.toFixed(3)],
  tbt: [200, 600, (v) => formatMs(v)],
  inp: [200, 500, (v) => formatMs(v)],
  speedIndex: [3400, 5800, (v) => msToSeconds(v)],
  tti: [3800, 7300, (v) => msToSeconds(v)],
};

function cwvLevel(metric, value) {
  const spec = CWV[metric];
  if (!spec || value == null) return 'none';
  return value <= spec[0] ? 'success' : value <= spec[1] ? 'warning' : 'danger';
}

function scoreLevel(score) {
  if (score == null) return 'none';
  return score >= 90 ? 'success' : score >= 50 ? 'warning' : 'danger';
}

export default function AuditView({ language, onToast }) {
  const [url, setUrl] = useState('');
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [wantSubdomains, setWantSubdomains] = useState(true);
  const [wantLighthouse, setWantLighthouse] = useState(true);
  const [desktop, setDesktop] = useState(false);
  const [lighthouseCount, setLighthouseCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const raw = url.trim();
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed;
    try {
      parsed = new URL(normalized);
      if (!parsed.hostname.includes('.')) throw new Error();
    } catch {
      setError(t(language, 'invalidUrl', { url: raw }));
      return;
    }
    if (!isOnline()) {
      setError(t(language, 'offline'));
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);
    setProgress({ phase: 'crawl', done: 0, total: crawlLimit });
    try {
      const result = await runAudit(
        { url: parsed.href, crawlLimit, wantSubdomains, wantLighthouse, lighthouseCount, desktop },
        (phase, done, total) => setProgress({ phase, done, total }),
      );
      setReport(result);
      if (!result.pages.length) setError(t(language, 'auditNoResults'));
      const rl = result.errors.some((e) => e.rateLimited);
      if (rl) onToast?.(t(language, 'lhUnavailable'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <>
      <form className="card audit-form" onSubmit={handleSubmit}>
        <h2 className="audit-form-title">{t(language, 'auditTitle')}</h2>
        <label htmlFor="audit-url">{t(language, 'auditUrlLabel')}</label>
        <input
          id="audit-url"
          type="text"
          className="audit-url-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          disabled={loading}
        />

        <fieldset className="audit-options">
          <legend>{t(language, 'auditOptions')}</legend>
          <label className="audit-check">
            <input type="checkbox" checked={wantSubdomains} onChange={(e) => setWantSubdomains(e.target.checked)} disabled={loading} />
            {t(language, 'optSubdomains')}
          </label>
          <label className="audit-check">
            <input type="checkbox" checked={wantLighthouse} onChange={(e) => setWantLighthouse(e.target.checked)} disabled={loading} />
            {t(language, 'optLighthouse')}
          </label>
          <label className="audit-check">
            <input type="checkbox" checked={desktop} onChange={(e) => setDesktop(e.target.checked)} disabled={loading || !wantLighthouse} />
            {t(language, 'optDesktop')}
          </label>
        </fieldset>

        <div className="form-row">
          <label htmlFor="crawl-limit">
            {t(language, 'auditCrawlLabel')}
            <input id="crawl-limit" type="number" min={1} max={60} value={crawlLimit}
              onChange={(e) => setCrawlLimit(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} disabled={loading} />
          </label>
          <label htmlFor="lh-count">
            {t(language, 'auditLhCount')}
            <input id="lh-count" type="number" min={1} max={15} value={lighthouseCount}
              onChange={(e) => setLighthouseCount(Math.min(15, Math.max(1, Number(e.target.value) || 1)))} disabled={loading || !wantLighthouse} />
          </label>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? t(language, 'auditRunning') : t(language, 'auditStart')}
          </button>
        </div>

        <p className="audit-hint">ℹ️ {t(language, 'auditNote')}</p>
        {wantLighthouse && <p className="audit-hint">🔑 {t(language, 'psiKeyNote')}</p>}
      </form>

      {loading && progress && <AuditProgress language={language} progress={progress} />}
      {error && <div className="banner banner-danger" role="alert"><span>{error}</span></div>}
      {report && <AuditReport language={language} report={report} />}
    </>
  );
}

function AuditProgress({ language, progress }) {
  const activeIndex = PHASES.indexOf(progress.phase);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="card progress-card">
      <div className="audit-phases">
        {PHASES.map((phase, i) => (
          <span key={phase} className={`audit-phase ${i < activeIndex ? 'is-done' : i === activeIndex ? 'is-active' : ''}`}>
            {i < activeIndex ? '✓' : i === activeIndex ? '●' : '○'} {t(language, PHASE_LABEL[phase])}
          </span>
        ))}
      </div>
      <div className="progress-label">
        <span>{t(language, PHASE_LABEL[progress.phase])}: {progress.done}/{progress.total}</span>
        <span className="progress-percent">{pct}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${Math.max(3, pct)}%` }}>
          <span className="progress-shimmer" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function Overview({ language, report }) {
  const s = report.summary;
  const tiles = [
    { label: t(language, 'ovPages'), value: s.pageCount, accent: null },
    { label: t(language, 'ovSubdomains'), value: s.subdomainCount, accent: null },
    { label: t(language, 'ovBroken'), value: s.brokenCount, accent: s.brokenCount > 0 ? 'danger' : 'success' },
    { label: t(language, 'ovPerf'), value: s.avgPerformance != null ? s.avgPerformance : '–', accent: scoreLevel(s.avgPerformance) === 'none' ? null : scoreLevel(s.avgPerformance) },
    { label: t(language, 'ovWeight'), value: formatBytes(s.htmlPageCount ? s.totalBytes / s.htmlPageCount : 0, language), accent: null },
    { label: t(language, 'ovSecurity'), value: s.worstSecurityGrade ?? '–', accent: gradeAccent(s.worstSecurityGrade) },
  ];
  return (
    <div className="stat-tiles audit-tiles">
      {tiles.map((tile) => (
        <div key={tile.label} className={`stat-tile${tile.accent ? ` stat-${tile.accent}` : ''}`}>
          <span className="stat-label">{tile.label}</span>
          <span className="stat-value">{tile.value}</span>
        </div>
      ))}
    </div>
  );
}

function gradeAccent(grade) {
  if (!grade) return null;
  if (grade <= 'B') return 'success';
  if (grade <= 'C') return 'warning';
  return 'danger';
}

function Recommendations({ language, report }) {
  const recs = report.summary.recommendations;
  if (!recs.length) return null;
  return (
    <section className="card">
      <h2>{t(language, 'secRecs')}</h2>
      <ul className="rec-list">
        {recs.map((rec, i) => (
          <li key={i} className={`rec-item rec-${rec.priority}`}>
            <span className={`rec-badge rec-badge-${rec.priority}`}>{t(language, `prio${cap(rec.priority)}`)}</span>
            <span className="rec-text">{rec.text}</span>
            {rec.gain && <span className="rec-gain">{t(language, 'recGain')}: {rec.gain}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function Performance({ language, report }) {
  if (!report.lighthouse.length) {
    return (
      <section className="card">
        <h2>{t(language, 'secPerf')}</h2>
        <p className="res-note">{t(language, 'lhUnavailable')}</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>{t(language, 'secPerf')}</h2>
      {report.lighthouse.map((lh, i) => (
        <div key={i} className="lh-block">
          <p className="chart-url">{lh.url} · <strong>{lh.strategy}</strong></p>
          <PagePerformancePanel language={language} lh={lh} />
          <div className="lh-scores">
            {Object.entries(lh.scores).map(([cat, score]) => (
              <div key={cat} className={`lh-score lh-${scoreLevel(score)}`}>
                <span className="lh-score-num">{score ?? '–'}</span>
                <span className="lh-score-cat">{cat.replace('-', ' ')}</span>
              </div>
            ))}
          </div>
          <div className="cwv-grid">
            {['lcp', 'fcp', 'cls', 'tbt', 'speedIndex', 'tti'].map((m) => {
              const val = lh.lab[m];
              const level = cwvLevel(m, val);
              return (
                <div key={m} className={`cwv-cell cwv-${level}`}>
                  <span className="cwv-name">{m === 'speedIndex' ? 'Speed Index' : m.toUpperCase()}</span>
                  <span className="cwv-val">{val == null ? '–' : CWV[m][2](val)}</span>
                </div>
              );
            })}
          </div>
          {lh.field?.hasData ? (
            <p className="cwv-field">
              🌐 {t(language, 'fieldReal')}: LCP {fieldStr(lh.field.lcp, 'ms')} · INP {fieldStr(lh.field.inp, 'ms')} · CLS {fieldStr(lh.field.cls)}
            </p>
          ) : (
            <p className="res-note">{t(language, 'noFieldData')}</p>
          )}
        </div>
      ))}
    </section>
  );
}

function fieldStr(metric, unit = '') {
  if (!metric) return '–';
  return `${Math.round(metric.percentile)}${unit} (${metric.category ?? '?'})`;
}

// WebPageTest-Stil "Page Performance": Metrik-Grid + Filmstrip.
// Metriken kommen aus PageSpeed Insights (Lighthouse-Lauf).
function PagePerformancePanel({ language, lh }) {
  const pp = lh.pagePerf;
  if (!pp) return null;
  const cells = [
    { key: 'fcp', label: 'First Contentful Paint', value: msToSeconds(pp.fcp), level: cwvLevel('fcp', pp.fcp) },
    { key: 'lcp', label: 'Largest Contentful Paint', value: msToSeconds(pp.lcp), level: cwvLevel('lcp', pp.lcp) },
    { key: 'cls', label: 'Cumulative Layout Shift', value: pp.cls == null ? '–' : pp.cls.toFixed(3), level: cwvLevel('cls', pp.cls) },
    { key: 'ttfb', label: 'Time To First Byte', value: msToSeconds(pp.ttfb), level: pp.ttfb == null ? 'none' : pp.ttfb <= 800 ? 'success' : pp.ttfb <= 1800 ? 'warning' : 'danger' },
    { key: 'sr', label: t(language, 'ppStartRender'), value: msToSeconds(pp.startRender), level: 'none' },
    { key: 'si', label: 'Speed Index', value: msToSeconds(pp.speedIndex), level: cwvLevel('speedIndex', pp.speedIndex) },
    { key: 'tbt', label: 'Total Blocking Time', value: formatMs(pp.tbt), level: cwvLevel('tbt', pp.tbt) },
    { key: 'pw', label: t(language, 'ppPageWeight'), value: formatBytes(pp.pageWeight, language), level: 'none' },
    { key: 'dcl', label: t(language, 'ppDcl'), value: msToSeconds(pp.domContentLoaded), level: 'none' },
    { key: 'load', label: t(language, 'ppLoad'), value: msToSeconds(pp.load), level: 'none' },
    { key: 'total', label: t(language, 'ppTotal'), value: msToSeconds(pp.totalTime), level: 'none' },
    { key: 'req', label: t(language, 'ppRequests'), value: pp.requests ?? '–', level: 'none' },
  ];
  return (
    <div className="pp-panel">
      <div className="pp-grid">
        {cells.map((cell) => (
          <div key={cell.key} className={`pp-cell pp-${cell.level}`}>
            <span className="pp-label">{cell.label}</span>
            <span className="pp-value">{cell.value}</span>
          </div>
        ))}
      </div>
      {lh.filmstrip?.length > 0 && (
        <div className="pp-filmstrip-wrap">
          <span className="pp-filmstrip-title">🎞️ {t(language, 'ppFilmstrip')}</span>
          <div className="pp-filmstrip">
            {lh.filmstrip.map((frame, i) => (
              <figure key={i} className="pp-frame">
                <img src={frame.data} alt={`${msToSeconds(frame.timing)}`} loading="lazy" />
                <figcaption>{msToSeconds(frame.timing)}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SecuritySection({ language, report }) {
  const pages = report.perPage.filter((p) => p.security);
  if (!pages.length) return null;
  return (
    <section className="card">
      <h2>{t(language, 'secSecurity')}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t(language, 'colPage')}</th>
              <th>{t(language, 'colGrade')}</th>
              <th>HTTPS</th>
              <th>HSTS</th>
              <th>CSP</th>
              <th>CDN</th>
              <th>HTTP/3</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p, i) => {
              const h = p.security.headers;
              return (
                <tr key={i}>
                  <td className="cell-url">{shortPath(p.url)}</td>
                  <td><span className={`status-pill status-${gradeAccent(p.security.grade) ?? 'warning'}`}>{p.security.grade}</span></td>
                  <td>{p.security.https ? '✅' : '❌'}</td>
                  <td>{h.HSTS ? '✅' : '❌'}</td>
                  <td>{h.CSP ? '✅' : '❌'}</td>
                  <td>{h.cdn ?? '–'}</td>
                  <td>{h.http3 ? '✅' : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PagesSection({ language, report }) {
  return (
    <section className="card">
      <h2>{t(language, 'secPages')} <small className="results-meta">({report.pages.length})</small></h2>
      <div className="table-wrap audit-scroll">
        <table>
          <thead>
            <tr>
              <th>{t(language, 'colPage')}</th>
              <th>{t(language, 'colHttp')}</th>
              <th>{t(language, 'colTime')}</th>
              <th>{t(language, 'colType')}</th>
            </tr>
          </thead>
          <tbody>
            {report.pages.map((p, i) => (
              <tr key={i} className={p.status >= 400 || p.status === 0 ? 'row-danger' : ''}>
                <td className="cell-url">{shortPath(p.url)}{p.redirectedTo ? ' →' : ''}</td>
                <td><span className={`status-pill status-${p.status >= 400 || p.status === 0 ? 'danger' : p.status >= 300 ? 'warning' : 'success'}`}>{p.status || 'ERR'}</span></td>
                <td className="cell-time">{formatMs(p.timeMs)}</td>
                <td>{p.type ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubdomainsSection({ language, report }) {
  const sub = report.subdomains;
  if (!sub?.subdomains?.length) return null;
  const reachable = sub.subdomains.filter((s) => s.status && s.status > 0 && s.status < 400).length;
  return (
    <section className="card">
      <h2>{t(language, 'secSubs')} <small className="results-meta">({sub.subdomains.length} {t(language, 'subTotal')} · {reachable} {t(language, 'subReachable')})</small></h2>
      <div className="table-wrap audit-scroll">
        <table>
          <thead>
            <tr>
              <th>{t(language, 'colHost')}</th>
              <th>{t(language, 'colHttp')}</th>
              <th>{t(language, 'colServer')}</th>
            </tr>
          </thead>
          <tbody>
            {sub.subdomains.map((s, i) => (
              <tr key={i}>
                <td className="cell-url">{s.host}</td>
                <td>{s.status == null ? '–' : <span className={`status-pill status-${!s.status ? 'danger' : s.status >= 400 ? 'danger' : s.status >= 300 ? 'warning' : 'success'}`}>{s.status || 'ERR'}</span>}</td>
                <td>{s.server ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ErrorsSection({ language, report }) {
  if (!report.errors.length) return null;
  return (
    <section className="card">
      <h2>{t(language, 'secErrors')} <small className="results-meta">({report.errors.length})</small></h2>
      <ul className="err-list">
        {report.errors.slice(0, 30).map((e, i) => (
          <li key={i}><span className="err-phase">{e.phase}</span> {e.url ? shortPath(e.url) + ': ' : ''}{e.message}</li>
        ))}
      </ul>
    </section>
  );
}

function shortPath(url) {
  try {
    const u = new URL(url);
    const path = (u.pathname + u.search) || '/';
    return path.length > 60 ? path.slice(0, 57) + '…' : path;
  } catch {
    return url;
  }
}

function AuditReport({ language, report }) {
  return (
    <div className="audit-report">
      <Overview language={language} report={report} />
      <Recommendations language={language} report={report} />
      <Performance language={language} report={report} />
      <ResourceTotals language={language} report={report} />
      <SecuritySection language={language} report={report} />
      <PagesSection language={language} report={report} />
      <SubdomainsSection language={language} report={report} />
      <ErrorsSection language={language} report={report} />
      <section className="card limitations">
        <h3>ℹ️ {t(language, 'limitationsTitle')}</h3>
        <p>{t(language, 'limitationsBody')}</p>
      </section>
    </div>
  );
}

function ResourceTotals({ language, report }) {
  const pages = report.perPage.filter((p) => p.resources);
  if (!pages.length) return null;
  const agg = { images: 0, css: 0, js: 0, bytes: 0, requests: 0 };
  for (const p of pages) {
    agg.bytes += p.resources.totals.bytes;
    agg.requests += p.resources.totals.requests;
    agg.images += p.resources.byType.images.bytes;
    agg.css += p.resources.byType.css.bytes;
    agg.js += p.resources.byType.js.bytes;
  }
  const cdns = [...new Set(pages.flatMap((p) => p.resources.insights?.cdnUsed ?? []))];
  return (
    <section className="card">
      <h2>{t(language, 'secResources')}</h2>
      <div className="res-summary">
        <span className="res-chip"><strong>{formatBytes(agg.bytes, language)}</strong> {t(language, 'resWeight')}</span>
        <span className="res-chip"><strong>{agg.requests}</strong> {t(language, 'resRequests')}</span>
        <span className="res-chip">🖼️ <strong>{formatBytes(agg.images, language)}</strong></span>
        <span className="res-chip">🎨 <strong>{formatBytes(agg.css, language)}</strong></span>
        <span className="res-chip">⚙️ <strong>{formatBytes(agg.js, language)}</strong></span>
        {cdns.length > 0 && <span className="res-chip">☁️ {cdns.join(', ')}</span>}
      </div>
    </section>
  );
}
