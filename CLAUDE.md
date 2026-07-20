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

**Planned**: `VITE_SHOW_GEO_REGIME=true`, private project only, same on/off pattern as
`VITE_SHOW_ALMA` — for the not-yet-shipped Geo Regime tab (see "Geo Regime Panel (WIP)" below).
Not set anywhere yet; the panel isn't wired into `App.jsx` so the flag would currently do nothing.

## Supabase (project "LalliChaths", https://oteatsbkdamvczdceion.supabase.co)
Tables: `intraday_posts` (Alma daily levels), `weekly_posts`, `market_data` (SPX/VIX OHLC + gaps), `rules` (12 rules, **schema v2** — see below), `dashboard_snapshots` (twice-daily Granville+macro), `synthesis_cache` (id=1, AI synthesis 2h cache), `vol_surface_snapshots` (2-hourly vol term structure for history slider), `vix_futures_snapshots` (4-hourly VX monthly futures prices), `fed_watch_snapshots` (4-hourly CME FedWatch probabilities).
- RLS enabled, no policies — only service role key reads/writes.
- `intraday_posts`/`weekly_posts`: unique constraint on `date`, identity ids (for webhook upserts).
- Original data migrated from SQLite (`Alma backtest rules/` folder, gitignored).
- **GOTCHA — raw SQL tables need explicit GRANTs**: tables created via Supabase SQL editor do NOT get PostgREST access automatically. Run `GRANT ALL ON TABLE <name> TO anon, authenticated, service_role;` after creation, or the API will return "permission denied". The Table Editor UI does this automatically; raw SQL does not.

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
- Calls **1min.ai** to generate the AI synthesis
- **Model**: `gemini-2.5-flash` (swapped from `claude-sonnet-4-6` 2026-07-17). Measured on THIS prompt: 929 credit vs Sonnet's 17,721 (**~19x cheaper**), same 11-13s latency, Minto structure held. Mirrors the aggregator's swap — see `api/aggregate-geo-regime.js` for the full model comparison (gpt-4o-mini rejected there for shallow output; no Claude Haiku on 1min.ai).
- Retry-once + 3s backoff, 30s per-attempt `AbortSignal.timeout` (gemini's longer calls widen the window for transient 1min.ai gateway 500s). `vercel.json` sets `api/synthesis.js` maxDuration 75 so the retry can actually finish.
- **Format**: `{ type: "CHAT", model: MODEL, promptObject: { prompt, isMixed: false } }`
- **Endpoint**: `https://api.1min.ai/api/chat-with-ai` with header `API-KEY: <key>`
- Response path: `data.aiRecord.aiRecordDetail.resultObject[0]`
- **Minto pyramid output**: prompt requires `Bottom line: …` / `Why:` bullets / `Session lean: …`. SynthesisPanel.jsx parses these into bold lead + bullet list + footer; falls back to plain paragraph if unstructured. Divergence warning forced in as a driver when active.
- Persistent Supabase cache (`synthesis_cache` id=1), 2h TTL + input-hash invalidation. ~4–6 1min.ai calls/day.
- Note: 1min.ai sometimes returns em-dashes as mojibake — cosmetic, from their API encoding.

### CRITICAL: 1min.ai API format
`messages: [{role, content}]` format → **REJECTED** (PROMPT_OBJECT_VALIDATION_FAILED)
`promptObject: { prompt, isMixed: false }` format → **WORKS**

### `api/alma.js`
- GET — latest `intraday_posts` + `weekly_posts` + `market_data` rows + all rules from Supabase
- Evaluates the 12 v2 rules with explicit per-`id` JS (no eval), returns them **ordered by rank** (strongest first); `{ intraday, weekly, market, activeRules, live, touchTimestamps }`
- **Live layer** (added 2026-07-17): fetches a real-time Tradier SPX/VIX quote each call. When the quote is genuinely from today (NY calendar date match via `trade_date`), its `open`/`high`/`low` supersede the stored `market_data` row for rule evaluation — so rules correctly reflect TODAY's open intraday, instead of waiting for the once-daily close-snapshot cron. `live: { isToday, updatedAt, spx: {...}, vix: {...}, gapFromCentroidPct, vixGapPct }`.
- **Touch timestamps**: when `live.isToday` and today's Alma post exists, fetches Tradier 15-min timesales bars for today and walks them to find the first bar overlapping each daily level's ±0.1% band → `touchTimestamps: { centroid, upside_pivot, downside_pivot, upside_target, downside_target }` (each an ISO-shaped string or null). Weekly levels never get a timestamp (checked against the whole week's range, not a single session).
- **GOTCHA — Tradier timesales `time` field is naive America/New_York wall-clock, NOT UTC** (e.g. `"2026-07-17T09:30:00"` = 9:30am ET exactly, no offset marker). Never parse it with `new Date(...)` on a UTC server — that silently mis-shifts it by 4-5h. Pass through as-is; format for display via string slicing (see `fmtEtTime` in `AlmaLog.jsx`).
- `s-maxage=120` (well under the 15-min client poll so a poll never gets stale-by-design data). Live layer is best-effort — any Tradier failure degrades to the stored EOD `market_data` row, never breaks the response.
- Feeds AlmaPanel + AlmaLog (private dashboard only).

### Rules schema v2 (migrated 2026-07-17; source of truth = `Alma backtest rules/alma_rules.json`)
- **Two independent tiers, do not conflate**: `reliability_tier` (VALIDATED/EMERGING/EXPLORATORY — does the stat replicate) and `placebo_status` (PASSED/FAILED/UNTESTED — does the level's *placement* carry information vs just proximity/geometry).
- **A rule is tradeable signal ONLY if `placebo_status='PASSED'`.** Exactly one qualifies: `dont_fade_rule`. Everything else is descriptive context (real numbers, but explained by geometry — e.g. weekly_pivot_touch 86.5% is information-free; prior-week hi/lo beats it).
- `actionable_as_signal` MUST equal `placebo_status='PASSED'` — enforced by a **Postgres CHECK constraint** (`rules_actionable_requires_placebo_passed`), so a violating write is rejected (error 23514) at the DB layer, not just in app code.
- Table columns: id, name, horizon, rank, reliability_tier, placebo_status, actionable_as_signal, condition, finding, stats (jsonb), interpretation, caveats. Recreate via `Alma backtest rules/rules_v2_schema.sql`.
- **Push rules with `Alma backtest rules/push_rules_v2.py`** (reads keys from `.env`, rules-only). NEVER use `migrate_to_supabase.py` for a rules update — it re-pushes posts from the stale SQLite snapshot and would clobber Gmail-ingested posts.
- Validate the JSON with `Alma backtest rules/validate_rules.py` (checks schema + the actionable invariant; reads utf-8-sig).
- AlmaPanel: green reserved for the one Signal rule; VALIDATED badge is grey (a green VALIDATED on an info-free rule was the v1 bug). Each rule shows Signal/Context badge + naive-null inline.
- **Panel layout (2026-07-17)**: `AlmaLiveCard` (live SPX/VIX reference) → Active Rules → Daily levels card → Weekly levels card, in that order — rules render directly underneath the live data they're evaluated against. `AlmaLiveCard` polls `/api/alma` on its own 15-min `setInterval` in `App.jsx`, independent of the manual Refresh button (cheap: Supabase + a couple Tradier calls, no LLM — unlike the rest of the dashboard which stays manual-only to control 1min.ai/Finnhub cost).
- `AlmaLog.jsx` prefers `live.spx.high/low` (updates continuously) over the once-daily `market_data` snapshot when `live.isToday`, and shows each daily HIT's exact ET timestamp from `touchTimestamps`; weekly hits show "time unknown (weekly)" rather than a fabricated time.
- LLM-facing companion: `Alma backtest rules/alma_rules_prompt.md` (leads with the usage gate). No LLM currently consumes the rules; if wired, use gemini-2.5-flash like synthesis.

### Vol surface (`api/tradier.js` live + `api/snapshot-vol.js` cron + `api/vol-history.js`)
- Compute shared in **`lib/volSurfaceCore.mjs`** (imported by both routes so they never diverge).
- SPX options via Tradier (ORATS greeks): first 4 dailies + Fridays to 60d (max 12 expiries).
- **CRITICAL — SPXW only**: every strike has TWO contracts, SPX (AM-settled) + SPXW (PM-settled). Original bug averaged both → erratic near-dated IV. Now filters to SPXW (SPX fallback).
- **ATM IV interpolated** between the two strikes bracketing spot (distance-weighted) — not nearest-strike snapping (which jumped when spot crossed a strike).
- Uses ORATS `mid_iv` (not last-trade). Per-expiry flags: `wideSpread` (ask_iv−bid_iv >3 vol pts), `lowConfidence` (outside RTH, wide spread, or >20% jump vs last snapshot). Rendered as dashed grey dots + tooltip reasons.
- Forward IV `FIV=√((IV₂²T₂−IV₁²T₁)/(T₂−T₁))`, kink >15% above neighbor interpolation, confirmed = spot IV ≥ 90% forward. `s-maxage=120`.
- **Event calendar (dynamic, replaces hardcoded 2026 array)**: `api/tradier.js` fetches events from three sources in parallel alongside the vol surface computation and returns them as an `events` array in the response. `annotateEvents()` (client-side, `src/lib/volsurface.js`) assigns events to the expiry window they fall in.
  - **FRED**: CPI (release_id=10) and NFP (release_id=50) via `fred/release/dates` — both confirmed returning correct dates. Uses existing `FRED_KEY`.
  - **Finnhub**: `/calendar/earnings` filtered to 20 SPX mega-caps (`EARNINGS_TICKERS` set: AAPL, MSFT, AMZN, GOOGL, META, NVDA, TSLA, etc.). Uses existing `FINNHUB_KEY`. Free tier returns ~1500 entries/month — ample coverage.
  - **FOMC**: hardcoded `FOMC_DATES` array in `api/tradier.js` — FRED has no clean release for FOMC decision days (release_id=21 is Minutes dates, release_id=101 is daily data). Fed publishes meeting schedule years ahead; update the array annually (2026 + 2027 dates included).
  - All three fetches are best-effort (`Promise.allSettled` via individual `.catch()`); if any source fails, the others still populate events. Events cached alongside the vol surface response (`s-maxage=120`).
- **History = OVERLAY, not replace**: `snapshot-vol.js` (Bearer SNAPSHOT_SECRET) writes `vol_surface_snapshots` every 2h RTH via `.github/workflows/vol-snapshot.yml`; `vol-history.js` lists recent snapshots. VolSurfacePanel "Compare snapshot" toggle keeps the LIVE curve and draws a chosen past snapshot's spot IV as a ghosted dashed line (merged by expiration; rolled-off expiries show on one series only; tooltip shows Δ). Slider appears only with ≥2 snapshots. ⚠️ DST: bump vol-snapshot crons +1h UTC after Nov 1 2026.
  - GOTCHA: snapshots seeded while market is closed are byte-identical (Tradier returns the last session), so scrubbing shows no change — distinct history needs the cron running during live RTH.

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

### `api/snapshot.js` (twice-daily snapshots)
- GET `?type=premarket|close`, auth `Authorization: Bearer <SNAPSHOT_SECRET>`
- Recomputes Granville+macro server-side, upserts `dashboard_snapshots` on (date,snapshot_time)
- On close: upserts SPX/VIX OHLC+gaps into `market_data` — GUARDED by Tradier trade_date == today (NY) so closed-market runs can't write stale data
- Trigger: `.github/workflows/dashboard-snapshot.yml` — 13:25/21:05 UTC weekdays (9:25am/5:05pm EDT). ⚠️ DST: after Nov 1 2026 change crons to 14:25/22:05 UTC. GH repo secret: SNAPSHOT_SECRET.

### `api/reference.js` (VX futures + CME FedWatch snapshots — Reference Data panel)
- POST `/api/reference` — auth `Bearer SNAPSHOT_SECRET`, captures VX futures + FedWatch; called by `.github/workflows/reference-snapshot.yml` at 13:25/21:05 UTC weekdays.
- GET `/api/reference?limit=N` — returns merged snapshot history from `vix_futures_snapshots` + `fed_watch_snapshots` (default 40, max 100).
- **VX futures** — scraped from `https://vixcentral.com/` (FastAPI SSR; CBOE delayed data). The page embeds prices as JS variables confirmed via browser DevTools inspection:
  - `var mx = ['Jul','Aug','Sep',...]` — contract month labels (single-quoted, confirmed format)
  - `var vcurve_data_var = [...]` — live/last traded prices (empty pre-open and weekends)
  - `var previous_close_var = [18.80, 19.30, ...]` — previous settlement (always populated)
  - Uses live prices if ≥4 non-zero, otherwise falls back to prev close. No Tradier needed.
  - **GOTCHA — CORS blocks fetch from browser JS.** vixcentral.com CORS-blocks XHR/fetch from other origins; the data is not available from the client side. It must be fetched server-side (Vercel function). CBOE CDN endpoints (`cdn.cboe.com`) also block non-browser fetches. The vixcentral SSR HTML scrape is the only confirmed working approach.
  - vixcentral.com has a public OpenAPI spec at `/openapi.json`. The `/ajax_update` route is just a keepalive ("hello"); `/ajax_historical?n1=YYYY-MM-DD` returns historical comparison data. Current prices come only from the initial SSR HTML.
- **CME FedWatch** — Yahoo Finance ZQ futures (30-day Fed Funds, CBOT). `ZQ{code}{yr}.CBT` e.g. `ZQQ26.CBT`. Price 96.335 → implied rate = 100 − 96.335 = 3.665%. Linear interpolation across ±2×25bp outcomes from current FRED target range (DFEDTARL/DFEDTARU). FOMC calendar hardcoded in `FOMC_2026` array (update each year).
- `s-maxage=120` on GET; no cache on POST.
- **middleware.js**: both `/api/reference` and `/api/vol-history` are in `OPEN_PATHS` (added after cron exit-code-22 failures — any new cron endpoint must be added here or the private project's Edge middleware will 401 it before the function runs).

### `api/login.js` + `middleware.js` (private dashboard password gate)
- Edge middleware at repo root; enforces ONLY when `DASHBOARD_PASSWORD` env is set (private project). Public project unaffected.
- Cookie `dashboard_auth` = SHA-256(password), 30 days. Login page: `/login` (LoginGate.jsx in the SPA).
- Excluded paths: /login, /api/login, /api/snapshot, /api/vol-history, /api/reference, /api/aggregate-geo-regime, /api/ingest-alma (own secrets), /assets, favicon.
- **CRITICAL**: any new cron-triggered endpoint must be added to `OPEN_PATHS` in `middleware.js` or it will silently 401 on the private project. Public project has no middleware — only the private one is affected.

### Gmail Apps Script ("Alma Email Ingester")
- `checkForNewAlmaPosts` polls every 15 min (time-driven trigger — verify it exists in Triggers panel!)
- Searches `from:stochvoltrader+market-analysis@substack.com -label:alma-processed newer_than:7d`
- Labels thread only on HTTP 200; failures retry next cycle. Errors visible in Executions log.

### Tradier notes
- Production key, `api.tradier.com`. Real indices work: SPX, VIX, VIX1D, VIX9D, VIX3M. NOT available: MOVE (symbol = Corvex Inc stock!), USDJPY, DXY — no forex.

## Dashboard Sections (in order)
1. **AI Synthesis** — indigo panel, gemini-2.5-flash via 1min.ai, updates on refresh
2. **Granville Composite** — Recharts half-circle gauge (0–100)
3. **7 Granville Signal Cards** — green/yellow/red
4. **Granville Signal Log** — plain-English bullet log
5. **Macro Conditions** — slate cards, descriptive only (not scored)
6. **Vol Surface** — SPX term structure, Tradier/ORATS options data
7. **VIX Futures & Fed Rate %** — collapsible; VX monthly futures (vixcentral/CBOE delayed) + CME FedWatch (ZQ futures/FRED). Snapshot slider for historical comparison. Populated by 4-hourly cron.
8. **Alma Centroid** — private dashboard only (`VITE_SHOW_ALMA=true`)
9. **Geo Regime** — PLANNED, private dashboard only. See "Geo Regime Panel (WIP)" below.

## Vercel Function Count (Hobby plan limit: 12)
Current count: **11 JS + 1 Python = 12 total** (at the limit).
- JS: `finnhub`, `fred`, `synthesis`, `alma`, `tradier`, `vol`, `vol-history`, `snapshot`, `login`, `reference`, `aggregate-geo-regime`
- Python: `ingest-alma` (counts as a function; `requirements.txt` triggers Python runtime)
- **Do not add new function files without deleting/merging an existing one.** The Python file counts even though it has a `.py` extension. Merging two JS handlers into one file (GET + POST on same route) is the standard approach to stay under the limit.

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
    referencedata.js       # fetchReferenceLatest() (latest snapshot for panel),
                           # fetchReferenceHistory(limit) (history for slider)
  components/
    ScoreGauge.jsx         # Recharts half-circle, divergence warning banner
    SignalCard.jsx         # green/yellow/red, "2× weight" badge for breadth
    MacroCard.jsx          # slate cards, dashed border for staticTile
    SynthesisPanel.jsx     # indigo panel, loading/error/paragraph states
    SignalLog.jsx          # plain-English bullet log, direction arrows
    ReferenceDataPanel.jsx # collapsible VX futures + FedWatch charts + snapshot slider
api/
  finnhub.js               # serverless — Finnhub proxy
  fred.js                  # serverless — FRED proxy
  synthesis.js             # serverless — 1min.ai proxy
  reference.js             # GET history + POST snapshot (VX futures + FedWatch)
  vol-history.js           # GET vol snapshots + POST vol snapshot (merged handler)
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

### `api/aggregate-geo-regime.js` (Ben Kim Geo Monitor aggregator)
- GET/POST, auth `Authorization: Bearer <SNAPSHOT_SECRET>`
- Pulls geopolitical signals from worldmonitor.app public API (Hormuz tracker,
  chokepoint status, shipping stress, theater posture, CII — all 31 Tier-1 countries,
  cross-source convergence signals, UCDP reduced to top-25 country event/death counts)
  + FRED (HY OAS, USD/JPY, WTI spot, VIX as market-pricing cross-checks). Upstream
  `list-market-implications`/`get-regime-history` are Pro-gated (401) — not usable.
- **worldmonitor API auth**: needs browser User-Agent (Cloudflare 403 otherwise) and a
  `wms_` session token from `POST /api/wm-session` sent as `X-WorldMonitor-Key` for
  `/v1` gateway endpoints (401 otherwise)
- Calls 1min.ai claude-sonnet-4-6 with an edge-detector prompt (flag >30% unpriced
  risks); strict-JSON verdict. No API-level prompt-caching lever exists in 1min.ai's
  `promptObject` schema (single flat `prompt` string, no `cache_control`/system
  field) — checked 2026-07-12, ruled out.
- flagged=true → upsert `geopolitical_signals` (history trigger appends transitions);
  `current_regime` VIEW is what the dashboard will eventually read as a gate/weight
  on Granville timing rules (never an entry signal). Cross-repo wiring is a future step.
- EVERY run (skipped, gated, or full-scan) inserts a labeled row into `geo_regime_runs`
  (verdict jsonb + `categories_considered` + `categories_dismissed_reason` +
  `run_type` + `diff` + `token_usage` per category) for later analysis of what
  precedes real market moves. Insert is best-effort — failure surfaces as
  `runRecordError`, never drops the verdict.
- **Private-project gotcha**: middleware.js password gate 401s any /api path not in
  OPEN_PATHS *before* the function runs — new cron endpoints must be allowlisted
  there (aggregate-geo-regime was added 2026-07-11 after the cron failed with 401).

#### Diff-gate (added 2026-07-12 — cost reduction, no signal tracking removed)
Three run modes, tagged via `geo_regime_runs.run_type`:
- **gated-skip**: fresh pull compared against `geo_regime_last_snapshot` (raw +
  bucketed state from the last run — NOT synthesis output, cheap Supabase-only
  comparison, no LLM). If nothing crossed a material-change threshold, the LLM
  is skipped entirely — **0 tokens** — and a lightweight run row is still logged.
- **gated-triggered**: something changed → calls the LLM with a delta prompt:
  chokepoints (+ hormuz) always sent in full (core to the trading thesis — this
  was the "adjust if there's a better rule" default, kept as-is after review);
  every other category sent in full ONLY if it appears in the diff, otherwise a
  compact bucketed summary line. This is the routine `geo-regime-aggregator.yml`
  cron (every 4h, unchanged schedule).
- **full-scan**: always the complete dataset regardless of diff. New
  `geo-regime-full-scan.yml` cron, 2x/day (13:25/21:05 UTC weekdays, matches
  `dashboard-snapshot.yml` cadence) — `?scan=full`. Preserves full
  `categories_considered`/`categories_dismissed_reason` coverage periodically
  even though routine runs now only re-examine what moved.
- `?force=1` bypasses the gate but stays in gated-triggered (delta) mode — for
  manually testing the routine path without waiting for a real change.
- Threshold constants live in `THRESHOLDS` at the top of the file (chokepoint
  disruption score, CII points, UCDP event/death counts, FRED move sizes,
  etc.) — tunable, flagged as such in the code.
- **Real measured token usage** (2026-07-12, claude-sonnet-4-6 via 1min.ai,
  from `aiRecord.metadata` — not estimated): full-scan ≈ 20.8K input / 23.2K
  total tokens per call. Gated-triggered with only 1 of 11 categories changed
  ≈ 9.4-10.4K input / 11-12.4K total tokens (~50% below full-scan even when
  something DID change, because unchanged categories are summarized not
  resent). Gated-skip = 0 tokens by construction — the code returns before
  `callOneMin` is ever invoked. At 6x/day on the 4h cron, if most runs skip or
  hit small deltas, real daily usage drops sharply from the pre-diff-gate
  baseline of ~13K tokens × 6 calls region into far fewer full-payload calls.
  Exact savings depend on how often the tracked signals actually move —
  reviewable later via `run_type`/`token_usage` in `geo_regime_runs`.
- **Bug caught during verification**: `gatherSignals()`'s keys don't match
  `computeMaterialState()`'s keys 1:1 (`shippingStress` vs `shipping`,
  `theaterPosture` vs `posture`, `riskScores` vs `cii`, `crossSourceSignals`
  vs `crossSource`, `ucdpSummary` vs `ucdp`, `wtiSpot` vs `wti`). The delta
  prompt builder originally checked changed-category membership using the
  wrong key namespace, silently summarizing those 6 categories even when they
  materially changed. Fixed via an explicit `SIGNAL_TO_MATERIAL_KEY` map;
  verified by asserting `JSON.stringify(fullPayload).length ===
  JSON.stringify(signals).length` when every category is flagged changed.
  Watch for this class of bug if either object's key set changes again.

#### Diff-gate tuning (2026-07-14 — the gate was never actually skipping)
A diagnostic pass on the first 18 real production cron runs found **0
gated-skip runs** — posture fired on 93% of cycles, crossSource 86%, cii 71%,
effectively defeating the gate for most of the day. Root causes, confirmed
live (not just theorized) before fixing:
- Pulled `get-theater-posture` twice, 4 minutes apart, no code changes, no
  real event: `south-china-sea.activeFlights` moved 3→1 — under the OLD
  5-count bucket that alone crosses a bucket boundary. Upstream counts are
  genuinely noisy at single-digit scale on a multi-minute cadence; a 4h cron
  will accumulate enough drift to trip a tight bucket almost every cycle.
- `crossSourceSignals[].id` is compound (`"risk:ua"`, `"gpsjam:western-europe"`).
  The old keyOf (text before the first colon) collapsed different countries
  under the same category into one "entity," so a top-ranked-country rotation
  (`risk:ua` → `risk:ru` — a different real signal) looked like one entity
  changing value every cycle.

Fixes (in `THRESHOLDS`, `HYSTERESIS_CATEGORIES`, `resolveGatedDiff()`,
`CROSS_SOURCE_KEY_OF`):
- `theaterActiveFlights` 5→15, `ciiCombinedScore` 10→20 (widened).
- posture + cii additionally get **two-poll hysteresis**: a deviation is only
  promoted to "material" once the SAME value is observed on two consecutive
  4h cycles. `geo_regime_last_snapshot.pending` holds the not-yet-confirmed
  candidate between runs (new column, migration
  `supabase_geo_regime_hysteresis.sql`). Nothing else got hysteresis —
  chokepoints/shipping/ucdp/hormuz/FRED proved stable in the same data and
  don't need the extra 4h detection delay.
- crossSource keyOf fixed to keep the full compound id intact (`CROSS_SOURCE_KEY_OF`).
- full-scan mode bypasses hysteresis entirely — always promotes/resets the
  confirmed baseline across every category, consistent with its "always
  complete dataset" contract.
- Unit-verified (4 synthetic scenarios: single-poll noise suppressed,
  revert-before-confirm clears the pending candidate, sustained 2-poll
  change promotes with a clean delta, non-hysteresis categories unaffected)
  before any live call. First live run post-deploy: posture matched the
  confirmed baseline exactly (no deviation at all); cii deviated but was
  correctly held as `pending` rather than promoted — visible directly in
  `geo_regime_last_snapshot.pending`. Tokens on that run: 11.2K input / 13.1K
  total, already below the typical pre-fix 14-17K.
- Review `run_type` counts in `geo_regime_runs` after a few more days to
  confirm gated-skip actually starts appearing at a reasonable rate; if
  posture/cii still fire most cycles, the next lever is widening further or
  extending hysteresis to more categories — not reflexively, only where
  production data shows real noise (same discipline as this pass).

### Geo Regime Panel (WIP — scaffolded 2026-07-11, NOT shipped)

This will eventually be dashboard section 7, **private project only** (same
`VITE_SHOW_*` pattern as Alma) — a tab surfacing the regime state the aggregator
above writes to Supabase. Currently in the **data-validation phase**: watching the
aggregator's real output for a while before finishing the UI. Do not assume this
tab exists in the deployed app — it does not.

**Status**: scaffolded on local branch `wip/geo-regime-panel` (based on `main`,
not merged, not pushed to origin — exists only in this local clone until someone
decides to finish it). `main` / deployed `git log` will NOT show these files.

**What's there** (on that branch):
- `api/geo-regime.js` — read-only endpoint, same service-role Supabase pattern as
  `api/alma.js`. Reads `current_regime`, all `geopolitical_signals`, and the 20
  most recent `geo_regime_runs`. Tested against live data.
- `src/lib/georegime.js` — client fetch wrapper mirroring `lib/alma.js`.
- `src/components/GeoRegimePanel.jsx` — draft component styled after `AlmaPanel.jsx`.

**Confirmed NOT wired**: nothing on `main` imports any of the three files above;
`App.jsx` has no `GeoRegimePanel`/`fetchGeoRegime` reference. Re-verify with
`grep -rln "GeoRegimePanel\|fetchGeoRegime" src/App.jsx` before assuming otherwise —
this note will go stale the moment someone starts wiring it in.

**Still to decide before shipping** (TODOs live inline in the component too):
1. Field selection — `geopolitical_signals.notes` is often 1000+ chars of LLM
   prose; `categories_dismissed_reason` (arguably the most useful part — a
   labeled reason for every non-flagged category, every run) isn't surfaced at
   all yet, just a count of the latest run's `categories_considered`.
2. Fetch cadence — regime updates ~every 4h via cron; don't refetch on every
   `App.jsx` `refresh()` the way Alma/synthesis do (wasted requests against
   data that hasn't changed).
3. Layout/styling — severity color thresholds are a first guess, untuned.
4. Wiring — add `VITE_SHOW_GEO_REGIME` env flag, add state/effects in `App.jsx`
   mirroring `almaData`/`almaLoading`/`almaError`, decide render position
   relative to Alma/Vol Surface panels.

To resume: `git checkout wip/geo-regime-panel` (or cherry-pick the 3 files onto
a fresh branch off current `main`, since `main` will have moved on).
- Cron: `.github/workflows/geo-regime-aggregator.yml` — every 4h + workflow_dispatch,
  reuses the `SNAPSHOT_SECRET` GitHub secret
- Supabase schema/grants SQL: `../geo-monitor-scaffold/*.sql` (all applied, incl. geo_regime_runs 2026-07-11)
- Related: worldmonitor clone at `../worldmonitor` (branch `geo-variant`) has the
  personal `geo` dashboard variant (`npm run dev:geo`); its Market Implications panel
  reads `geopolitical_signals` via anon key in its `.env.local`

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
