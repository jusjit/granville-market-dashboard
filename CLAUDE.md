# Granville Market Dashboard — Project Reference

## Overview
Pre-market trading dashboard based on Granville's 1960 timing system. React + Vite + Tailwind v4. Deployed on Vercel. Ongoing project.

## Tech Stack
- **Frontend**: React 19, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), Recharts, Lucide React
- **Deployment**: Vercel (auto-deploys from `main` branch of `jusjit/granville-market-dashboard`)
- **Local dev**: Two processes required (see below)

## Local Dev Setup
Two servers must run simultaneously:

```
# Terminal 1 — API functions (port 3001)
npm run dev:api        # runs: node local-api-server.mjs

# Terminal 2 — Vite frontend (port 5173)
npm run dev            # runs: vite
```

Open **http://localhost:5173**. Vite proxies `/api/*` to port 3001 via `vite.config.js`.

**Do NOT use `vercel dev`** — it fights with Vite on Windows and serves blank pages.

`local-api-server.mjs` reads `.env` and maps `VITE_*` keys to plain keys for server-side use.

## Environment Variables

### `.env` (local, never committed — see file for actual values)
`VITE_FINNHUB_KEY`, `VITE_FRED_KEY`, `VITE_1MIN_KEY` (VITE_* mapped to plain names by local-api-server), `VITE_SHOW_ALMA=true`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TRADIER_KEY`, `INGEST_SECRET`

### Vercel (TWO projects from the same repo/branch)
- **granville-market-dashboard** — PUBLIC. Shows Synthesis + Granville + Macro + Vol Surface.
- **private-market-dashboard** — PRIVATE (Vercel Authentication enabled). Same + Alma panels via `VITE_SHOW_ALMA=true`.

Env vars on BOTH (no VITE_ prefix — server-side only): `FINNHUB_KEY`, `FRED_KEY`, `ONEMIN_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TRADIER_KEY`, `INGEST_SECRET`.
Private project ONLY: `VITE_SHOW_ALMA=true` (its absence hides Alma on public).

## Supabase (project "LalliChaths", https://oteatsbkdamvczdceion.supabase.co)
Tables: `intraday_posts` (Alma daily levels), `weekly_posts`, `market_data` (SPX/VIX OHLC + gaps), `rules` (16 backtested rules with confidence tiers).
- RLS enabled, no policies — only service role key reads/writes.
- `intraday_posts`/`weekly_posts`: unique constraint on `date`, identity ids (for webhook upserts).
- Original data migrated from SQLite (`Alma backtest rules/` folder, gitignored).

## API Routes (`/api/*.js` — Vercel serverless functions)

### `api/finnhub.js`
- GET `/api/finnhub?symbols=RSP,SPY,...`
- Fetches ETF quotes from Finnhub (free tier — ETF/stocks only, no CBOE indices)
- Returns: `[{ symbol, price, prevClose, pctChange }]`
- Cache-Control: `s-maxage=60, stale-while-revalidate=30`

### `api/fred.js`
- GET `/api/fred?series=BAMLH0A0HYM2,DFII10,...`
- Fetches FRED economic data server-side (CORS blocked from browser)
- Returns: `[{ id, observations: [{date, value}] }]`
- Cache-Control: `s-maxage=3600, stale-while-revalidate=600`

### `api/synthesis.js`
- POST `/api/synthesis` with body `{ granvilleData, macroData }`
- Calls **1min.ai** to generate AI paragraph via Claude
- **Model**: `claude-sonnet-4-6`
- **Format**: `{ type: "CHAT", model: "claude-sonnet-4-6", promptObject: { prompt, isMixed: false } }`
- **Endpoint**: `https://api.1min.ai/api/chat-with-ai` with header `API-KEY: <key>`
- Response path: `data.aiRecord.aiRecordDetail.resultObject[0]`
- In-memory cache: 20-min TTL, invalidated on signal state change (hash-based)

### CRITICAL: 1min.ai API format
`messages: [{role, content}]` format → **REJECTED** (PROMPT_OBJECT_VALIDATION_FAILED)
`promptObject: { prompt, isMixed: false }` format → **WORKS**

### `api/alma.js`
- GET — latest `intraday_posts` + `weekly_posts` + `market_data` rows + all rules from Supabase
- Evaluates the 16 rules with explicit per-rule_id JS (no eval); returns `{ intraday, weekly, market, activeRules }`
- `s-maxage=300`. Feeds AlmaPanel + AlmaLog (private dashboard only).

### `api/tradier.js` (vol surface)
- SPX options chains via Tradier (ORATS greeks): first 4 dailies + Fridays to 60d (max 12 expiries)
- ATM IV per expiry, forward IV `FIV=√((IV₂²T₂−IV₁²T₁)/(T₂−T₁))`, kink = >15% above neighbor interpolation, confirmed = spot IV ≥ 90% of forward. `s-maxage=120`.

### `api/vol.js` (vol complex — shared by Granville volatility signal + macro panel)
- Real CBOE indices via Tradier quotes: VIX1D, VIX9D, VIX, VIX3M
- TLT ~30d ATM IV (live MOVE proxy), USD/JPY via frankfurter.app (ECB daily, no key)
- Client cache: `src/lib/vol.js` `fetchVolComplex()` dedupes in-flight calls. `s-maxage=120`.

### `api/ingest-alma.py` (Python runtime — Alma post webhook)
- POST `{ html, subject }` with header `X-Ingest-Secret: <INGEST_SECRET>`
- Parser functions ported UNCHANGED from `Desktop/Alma Backtesting/alma_pipeline_final.py`
- classify by subject (weekly/week → weekly), date from `post-date` meta tag, Supabase upsert on date
- Gmail Apps Script fires this on new Alma emails. Returns `warnings` when key fields fail to extract → indicates a new vocabulary gap needing regex work.
- `requirements.txt` (repo root): beautifulsoup4

### Tradier notes
- Production key, `api.tradier.com`. Real indices work: SPX, VIX, VIX1D, VIX9D, VIX3M. NOT available: MOVE (symbol = Corvex Inc stock!), USDJPY, DXY — no forex.

## Dashboard Sections (in order)
1. **AI Synthesis** — indigo panel, claude-sonnet-4-6 via 1min.ai, updates on refresh
2. **Granville Composite** — Recharts half-circle gauge (0–100)
3. **7 Granville Signal Cards** — green/yellow/red
4. **Macro Conditions** — slate cards, descriptive only (not scored)
5. **Alma Centroid** — placeholder ("coming soon")
6. **Signal Log** — plain-English bullet log

## Granville Scoring System

### Signal Definitions (`src/lib/signals.js`)
| ID | Label | Numerator | Denominator | Notes |
|----|-------|-----------|-------------|-------|
| breadth | Breadth/Leadership | RSP | SPY | Double-weight (40/20/0), neutral band ±0.5% |
| defensive | Defensive Rotation | XLP | XLY | Inverted, ±0.5% |
| credit | Credit Confidence | HYG | LQD | ±0.5% |
| bellwether | Bellwether Semis | SOXX | SPY | ±0.5% |
| volatility | Volatility Proxy | VIXY | — | Absolute: ≤$17 bull, ≥$25 bear; inverted |
| riskAppetite | Risk Appetite | SPHB | SPLV | ±0.5% |
| transport | Transport/Economy | IYT | SPY | ±0.3% neutral band |

### Scoring Rules
- `MAX_RAW = 160` (6×20 + 40 for double-weight breadth)
- Each signal: Bull=20, Neutral=10, Bear=0 (breadth: Bull=40, Neutral=20, Bear=0)
- `compositeScore = round((rawTotal / 160) * 100)`
- **Divergence penalty**: SPY rising AND RSP/SPY falling → cap composite at 60
- `displayScore` always shown as /20 (normalized)

### Market Phases
- ≥67: Bull Phase 1/2/3 (based on delta)
- ≤33: Bear Phase 1/2/3
- 33–67: Transitional

## Macro Signals (`src/lib/macro.js`)
Fetches: `VIXY, VIXM, UUP, IWM, SPY` from Finnhub + FRED data

| Signal | Source | Notes |
|--------|--------|-------|
| Vol Level | VIXY | <15 Complacent, <20 Calm, <28 Elevated, ≥28 Fear |
| Vol Term Structure | VIXY/VIXM ratio | >1.02 Backwardation, <0.98 Contango |
| Vol Skew | VIXY Δ vs VIXM Δ | >1% diff = Front-loaded Fear |
| MOVE Index | Static tile | Manual check — Finnhub free tier blocks it |
| Dollar Strength | UUP | ±0.3% threshold |
| Small vs Large Cap | IWM/SPY | ±0.3% threshold |
| HY Spread | FRED: BAMLH0A0HYM2 | |
| Real Yield | FRED: DFII10 | |
| Inflation Fwd | FRED: T5YIE | |
| Breakeven | FRED: DGS10 − DFII10 | |

**Note**: Finnhub free tier blocks `^VIX`, `CBOE:VIX`. Use ETF proxies: VIXY ≈ VIX, VIXM ≈ VIX3M.

## Key Source Files
```
src/
  App.jsx                  # orchestrates fetches, renders all sections
  lib/
    finnhub.js             # prefetchQuotes() / getQuote() — client-side cache
    fred.js                # fetches FRED via /api/fred, computes spreads
    signals.js             # SIGNAL_DEFS, fetchAllSignals(), scoring logic
    macro.js               # fetchAllMacroSignals()
    synthesis.js           # fetchSynthesis() — POST to /api/synthesis
  components/
    ScoreGauge.jsx         # Recharts half-circle, divergence warning banner
    SignalCard.jsx         # green/yellow/red, "2× weight" badge for breadth
    MacroCard.jsx          # slate cards, dashed border for staticTile
    SynthesisPanel.jsx     # indigo panel, loading/error/paragraph states
    SignalLog.jsx          # plain-English bullet log, direction arrows
api/
  finnhub.js               # serverless — Finnhub proxy
  fred.js                  # serverless — FRED proxy
  synthesis.js             # serverless — 1min.ai proxy
local-api-server.mjs       # local dev only — runs api/* as HTTP server on :3001
```

## Data Flow
```
App.jsx
  └─ Promise.all([fetchAllSignals(), fetchAllMacroSignals()])
       ├─ fetchAllSignals()
       │    └─ prefetchQuotes([...all ETF symbols]) → /api/finnhub
       └─ fetchAllMacroSignals()
            ├─ prefetchQuotes([VIXY,VIXM,UUP,IWM,SPY]) → /api/finnhub
            └─ fetchFredSignals() → /api/fred
  └─ fetchSynthesis(granvilleData, macroData) → /api/synthesis (non-blocking)
```

## Known Limitations & Gotchas
- **Finnhub free tier**: No CBOE indices (`^VIX`), no MOVE index. Use ETF proxies.
- **FRED CORS**: Cannot call from browser. Must go through `/api/fred` serverless.
- **Yahoo Finance 30-min data**: Only 60 days of intraday available on free tier.
- **`vercel dev` on Windows**: Broken — Vite and Vercel fight over the same port. Use `local-api-server.mjs` instead.
- **1min.ai rate limits**: Synthesis is cached 20 min to reduce API calls.

## Planned Features
- **Alma Centroid**: Gmail → Apps Script → Google Sheet pipeline for intraday pivot levels

## Git / Deployment
- Repo: `https://github.com/jusjit/granville-market-dashboard`
- Branch: `main` (auto-deploys to Vercel)
- `.env` is gitignored — never commit API keys
