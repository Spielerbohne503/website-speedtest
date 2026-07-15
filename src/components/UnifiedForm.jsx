/**
 * UnifiedForm – ein Formular für den kompletten Website-Check:
 * URL, Testländer (9), Wiederholungen und Audit-Optionen (Crawl-Tiefe,
 * Subdomains, Lighthouse, Desktop). Ein Klick startet alles.
 * Props: language, disabled, onSubmit(options).
 */
import { useState } from 'react';
import { COUNTRIES, t, countryName, cityName } from '../utils/i18n';

export default function UnifiedForm({ language, disabled, onSubmit }) {
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState(() => new Set(COUNTRIES.map((c) => c.country)));
  const [repeats, setRepeats] = useState(5);
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [lighthouseCount, setLighthouseCount] = useState(5);
  const [wantSubdomains, setWantSubdomains] = useState(true);
  const [wantLighthouse, setWantLighthouse] = useState(true);
  const [desktop, setDesktop] = useState(false);
  const [message, setMessage] = useState(null);

  const toggleCountry = (code) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  const handleSubmit = (event) => {
    event.preventDefault();
    const raw = url.trim();
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed;
    try {
      parsed = new URL(candidate);
      if (!parsed.hostname.includes('.')) throw new Error();
    } catch {
      setMessage(t(language, 'invalidUrl', { url: raw || '—' }));
      return;
    }
    setMessage(null);
    const proxies = COUNTRIES.filter((c) => selected.has(c.country)).map((c) => ({
      country: c.country,
      city: c.city,
    }));
    onSubmit({
      url: parsed.href,
      proxies,
      repeats,
      crawlLimit,
      wantSubdomains,
      wantLighthouse,
      lighthouseCount,
      desktop,
    });
  };

  return (
    <form className="card unified-form" onSubmit={handleSubmit}>
      <label htmlFor="site-url">{t(language, 'auditUrlLabel')}</label>
      <input
        id="site-url"
        type="text"
        className="audit-url-input"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com"
        disabled={disabled}
      />

      <fieldset className="country-grid">
        <legend>{t(language, 'countriesLabel')}</legend>
        {COUNTRIES.map((c) => (
          <label key={c.country} className={`country-option${selected.has(c.country) ? ' is-selected' : ''}`}>
            <input
              type="checkbox"
              className="country-checkbox"
              checked={selected.has(c.country)}
              onChange={() => toggleCountry(c.country)}
              disabled={disabled}
              aria-label={`${countryName(language, c.country)} – ${cityName(language, c.country)}`}
            />
            <span className="country-flag" aria-hidden="true">{c.flag}</span>
            <span className="country-text">
              {countryName(language, c.country)}
              <small>{cityName(language, c.country)}</small>
            </span>
            <span className="country-check" aria-hidden="true">✓</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="audit-options">
        <legend>{t(language, 'auditOptions')}</legend>
        <label className="audit-check">
          <input type="checkbox" checked={wantSubdomains} onChange={(e) => setWantSubdomains(e.target.checked)} disabled={disabled} />
          {t(language, 'optSubdomains')}
        </label>
        <label className="audit-check">
          <input type="checkbox" checked={wantLighthouse} onChange={(e) => setWantLighthouse(e.target.checked)} disabled={disabled} />
          {t(language, 'optLighthouse')}
        </label>
        <label className="audit-check">
          <input type="checkbox" checked={desktop} onChange={(e) => setDesktop(e.target.checked)} disabled={disabled || !wantLighthouse} />
          {t(language, 'optDesktop')}
        </label>
      </fieldset>

      <div className="form-row unified-row">
        <label htmlFor="u-repeats">
          {t(language, 'repeatsLabel')}
          <input id="u-repeats" type="number" min={1} max={30} value={repeats}
            onChange={(e) => setRepeats(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} disabled={disabled} />
        </label>
        <label htmlFor="u-crawl">
          {t(language, 'auditCrawlLabel')}
          <input id="u-crawl" type="number" min={1} max={60} value={crawlLimit}
            onChange={(e) => setCrawlLimit(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} disabled={disabled} />
        </label>
        <label htmlFor="u-lh">
          {t(language, 'auditLhCount')}
          <input id="u-lh" type="number" min={1} max={15} value={lighthouseCount}
            onChange={(e) => setLighthouseCount(Math.min(15, Math.max(1, Number(e.target.value) || 1)))} disabled={disabled || !wantLighthouse} />
        </label>
        <button type="submit" className="btn-primary" disabled={disabled}>
          {disabled ? t(language, 'unifiedRunning') : t(language, 'unifiedStart')}
        </button>
      </div>

      <p className="audit-hint">🌍 {t(language, 'scopeNote')}</p>
      <p className="audit-hint">ℹ️ {t(language, 'auditNote')}</p>
      {wantLighthouse && <p className="audit-hint">🔑 {t(language, 'psiKeyNote')}</p>}
      {message && <ul className="form-messages" role="alert"><li>{message}</li></ul>}
    </form>
  );
}
