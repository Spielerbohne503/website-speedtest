/**
 * TestForm – URL-Eingabe, Länderauswahl (9 Checkboxen), Wiederholungen.
 * Props: language ('de'|'en'), disabled (bool), onSubmit({urls, proxies, repeats}).
 * Ungültige URLs werden gemeldet, gültige trotzdem getestet (Spec Szenario 3).
 */
import { useState } from 'react';
import { COUNTRIES, t, countryName, cityName } from '../utils/i18n';

const MAX_URLS = 10;

export default function TestForm({ language, disabled, onSubmit }) {
  const [urlText, setUrlText] = useState('');
  const [selected, setSelected] = useState(() => new Set(COUNTRIES.map((c) => c.country)));
  const [repeats, setRepeats] = useState(5);
  const [messages, setMessages] = useState([]);

  const toggleCountry = (code) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const warnings = [];
    const urls = [];
    for (const line of urlText.split('\n')) {
      const raw = line.trim();
      if (!raw) continue;
      const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      try {
        const parsed = new URL(candidate);
        if (!parsed.hostname.includes('.')) throw new Error('no TLD');
        if (!urls.includes(parsed.href)) urls.push(parsed.href);
      } catch {
        warnings.push(t(language, 'invalidUrl', { url: raw }));
      }
    }
    if (!urls.length) warnings.push(t(language, 'noUrls'));
    if (!selected.size) warnings.push(t(language, 'noCountries'));
    setMessages(warnings);
    if (!urls.length || !selected.size) return;

    const proxies = COUNTRIES.filter((c) => selected.has(c.country)).map((c) => ({
      country: c.country,
      city: c.city,
    }));
    onSubmit({ urls: urls.slice(0, MAX_URLS), proxies, repeats });
  };

  return (
    <form className="card test-form" onSubmit={handleSubmit}>
      <label htmlFor="url-input">{t(language, 'urlLabel')}</label>
      <textarea
        id="url-input"
        rows={4}
        value={urlText}
        onChange={(event) => setUrlText(event.target.value)}
        placeholder={t(language, 'urlPlaceholder')}
        disabled={disabled}
        aria-label={t(language, 'urlLabel')}
      />

      <fieldset className="country-grid">
        <legend>{t(language, 'countriesLabel')}</legend>
        {COUNTRIES.map((c) => (
          <label key={c.country} className="country-option">
            <input
              type="checkbox"
              checked={selected.has(c.country)}
              onChange={() => toggleCountry(c.country)}
              disabled={disabled}
              aria-label={`${countryName(language, c.country)} – ${cityName(language, c.country)}`}
            />
            <span>
              {c.flag} {countryName(language, c.country)}{' '}
              <small>({cityName(language, c.country)})</small>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="form-row">
        <label htmlFor="repeats-input">
          {t(language, 'repeatsLabel')} <small>{t(language, 'repeatsHint')}</small>
        </label>
        <input
          id="repeats-input"
          type="number"
          min={1}
          max={30}
          value={repeats}
          onChange={(event) =>
            setRepeats(Math.min(30, Math.max(1, Number(event.target.value) || 1)))
          }
          disabled={disabled}
        />
        <button type="submit" className="btn-primary" disabled={disabled}>
          {disabled ? t(language, 'testing') : t(language, 'startTest')}
        </button>
      </div>

      {messages.length > 0 && (
        <ul className="form-messages" role="alert">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
