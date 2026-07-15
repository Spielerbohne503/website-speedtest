/**
 * App – ein einziger Test misst alles: Länder-Speed, Crawl, Subdomains,
 * Ressourcen, Sicherheit und Lighthouse/Core Web Vitals. Der Bericht zeigt
 * alle Sektionen zusammen (wie ein voller PageSpeed-/WebPageTest-Report).
 */
import { useCallback, useEffect, useState } from 'react';
import UnifiedForm from './components/UnifiedForm';
import RocketProgress from './components/RocketProgress';
import StarField from './components/StarField';
import StatTiles from './components/StatTiles';
import SpeedChart from './components/SpeedChart';
import ResourceBreakdown from './components/ResourceBreakdown';
import ResultsTable from './components/ResultsTable';
import ExportButtons from './components/ExportButtons';
import {
  Overview,
  Performance,
  Recommendations,
  ResourceTotals,
  SecuritySection,
  PagesSection,
  SubdomainsSection,
  ErrorsSection,
  Limitations,
} from './components/AuditReport';
import { getLanguage, setLanguage, t } from './utils/i18n';
import { runEverything } from './api/fulltest';
import { isOnline } from './api/client';
import { parseImportedJSON } from './utils/exporters';
import './styles/App.css';

const PHASE_LABEL = {
  speed: 'phaseSpeed',
  crawl: 'phaseCrawl',
  subdomains: 'phaseSubdomains',
  resources: 'phaseResources',
  lighthouse: 'phaseLighthouse',
};

export default function App() {
  const [language, setLang] = useState(getLanguage);
  const [result, setResult] = useState(null); // { speed, audit }
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ phase: 'crawl', done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [online, setOnline] = useState(isOnline());
  const [lastOptions, setLastOptions] = useState(null);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const toggleLanguage = () => {
    const next = language === 'de' ? 'en' : 'de';
    setLanguage(next);
    setLang(next);
  };

  const handleSubmit = useCallback(
    async (options) => {
      if (!isOnline()) {
        setError(t(language, 'offline'));
        return;
      }
      setLastOptions(options);
      setLoading(true);
      setError(null);
      setResult(null);
      setProgress({ phase: 'crawl', done: 0, total: 0 });
      try {
        const res = await runEverything(options, (phase, done, total) =>
          setProgress({ phase, done, total }),
        );
        setResult(res);
        if (!res.audit.pages.length && !res.speed?.rows?.length) {
          setError(t(language, 'auditNoResults'));
        } else if (res.audit.errors.some((e) => e.rateLimited)) {
          setToast(t(language, 'lhUnavailable'));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [language],
  );

  const handleRetry = () => lastOptions && handleSubmit(lastOptions);

  const handleImport = (text) => {
    try {
      const imported = parseImportedJSON(text);
      setResult(imported);
      setError(null);
      setToast(t(language, 'importSuccess'));
    } catch {
      setToast(t(language, 'importError'));
    }
  };

  const speed = result?.speed;
  const audit = result?.audit;
  const hasResult = Boolean(audit?.pages?.length || speed?.rows?.length);

  return (
    <div className="app">
      <StarField />
      <header className="app-header">
        <div className="hero-glow" aria-hidden="true" />
        <button type="button" className="lang-toggle" onClick={toggleLanguage} aria-label="Sprache wechseln / switch language">
          {t(language, 'langToggle')}
        </button>
        <h1>{t(language, 'appTitle')}</h1>
        <p>{t(language, 'unifiedSub')}</p>
        <div className="hero-badges" aria-hidden="true">
          <span>🌍 {t(language, 'badgeCountries')}</span>
          <span>🔬 Lighthouse</span>
          <span>🖼️ {t(language, 'badgeExport')}</span>
        </div>
      </header>

      <main className="app-main">
        {!online && (
          <div className="banner banner-danger" role="alert">
            <span>{t(language, 'offline')}</span>
            <button type="button" onClick={handleRetry} disabled={!lastOptions}>
              {t(language, 'retryOnline')}
            </button>
          </div>
        )}

        <UnifiedForm
          language={language}
          disabled={loading || !online}
          onSubmit={handleSubmit}
          onImport={handleImport}
        />

        {loading && (
          <RocketProgress
            label={t(language, PHASE_LABEL[progress.phase] ?? 'progressLabel')}
            done={progress.done}
            total={progress.total}
            hint={t(language, 'progressSlow')}
          />
        )}

        {error && (
          <div className="banner banner-danger" role="alert">
            <span>{error}</span>
            {lastOptions && (
              <button type="button" onClick={handleRetry}>
                {t(language, 'retry')}
              </button>
            )}
          </div>
        )}

        {hasResult && (
          <div className="audit-report">
            {audit && <Overview language={language} report={audit} />}
            {audit && <Performance language={language} report={audit} />}
            {speed?.rows?.length > 0 && (
              <>
                <StatTiles language={language} results={speed} />
                <SpeedChart language={language} results={speed} />
              </>
            )}
            {audit && <Recommendations language={language} report={audit} />}
            {speed?.resources?.length > 0 && <ResourceBreakdown language={language} results={speed} />}
            {audit && <ResourceTotals language={language} report={audit} />}
            {audit && <SecuritySection language={language} report={audit} />}
            {audit && <PagesSection language={language} report={audit} />}
            {audit && <SubdomainsSection language={language} report={audit} />}
            {audit && <ErrorsSection language={language} report={audit} />}
            {speed?.rows?.length > 0 && <ResultsTable language={language} results={speed} />}
            <ExportButtons language={language} result={result} onToast={setToast} />
            {audit && <Limitations language={language} />}
          </div>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <footer className="app-footer">{t(language, 'footerNote')}</footer>
    </div>
  );
}
