# ⚡ Website Speed Test

Production-ready React-App zur globalen Performance-Messung von Websites — gehostet auf **Cloudflare Pages** mit einer **Pages Function** als Backend.

Miss die Ladezeit deiner Website aus **9 Ländern** (DE, US, GB, FR, NL, ES, IT, PL, JP), bekomme verständliche Empfehlungen in **einfacher Sprache (DE/EN)** und exportiere die Ergebnisse als **PDF, Excel, CSV oder JSON**.

## Features

- 🌍 **Echte Länder-Messungen** über die kostenlose [Globalping API](https://globalping.io) (echte Probes im jeweiligen Land), automatischer Fallback auf direkte Cloudflare-Edge-Messung
- 📊 Statistik pro URL×Land: Mittelwert, Standardabweichung, Min/Max, Median, TTFB, Success-Rate
- 🖼️ **Ressourcen-Analyse** pro URL (`POST /api/resources`): Bilder, CSS und JavaScript werden einzeln vermessen (Ladezeit + Größe), mit Gewichts-Verteilung, den langsamsten Ressourcen und Bild-Optimierungs-Hinweis (max. 12 Bilder / 8 CSS / 8 JS wegen Subrequest-Limit)
- ✅ Farbcodierte Bewertung: `< 1.5s` ✅ SUPER · `1.5–2.5s` ⚠️ OK · `> 2.5s` ❌ LANGSAM
- 🗂️ Sortierbare Ergebnistabelle (Klick auf Spaltentitel)
- 📄 Exporte mit Fallback-Ketten: PDF (jsPDF → Druckansicht), Excel (3 Sheets → CSV), CSV (UTF-8 BOM), JSON → Zwischenablage
- 🇩🇪/🇬🇧 Zweisprachig (Deutsch Standard, Englisch), Umschalter im Header, persistiert in `localStorage`
- 📱 Mobile-first, responsive (Breakpoints 768px / 1200px), barrierearm (ARIA, Tastaturnavigation)
- 🛡️ Fehlerresistent: einzelne fehlgeschlagene Kombinationen brechen den Test nicht ab; Auto-Retry mit Backoff; Offline-Erkennung

## Schnellstart

```bash
npm install

# Terminal 1: API-Server (Pages Function lokal, Port 8788)
npm run api

# Terminal 2: Frontend (Vite, Port 3000, proxied /api → 8788)
npm run dev
```

→ http://localhost:3000

Alternativ mit Wrangler (emuliert Cloudflare Pages komplett):

```bash
npm run build
npx wrangler pages dev ./dist
```

## Architektur

```
Browser (React)
  └─ pro URL×Land-Kombination: POST /api/speed-test   ← Fortschritt & Fehlerisolierung
       └─ Pages Function (functions/api/speed-test.js)
            ├─ 1. Globalping API → echte Probes im Zielland (max. 5 pro Land)
            └─ 2. Fallback: fetch() vom Cloudflare Edge (bis 30 Wiederholungen)
```

**Warum ein Request pro Kombination?** Der Cloudflare Free-Plan erlaubt max. 50 Subrequests pro Worker-Aufruf (9 Länder × 30 Wiederholungen = 270 würde scheitern). Außerdem bekommt die Fortschrittsanzeige so echte Granularität und ein Fehler betrifft nur eine Kombination.

**Antwortformat** (`POST /api/speed-test`):

```json
{
  "timestamp": "2026-07-13T12:00:00.000Z",
  "data": [
    {
      "url": "https://example.com/",
      "proxy": "DE",
      "city": "Berlin",
      "mean": 287,
      "stdDev": 45,
      "min": 187,
      "max": 567,
      "median": 298,
      "ttfbMean": 120,
      "status": 200,
      "successRate": 100,
      "source": "globalping"
    }
  ],
  "simplified": [
    {
      "country": "DE",
      "city": "Berlin",
      "loadTime": "0.29s",
      "status": "success",
      "statusEmoji": "✅",
      "statusText": "SUPER",
      "recommendation": "Nichts ändern",
      "recommendationKey": "rec_none"
    }
  ]
}
```

## Deployment (Cloudflare)

### Option A – Workers Builds / Git-Connect (empfohlen)

1. Repo zu GitHub pushen (Branch `main`)
2. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Import a repository**
3. Repo auswählen — **Deploy command:** `npx wrangler deploy` (Standard) reicht:
   der `[build]`-Block in `wrangler.toml` baut das Frontend automatisch vorher.
4. Jeder Push auf `main` deployed automatisch. Der Worker-Name im Dashboard sollte
   `website-speedtest` sein (sonst `name` in `wrangler.toml` anpassen).

Das Projekt ist als **Worker mit statischen Assets** konfiguriert
(`worker/index.js` routet `/api/speed-test`, alles andere kommt aus `dist/`).

### Option B – CLI

```bash
npm install -g wrangler
wrangler login
npx wrangler deploy        # baut automatisch (siehe [build] in wrangler.toml)
```

### Option C – Cloudflare Pages (klassisch)

Der Ordner `functions/` bleibt Pages-kompatibel: Pages-Projekt mit
**Build command** `npm run build` und **Output directory** `dist` anlegen
(dazu `main`/`[assets]` in `wrangler.toml` durch
`pages_build_output_dir = "dist"` ersetzen).

### Custom Domain (optional)

Pages-Projekt → **Custom domains** → Domain hinzufügen (z.B. `speed-test.kwonro.de`).

### Secrets (falls später benötigt)

```bash
wrangler pages secret put API_KEY
```

Es sind aktuell **keine** Secrets nötig — Globalping ist ohne API-Key nutzbar.

## Projektstruktur

```
├── functions/api/speed-test.js   # Cloudflare Pages Function (Backend)
├── public/_headers               # CSP- & Security-Header
├── scripts/local-api.mjs         # Lokaler API-Server ohne wrangler (Node 18+)
├── src/
│   ├── App.jsx                   # State-Management, Orchestrierung, Retry
│   ├── components/               # TestForm, ProgressBar, ResultsTable, ExportButtons
│   ├── utils/                    # i18n, metrics, formatters, exporters
│   ├── api/client.js             # axios-Wrapper: Concurrency, Retry, Fehlerisolierung
│   └── styles/App.css            # Mobile-first Styling
├── wrangler.toml
└── vite.config.js
```

## Bekannte Limitationen

| Limitation | Grund | Verhalten |
|---|---|---|
| Keine FCP/LCP-Messung | Erfordert echten Browser mit Rendering; weder Worker-`fetch` noch Globalping rendern | Gemessen werden TTFB, Gesamtladezeit, Statuscode, Content-Length |
| Globalping-Rate-Limits | Free Tier (ohne API-Key) begrenzt Messungen pro Stunde | Automatischer Fallback auf Edge-Messung (`source: "edge"` im Ergebnis) |
| Edge-Messung ohne Länderbezug | Cloudflare Workers können ihren Standort nicht wählen | Edge-Ergebnisse sind als „⚡ Edge-Messung" gekennzeichnet |
| Max. 5 Globalping-Probes pro Land | Free-Tier-Schonung | `repeats` > 5 gilt nur für den Edge-Fallback (bis 30) |
| PDF-Export ohne Emojis | jsPDF-Standardfonts können keine Emojis | Status als Text (SUPER/OK/LANGSAM) |

## Testing-Checkliste

- [x] Form akzeptiert gültige URLs (auto-`https://`-Präfix)
- [x] Form meldet ungültige URLs, testet gültige trotzdem
- [x] ProgressBar zeigt Fortschritt pro Kombination
- [x] Tabelle sortierbar (Spaltentitel klicken, ASC/DESC)
- [x] Farbcodierung ✅/⚠️/❌ nach Schwellen
- [x] PDF-, Excel- (3 Sheets), CSV-Export, JSON-Clipboard
- [x] Sprachumschalter DE/EN (persistiert)
- [x] Responsive < 768px (einspaltig, scrollbare Tabelle)
- [x] Fehlerszenarien: Timeout-Retry, Teilausfälle, Offline-Banner

## Browser-Kompatibilität

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
