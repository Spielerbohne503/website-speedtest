/**
 * ProgressBar – Fortschritt der laufenden Tests (done/total Kombinationen).
 * Zeigt nach 45s einen Hinweis, dass die Tests länger dauern (Spec Szenario 1).
 * Props: language, done (number), total (number).
 */
import { useEffect, useState } from 'react';
import { t } from '../utils/i18n';

export default function ProgressBar({ language, done, total }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="card progress-card">
      <div className="progress-label">
        <span>
          {t(language, 'progressLabel')}: {done}/{total}
        </span>
        <span>{percent}%</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t(language, 'progressLabel')}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      {elapsed > 45 && done < total && <p className="progress-hint">{t(language, 'progressSlow')}</p>}
    </div>
  );
}
