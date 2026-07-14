/**
 * App – zentrales State-Management.
 * State: results, loading, progress, language, error, online, toast.
 * Ablauf: TestForm → runSpeedTest (pro Kombination, mit Retry) → ResultsTable + Exporte.
 */
import { useCallback, useEffect, useState } from 'react';
import TestForm from './components/TestForm';
import ProgressBar from './components/ProgressBar';
import StatTiles from './components/StatTiles';
import SpeedChart from './components/SpeedChart';
import ResourceBreakdown from './components/ResourceBreakdown';
import ResultsTable from './components/ResultsTable';
import ExportButtons from './components/ExportButtons';
import AuditView from './components/AuditView';
import { getLanguage, setLanguage, t } from './utils/i18n';
import { runSpeedTest, isOnline, errorKey } from './api/client';
import './styles/App.css';

export default function App() {
  const [language, setLang] = useState(getLanguage);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [online, setOnline] = useState(isOnline());
  const [lastRequest, setLastRequest] = useState(null);
  const [mode, setMode] = useState('speed'); // 'speed' | 'audit'

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
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const toggleLanguage = () => {
    const next = language === 'de' ? 'en' : 'de';
    setLanguage(next);
    setLang(next);
  };

  const handleTestSubmit = useCallback(
    async (request) => {
      if (!isOnline()) {
        setError(t(language, 'offline'));
        return;
      }
      setLastRequest(request);
      setLoading(true);
      setError(null);
      setResults(null);
      try {
        const res = await runSpeedTest(request.urls, request.proxies, request.repeats, (done, total) =>
          setProgress({ done, total }),
        );
        setResults(res);
        const okRows = res.rows.filter((row) => row.source !== 'error');
        if (!okRows.length) {
          setError(t(language, 'allFailed'));
        } else if (res.errors.length) {
          setToast(t(language, 'partialErrors', { n: res.errors.length }));
        }
      } catch (err) {
        setError(t(language, errorKey(err)));
      } finally {
        setLoading(false);
      }
    },
    [language],
  );

  const handleRetry = () => lastRequest && handleTestSubmit(lastRequest);

  return (
    <div className="app">
      <header className="app-header">
        <div className="hero-glow" aria-hidden="true" />
        <button type="button" className="lang-toggle" onClick={toggleLanguage} aria-label="Sprache wechseln / switch language">
          {t(language, 'langToggle')}
        </button>
        <h1>{t(language, 'appTitle')}</h1>
        <p>{t(language, 'appSubtitle')}</p>
        <div className="hero-badges" aria-hidden="true">
          <span>🌍 {t(language, 'badgeCountries')}</span>
          <span>📡 {t(language, 'badgeReal')}</span>
          <span>📄 {t(language, 'badgeExport')}</span>
        </div>
        <div className="mode-switch" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'speed'}
            className={mode === 'speed' ? 'is-active' : ''} onClick={() => setMode('speed')}>
            {t(language, 'modeSpeed')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'audit'}
            className={mode === 'audit' ? 'is-active' : ''} onClick={() => setMode('audit')}>
            {t(language, 'modeAudit')}
          </button>
        </div>
      </header>

      <main className="app-main">
        {!online && (
          <div className="banner banner-danger" role="alert">
            <span>{t(language, 'offline')}</span>
            <button type="button" onClick={handleRetry} disabled={!lastRequest}>
              {t(language, 'retryOnline')}
            </button>
          </div>
        )}

        {mode === 'audit' ? (
          <AuditView language={language} onToast={setToast} />
        ) : (
          <>
            <TestForm language={language} disabled={loading || !online} onSubmit={handleTestSubmit} />

            {loading && <ProgressBar language={language} done={progress.done} total={progress.total} />}

            {error && (
              <div className="banner banner-danger" role="alert">
                <span>{error}</span>
                {lastRequest && (
                  <button type="button" onClick={handleRetry}>
                    {t(language, 'retry')}
                  </button>
                )}
              </div>
            )}

            {results?.rows?.length > 0 && (
              <>
                <StatTiles language={language} results={results} />
                <SpeedChart language={language} results={results} />
                <ResourceBreakdown language={language} results={results} />
                <ResultsTable language={language} results={results} />
                <ExportButtons language={language} results={results} onToast={setToast} />
              </>
            )}
          </>
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
