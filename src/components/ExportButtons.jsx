/**
 * ExportButtons – PDF / Excel / CSV / JSON-Datei / JSON-Clipboard.
 * Arbeitet auf dem kombinierten Ergebnis { speed, audit }.
 * Jeder Export hat eine Fallback-Kette; das Ergebnis wird als Toast gemeldet.
 * Props: language, result ({ speed, audit }), onToast(message).
 */
import { useState } from 'react';
import { t } from '../utils/i18n';
import { exportPDF, exportExcel, exportCSV, exportJSON, copyJSON } from '../utils/exporters';

export default function ExportButtons({ language, result, onToast }) {
  const [busy, setBusy] = useState(null);

  const run = async (name, fn) => {
    setBusy(name);
    try {
      const message = await fn(result, language);
      if (message) onToast(message);
    } catch {
      onToast(t(language, 'errorGeneric'));
    } finally {
      setBusy(null);
    }
  };

  const buttons = [
    { name: 'pdf', label: t(language, 'exportPdf'), fn: exportPDF },
    { name: 'excel', label: t(language, 'exportExcel'), fn: exportExcel },
    { name: 'csv', label: t(language, 'exportCsv'), fn: exportCSV },
    { name: 'jsonFile', label: t(language, 'exportJsonFile'), fn: exportJSON },
    { name: 'json', label: t(language, 'exportJson'), fn: copyJSON },
  ];

  return (
    <div className="export-buttons">
      {buttons.map((button) => (
        <button
          key={button.name}
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => run(button.name, button.fn)}
          aria-label={button.label}
        >
          {busy === button.name ? '…' : button.label}
        </button>
      ))}
    </div>
  );
}
