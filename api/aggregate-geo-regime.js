// /api/aggregate-geo-regime — Ben Kim Geo Monitor aggregator
//
// Pulls geopolitical signal data from World Monitor's public API
// (https://github.com/koala73/worldmonitor, AGPL-3.0 — data attribution to
// worldmonitor.app and its upstream providers: PortWatch, ACLED/UCDP, OpenSky,
// EIA), adds FRED macro/market-pricing series, and asks Claude (via 1min.ai,
// same integration pattern as api/synthesis.js) whether an unpriced
// geo-to-markets risk should be flagged. Flagged risks are upserted into the
// Supabase `geopolitical_signals` table; the `log_signal_change` trigger
// appends to `geopolitical_signal_history`, and `current_regime` (a VIEW —
// it never needs an explicit update) recomputes automatically on read.
//
// ── FUTURE CROSS-REPO INTEGRATION (not built yet) ──────────────────────────
// The Granville dashboard will eventually read the `current_regime` view
// (single row: oil_shock_risk / carry_unwind_pressure / drawdown_severity /
// safe_haven_bid severities, 0-100) from the same Supabase project and apply
// each active signal's `granville_modifier` jsonb (position_size_cap,
// alma_reversion_confidence, rule confidence multipliers) as a GATE/WEIGHT on
// Granville timing rules. Geopolitics is never an entry signal itself — a
// flagged regime only caps size or scales confidence on signals the technical
// system already generated. Wiring that consumer lives in the dashboard
// frontend/api and is a separate future step (WIP scaffold on branch
// wip/geo-regime-panel — see CLAUDE.md).
// ────────────────────────────────────────────────────────────────────────────
//
// ── THREE RUN MODES (added 2026-07-12 — diff-gate cost reduction) ──────────
// 1. gated-skip:      material state unchanged since last snapshot -> NO LLM
//                      call. Cheap Supabase read/write only. Logged so the
//                      run history still shows the cron fired.
// 2. gated-triggered: material state changed -> LLM call, but the prompt
//                      sends deltas + chokepoints-always-full + only the
//                      categories that changed, not the full 31-country/
//                      all-category payload. Routine 4h cron uses this mode.
// 3. full-scan:        always calls the LLM with the COMPLETE dataset,
//                      regardless of whether anything changed. Runs 1-2x/day
//                      (see geo-regime-full-scan.yml) so categories_considered/
//                      categories_dismissed_reason periodically covers
//                      everything, not just what moved.
// `?force=1` forces mode 2 (gated-triggered) even with no material change —
// for manual testing of the routine path. `?scan=full` forces mode 3.
// ────────────────────────────────────────────────────────────────────────────
//
// Auth: Authorization: Bearer <SNAPSHOT_SECRET> (same secret as api/snapshot.js,
// already present in Vercel env + GitHub Actions secrets — nothing new to add).
// Triggers: geo-regime-aggregator.yml (every 4h, gated) and
// geo-regime-full-scan.yml (1-2x/day, always full).

const WM_BASE = process.env.WORLDMONITOR_API_BASE || 'https://www.worldmonitor.app'

const RISK_TO_IMPLICATION = [
  [/oil|energy|hormuz|tanker|lng/i, 'oil_shock_risk'],
  [/carry|yen|boj|jpy/i, 'carry_unwind'],
  [/equity|drawdown|taiwan|conflict/i, 'equity_drawdown_severity'],
  [/haven|gold|flight.to.quality/i, 'safe_haven_bid'],
  [/freight|shipping|chokepoint|suez|red sea|mandeb/i, 'freight_cost_shock'],
]

// World Monitor requires (a) a browser-like User-Agent to pass Cloudflare and
// (b) an anonymous wms_ session token (HMAC-signed, freely mintable via POST
// /api/wm-session, 12h TTL) for the /v1 gateway endpoints. Verified 2026-07:
// bare curl → 403 Cloudflare; UA only → 401 "API key required"; UA + token → 200.
const WM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'

async function mintWmSession() {
  const r = await fetch(`${WM_BASE}/api/wm-session`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': WM_UA, Origin: WM_BASE },
  })
  if (!r.ok) throw new Error(`wm-session mint -> ${r.status}`)
  const setCookie = r.headers.get('set-cookie') || ''
  const m = setCookie.match(/wm-session=([^;]+)/)
  if (!m) throw new Error('wm-session mint: no token cookie in response')
  return decodeURIComponent(m[1])
}

async function fetchJson(url, timeoutMs = 15000, wmToken = null) {
  const headers = { Accept: 'application/json', 'User-Agent': WM_UA }
  if (wmToken) headers['X-WorldMonitor-Key'] = wmToken
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers })
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.json()
}

async function fredSeries(id, key) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=5`
  const data = await fetchJson(url, 15000, null)
  const obs = (data.observations ?? []).filter(o => o.value !== '.')
  return obs.map(o => ({ date: o.date, value: Number(o.value) }))
}

// Gather every input; individual source failures degrade rather than abort.
async function gatherSignals() {
  const fredKey = process.env.FRED_KEY
  let wmToken = null
  try { wmToken = await mintWmSession() } catch { /* v1 endpoints will 401 and degrade */ }
  const tasks = {
    hormuz: fetchJson(`${WM_BASE}/api/supply-chain/hormuz-tracker`), // hand-written endpoint, no token needed
    chokepoints: fetchJson(`${WM_BASE}/api/supply-chain/v1/get-chokepoint-status`, 15000, wmToken),
    shippingStress: fetchJson(`${WM_BASE}/api/supply-chain/v1/get-shipping-stress`, 15000, wmToken),
    theaterPosture: fetchJson(`${WM_BASE}/api/military/v1/get-theater-posture`, 15000, wmToken),
    riskScores: fetchJson(`${WM_BASE}/api/intelligence/v1/get-risk-scores`, 15000, wmToken),
    // Broad scan (added 2026-07): cross-stream convergence signals and a
    // compact UCDP conflict summary across ALL countries, so the LLM sees
    // beyond the chokepoint/Taiwan core. get-risk-scores above already returns
    // every Tier-1 country. (list-market-implications and get-regime-history
    // are Pro-gated upstream — verified 401, not usable.)
    crossSourceSignals: fetchJson(`${WM_BASE}/api/intelligence/v1/list-cross-source-signals`, 15000, wmToken),
    ucdpSummary: fetchJson(`${WM_BASE}/api/conflict/v1/list-ucdp-events`, 20000, wmToken)
      .then(d => {
        // Raw feed is 100KB+; reduce to per-country event/death counts.
        const byCountry = {}
        for (const e of d?.events ?? []) {
          const c = e.country ?? 'unknown'
          byCountry[c] = byCountry[c] ?? { events: 0, deaths: 0 }
          byCountry[c].events += 1
          byCountry[c].deaths += Number(e.deathsBest ?? 0)
        }
        return Object.entries(byCountry)
          .sort((a, b) => b[1].deaths - a[1].deaths)
          .slice(0, 25)
          .map(([country, v]) => ({ country, ...v }))
      }),
    // FRED: macro stress inputs + the market-pricing cross-checks the prompt
    // requires (spot oil, SPX IV proxy, yen) so the model can verify what is
    // already priced BEFORE flagging.
    hyOas: fredKey ? fredSeries('BAMLH0A0HYM2', fredKey) : Promise.resolve(null), // HY credit spreads
    yen: fredKey ? fredSeries('DEXJPUS', fredKey) : Promise.resolve(null),        // USD/JPY fixings
    wtiSpot: fredKey ? fredSeries('DCOILWTICO', fredKey) : Promise.resolve(null), // spot oil cross-check
    vix: fredKey ? fredSeries('VIXCLS', fredKey) : Promise.resolve(null),         // SPX IV cross-check
  }
  const keys = Object.keys(tasks)
  const settled = await Promise.allSettled(Object.values(tasks))
  const signals = {}
  const errors = []
  keys.forEach((k, i) => {
    if (settled[i].status === 'fulfilled') signals[k] = settled[i].value
    else { signals[k] = null; errors.push(`${k}: ${settled[i].reason?.message ?? 'failed'}`) }
  })
  return { signals, errors }
}

// ── Diff-gate thresholds ────────────────────────────────────────────────────
// TUNABLE CONSTANTS — adjust these as you calibrate the aggregator against
// real state changes. Values are bucket sizes: a move smaller than the
// bucket is treated as noise, not a material change. Chokepoint status and
// cross-source signal id/severity are compared as exact strings (any change
// is material — no numeric threshold makes sense there).
const THRESHOLDS = {
  chokepointDisruptionScore: 10, // points (0-100 scale)
  // ciiCombinedScore + theaterActiveFlights widened 2026-07-14 after a
  // diagnostic pass on 18 real production cron runs showed posture (93%)
  // and cii (71%) firing on almost every cycle — a live A/B pull of
  // get-theater-posture 4 minutes apart (no real event) showed
  // south-china-sea activeFlights swing 3->1, which the OLD 5-count bucket
  // alone would have registered as material. Widened AND given hysteresis
  // (see HYSTERESIS_CATEGORIES below) as a belt-and-suspenders fix.
  ciiCombinedScore: 20,          // points — was 10; CN 57.4↔57.6-style jitter persisted even at 10
  ucdpEventCount: 25,            // per-country event count
  ucdpDeathCount: 50,            // per-country death count
  shippingChangePct: 2,          // carrier % change points
  theaterActiveFlights: 15,      // count — was 5; single-digit counts jitter within minutes
  hyOas: 0.25,                   // percentage points
  yen: 2,                        // USD/JPY
  wti: 2,                        // USD per barrel
  vix: 1,                        // VIX points
}

// Categories that require the SAME deviation to be observed on two
// consecutive polls before counting as material (added 2026-07-14).
// Rationale: even after widening THRESHOLDS above, posture/cii are the two
// categories whose underlying upstream values are demonstrably noisy at
// sub-cycle timescales (see comment above) — a single-poll threshold alone
// can't fully distinguish "real, sustained move" from "telemetry jitter that
// happens to cross a bucket boundary." Every other category (chokepoints,
// shipping, ucdp, crossSource, hormuz, FRED series) proved stable in the
// same production data and does NOT get this treatment — don't add it
// reflexively; each addition here delays real-change detection by up to one
// extra cron interval (4h), which is only worth it where noise has been
// directly observed.
const HYSTERESIS_CATEGORIES = new Set(['posture', 'cii'])

const round = (v, step) => (v == null ? null : Math.round(v / step) * step)
const latest = arr => (Array.isArray(arr) && arr[0] ? arr[0].value : null)

// Bucketed "material state" — the same categories the old dedupe hash used,
// now kept as a structured object (not pre-stringified) so it can both hash
// AND diff field-by-field against the last snapshot. Field names verified
// against live worldmonitor.app responses (2026-07): chokepoints[].{id,status,
// disruptionScore}, theaters[].{theater,postureLevel,activeFlights},
// ciiScores[].{region,combinedScore,trend}.
function computeMaterialState(s) {
  return {
    hormuz: s.hormuz?.status ?? null,
    chokepoints: (s.chokepoints?.chokepoints ?? [])
      .filter(c => ['hormuz_strait', 'bab_el_mandeb', 'suez', 'taiwan_strait'].includes(c.id))
      .map(c => `${c.id}:${c.status ?? ''}:${round(Number(c.disruptionScore ?? 0), THRESHOLDS.chokepointDisruptionScore)}`).sort(),
    shipping: (s.shippingStress?.carriers ?? [])
      .map(c => `${c.symbol}:${round(Number(c.changePct ?? 0), THRESHOLDS.shippingChangePct)}`).sort(),
    posture: (s.theaterPosture?.theaters ?? [])
      .map(t => `${t.theater}:${t.postureLevel ?? ''}:${round(Number(t.activeFlights ?? 0), THRESHOLDS.theaterActiveFlights)}`).sort(),
    cii: (s.riskScores?.ciiScores ?? [])
      .filter(c => ['TW', 'CN', 'IR', 'IL', 'JP', 'SA', 'YE', 'EG', 'RU', 'UA'].includes(c.region))
      .map(c => `${c.region}:${round(Number(c.combinedScore ?? 0), THRESHOLDS.ciiCombinedScore)}`).sort(),
    // crossSourceSignals[].id is itself compound (e.g. "risk:ua",
    // "gpsjam:western-europe") — diffListField's default keyOf (text before
    // the FIRST colon) would collapse "risk:ua" and "risk:ru" into the same
    // key, making a top-ranked-country ROTATION (different real entity) look
    // like one entity's value changing. Caught during the 2026-07-14
    // diagnostic pass (crossSource fired on 86% of cron runs). Fixed via a
    // custom keyOf in diffListField (see CROSS_SOURCE_KEY_OF below) that
    // keeps the full id intact.
    crossSource: (s.crossSourceSignals?.signals ?? [])
      .map(x => `${x.id}:${x.severity ?? ''}`).sort(),
    ucdp: (Array.isArray(s.ucdpSummary) ? s.ucdpSummary : [])
      .map(u => `${u.country}:${round(u.events, THRESHOLDS.ucdpEventCount)}:${round(u.deaths, THRESHOLDS.ucdpDeathCount)}`).sort(),
    hyOas: round(latest(s.hyOas), THRESHOLDS.hyOas),
    yen: round(latest(s.yen), THRESHOLDS.yen),
    wti: round(latest(s.wtiSpot), THRESHOLDS.wti),
    vix: round(latest(s.vix), THRESHOLDS.vix),
  }
}

// List-field entries are "key:...rest" strings (e.g. "hormuz_strait:red:70").
// Diff by key so a bucket change reads as one clean "id: old -> new" delta
// instead of an opaque add/remove pair. Default keyOf (text before the
// FIRST colon) is correct for flat single-token ids (chokepoints, cii,
// shipping, ucdp, posture). crossSource needs a custom keyOf — see below.
function diffListField(prevArr = [], currArr = [], keyOf = s => s.split(':')[0]) {
  const prevMap = new Map(prevArr.map(s => [keyOf(s), s]))
  const currMap = new Map(currArr.map(s => [keyOf(s), s]))
  const deltas = []
  for (const [k, currVal] of currMap) {
    const prevVal = prevMap.get(k)
    if (prevVal !== currVal) deltas.push({ key: k, from: prevVal ?? null, to: currVal })
  }
  for (const [k, prevVal] of prevMap) {
    if (!currMap.has(k)) deltas.push({ key: k, from: prevVal, to: null })
  }
  return deltas
}

// crossSource entries are "<id>:<severity>" where <id> can itself contain a
// colon (e.g. "risk:ua"). Severity values (CROSS_SOURCE_SIGNAL_SEVERITY_*)
// never contain a colon, so "drop the last colon-segment" correctly
// recovers the full id as the key — unlike the default keyOf, which would
// truncate "risk:ua" down to just "risk".
const CROSS_SOURCE_KEY_OF = s => s.split(':').slice(0, -1).join(':')

const LIST_FIELD_KEY_OF = {
  crossSource: CROSS_SOURCE_KEY_OF,
}

// Returns { changed, deltas } where deltas is { <category>: delta[] | {from,to} }.
// prev === null (first-ever run, no snapshot yet) treats everything as new —
// natural bootstrap: first run always triggers, same as a bare full-scan.
function diffMaterialStates(prev, curr) {
  const deltas = {}
  let changed = false
  for (const key of Object.keys(curr)) {
    if (Array.isArray(curr[key])) {
      const d = diffListField(prev?.[key] ?? [], curr[key], LIST_FIELD_KEY_OF[key])
      if (d.length) { deltas[key] = d; changed = true }
    } else {
      const p = prev ? (prev[key] ?? null) : null
      if (p !== curr[key]) { deltas[key] = { from: p, to: curr[key] }; changed = true }
    }
  }
  return { changed, deltas }
}

// Deep-equal check for a single category's material value (string array or
// scalar) — used by the hysteresis resolver to test "did the SAME candidate
// value repeat on the next poll".
function materialValueEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  }
  return (a ?? null) === (b ?? null)
}

// Two-poll hysteresis for HYSTERESIS_CATEGORIES (posture, cii): a category's
// change is only promoted to "material" once the SAME fresh value has been
// observed on two consecutive runs. `confirmed` is the last promoted
// baseline (what the LLM has already seen); `pending` is the not-yet-
// confirmed candidate from the previous run (null if there wasn't one).
//
// Returns { changed, deltas, nextConfirmed, nextPending, pendingCategories }
// — nextConfirmed/nextPending are full material-shaped objects to persist;
// pendingCategories lists categories currently awaiting a second poll
// (surfaced in gated-skip run records for visibility, not just silence).
function resolveGatedDiff(confirmed, pending, fresh) {
  const immediate = diffMaterialStates(confirmed, fresh)
  const deltas = {}
  let changed = false
  const nextConfirmed = { ...fresh }
  const nextPending = {}
  const pendingCategories = []

  for (const key of Object.keys(fresh)) {
    if (!HYSTERESIS_CATEGORIES.has(key)) {
      // Non-hysteresis category: immediate comparison, unchanged behavior.
      if (immediate.deltas[key]) { deltas[key] = immediate.deltas[key]; changed = true }
      continue
    }
    if (!immediate.deltas[key]) {
      // Matches the confirmed baseline — nothing pending, nothing to promote.
      nextConfirmed[key] = fresh[key]
      continue
    }
    // Fresh deviates from confirmed. Only promote if this SAME deviation
    // was already the pending candidate (i.e. seen on the prior poll too).
    if (pending && materialValueEqual(pending[key], fresh[key])) {
      deltas[key] = immediate.deltas[key] // from confirmed -> fresh, same as before
      changed = true
      nextConfirmed[key] = fresh[key]
      // nextPending[key] left unset — reset after promotion.
    } else {
      // First time seeing this deviation (or it differs from what was
      // pending) — hold the confirmed baseline, start/update the candidate.
      nextConfirmed[key] = confirmed ? (confirmed[key] ?? fresh[key]) : fresh[key]
      nextPending[key] = fresh[key]
      pendingCategories.push(key)
    }
  }
  return { changed, deltas, nextConfirmed, nextPending, pendingCategories }
}

const SYSTEM_PROMPT = `You are a geopolitical-to-markets edge detector. Your job is to flag risks BEFORE mainstream financial news picks them up — not to summarize current events.

Given: chokepoint status (Hormuz, Bab al Mandeb, Suez, Taiwan Strait), supply chain stress indices, geopolitical event density (GDELT/UCDP), and macro stress (credit spreads, yen fixings, CII).

Identify risks that would trigger: (1) oil/energy shock, (2) carry unwind, (3) equity drawdown — via a clear transmission mechanism, not speculation.

Flag ONLY if probability > 30% AND the market hasn't fully priced it yet — cross-check spot oil, SPX IV, and yen vol BEFORE flagging, not after. The edge is catching this ahead of confirmation, so bias toward earlier/lower-confidence flags with explicit confidence scores rather than waiting for certainty.

Additionally, evaluate EVERY signal category in the data (chokepoints, conflict/UCDP by country, cross-source convergence signals, CII per country, supply chain stress, credit, FX/carry, vol) and report your reasoning per category — including the ones you did NOT flag — so every run is a labeled data point.

Output strict JSON: {flagged: boolean, risk_category: string, confidence: INTEGER 0-100 (NOT a 0-1 probability — e.g. 65, not 0.65), transmission_chain: string, relevant_signals: string[], granville_modifier: {position_size_cap: number between 0 and 1, alma_reversion_confidence: INTEGER 0-100 (NOT a 0-1 probability — e.g. 28, not 0.28)}, categories_considered: string[], categories_dismissed_reason: {<category>: "one-line reason not flagged"}}`

// NOTE on 1min.ai prompt caching (checked 2026-07-12): the chat-with-ai
// promptObject schema (see settings: withMemories/historySettings/
// webSearchSettings in a live response) exposes no cache_control-style
// breakpoint or separate system-prompt field — it's a single flat `prompt`
// string. There is no API-level caching lever available here. This is a
// smaller loss than it sounds: SYSTEM_PROMPT is ~1.1K chars (~280 tokens);
// the DATA payload (up to 60K chars / ~13K tokens on a full scan) was always
// the dominant cost, which is exactly what the delta-mode payload below cuts.

// Full-breadth prompt — complete current state of every category, used by
// full-scan mode regardless of what changed.
function buildFullPrompt(signals, errors) {
  return `${SYSTEM_PROMPT}

MODE: full-breadth scan (complete dataset, all categories, regardless of change).

CURRENT SIGNAL DATA (JSON, null = source unavailable${errors.length ? `; failed sources: ${errors.join('; ')}` : ''}):
${JSON.stringify(signals).slice(0, 60000)}

Respond with the strict JSON object only — no markdown fences, no commentary.`
}

// gatherSignals()'s keys don't match computeMaterialState()'s keys 1:1
// (e.g. signals.shippingStress vs material.shipping) — this map lets
// buildDeltaPrompt look up "did THIS signal's category change" correctly.
// Getting this wrong silently downgrades a real change to a summary line —
// caught in testing via an apples-to-apples prompt-size comparison (a
// "changed" delta prompt came out smaller than the full-scan prompt, which
// is only possible if categories were being summarized when they shouldn't
// have been).
const SIGNAL_TO_MATERIAL_KEY = {
  hormuz: 'hormuz',
  chokepoints: 'chokepoints',
  shippingStress: 'shipping',
  theaterPosture: 'posture',
  riskScores: 'cii',
  crossSourceSignals: 'crossSource',
  ucdpSummary: 'ucdp',
  hyOas: 'hyOas',
  yen: 'yen',
  wtiSpot: 'wti',
  vix: 'vix',
}

// Delta prompt — used by gated-triggered mode. Chokepoints (+ hormuz) are
// core to the trading thesis so they're always sent in full regardless of
// whether they moved. Every other category is sent in full ONLY if it
// appears in the diff; otherwise only its compact bucketed last-known value
// is included (a few bytes, not the raw payload) so the model still has
// full category coverage for categories_considered without re-paying to
// re-interpret unchanged detail.
function buildDeltaPrompt(signals, material, diff, errors) {
  const ALWAYS_FULL = new Set(['hormuz', 'chokepoints'])
  const changedMaterialKeys = new Set(Object.keys(diff.deltas))
  const fullPayload = {}
  const unchangedSummary = {}
  for (const key of Object.keys(signals)) {
    const materialKey = SIGNAL_TO_MATERIAL_KEY[key] ?? key
    if (ALWAYS_FULL.has(key) || changedMaterialKeys.has(materialKey)) fullPayload[key] = signals[key]
    else unchangedSummary[key] = material[materialKey]
  }
  return `${SYSTEM_PROMPT}

MODE: routine delta scan. Chokepoints are always sent in full (core to the trading thesis). Other categories are sent in full ONLY if they changed since the last run; unchanged categories are summarized as their last-known bucketed value only.

CHANGES SINCE LAST RUN (category -> delta; empty object per category means no field-level change was material):
${JSON.stringify(diff.deltas)}

FULL DATA — chokepoints (always) + any changed category:
${JSON.stringify(fullPayload).slice(0, 40000)}

UNCHANGED CATEGORIES (compact last-known bucketed state, no new raw detail — still evaluate these for categories_considered, just treat "no delta" as continuing prior reasoning):
${JSON.stringify(unchangedSummary)}
${errors.length ? `\nFailed sources this run: ${errors.join('; ')}` : ''}

Respond with the strict JSON object only — no markdown fences, no commentary.`
}

// Model swap 2026-07-16: real usage showed ~136K raw tokens/day (diff-gate
// working as intended) but ~1.8M 1min.ai "credit"/day on claude-sonnet-4-6 —
// credit is 1min.ai's billing unit, NOT tokens (~14x tokens for Sonnet on
// this workload). No Claude Haiku is available via 1min.ai (tried several
// model-id variants, all UNSUPPORTED_MODEL). Compared real candidates on the
// ACTUAL aggregator prompt (not a toy test):
//   - gpt-4o-mini: ~29x cheaper credit, but noticeably shallower analysis
//     (generic transmission_chain with no cited figures, only ~7 broad
//     categories vs Sonnet's per-country granularity, a miscalibrated-looking
//     position_size_cap) — rejected, guts the "every run is a labeled data
//     point" value of categories_dismissed_reason.
//   - gemini-2.5-flash: ~8x cheaper credit, comparable analytical depth to
//     Sonnet (cites real figures, similar cross-referencing), chosen as the
//     new primary model. Caught it returning granville_modifier
//     .alma_reversion_confidence on a 0-1 scale instead of 0-100 — fixed via
//     explicit prompt wording (see SYSTEM_PROMPT), not code-side normalization,
//     so the LLM's own stated confidence stays self-consistent with its output.
//   - Latency: ~58s for gemini-2.5-flash vs Sonnet's own ~40s already running
//     successfully in production — not a new class of risk, but real; see
//     vercel.json maxDuration.
const MODEL = 'gemini-2.5-flash'

function sleep(ms) { return new Promise(res => setTimeout(res, ms)) }

// Single attempt — no retry logic here, kept separate so callOneMin's retry
// wrapper stays simple. Throws on any failure (non-2xx, missing text,
// unparseable JSON) so the caller can decide whether to retry.
async function callOneMinOnce(prompt, key, model) {
  const r = await fetch('https://api.1min.ai/api/chat-with-ai', {
    method: 'POST',
    signal: AbortSignal.timeout(60000), // caps a single attempt so a hang can't eat the whole retry budget
    headers: { 'Content-Type': 'application/json', 'API-KEY': key },
    body: JSON.stringify({ type: 'CHAT', model, promptObject: { prompt, isMixed: false } }),
  })
  if (!r.ok) throw new Error(`1min.ai ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const data = await r.json()
  const text = data?.aiRecord?.aiRecordDetail?.resultObject?.[0]
  if (!text) throw new Error(`Unexpected 1min.ai response shape: ${JSON.stringify(data).slice(0, 200)}`)
  const match = String(text).replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`LLM did not return JSON: ${String(text).slice(0, 200)}`)
  const m = data?.aiRecord?.metadata ?? {}
  const tokenUsage = {
    model,
    inputToken: m.inputToken ?? null,
    outputToken: m.outputToken ?? null,
    totalToken: m.totalToken ?? null,
    credit: m.credit ?? null,
  }
  return { verdict: JSON.parse(match[0]), tokenUsage }
}

// Same 1min.ai call shape as api/synthesis.js — promptObject format, NOT a
// messages array (messages format is rejected with PROMPT_OBJECT_VALIDATION_FAILED).
// Returns both the parsed verdict and the real token/credit usage from
// aiRecord.metadata so every run can log actual cost, not an estimate.
//
// One retry after a short backoff (added 2026-07-17): two production cron
// runs failed with a 500 originating from this call, both times self-healing
// on the next scheduled run hours later. gemini-2.5-flash's longer call
// duration (46-58s observed, vs Sonnet's steadier ~40s) widens the exposure
// window for a transient 1min.ai/Gemini gateway hiccup — a single retry
// absorbs that within the same invocation instead of waiting hours and
// firing a failure email in between. Each attempt is capped at 60s (see
// AbortSignal.timeout in callOneMinOnce) so a hang can't silently eat the
// whole budget; worst case is ~60s + 3s backoff + ~60s + gatherSignals()'s
// own time, which is why vercel.json's maxDuration was raised to 150.
async function callOneMin(prompt, key, model = MODEL) {
  try {
    return await callOneMinOnce(prompt, key, model)
  } catch (firstErr) {
    await sleep(3000)
    try {
      return await callOneMinOnce(prompt, key, model)
    } catch (secondErr) {
      throw new Error(`1min.ai failed twice — first: ${firstErr.message} | retry: ${secondErr.message}`)
    }
  }
}

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return { url, headers }
}

// ── Last-snapshot persistence (raw + bucketed material state, NO synthesis
// output) — this is the diff-gate's memory. Cheap reads/writes, no LLM. ────
async function readLastSnapshot() {
  const c = sb(); if (!c) return null
  try {
    const r = await fetch(`${c.url}/rest/v1/geo_regime_last_snapshot?id=eq.1&select=material,pending,raw,captured_at`, { headers: c.headers })
    if (!r.ok) return null
    return (await r.json())[0] ?? null
  } catch { return null }
}

async function writeLastSnapshot(material, pending, raw) {
  const c = sb(); if (!c) return
  try {
    await fetch(`${c.url}/rest/v1/geo_regime_last_snapshot?on_conflict=id`, {
      method: 'POST',
      headers: { ...c.headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ id: 1, material, pending, raw, captured_at: new Date().toISOString() }]),
    })
  } catch { /* non-fatal */ }
}

function implicationFor(riskCategory) {
  for (const [re, imp] of RISK_TO_IMPLICATION) if (re.test(riskCategory)) return imp
  return 'none'
}

// Upsert the flagged risk. The BEFORE UPDATE trigger on geopolitical_signals
// writes geopolitical_signal_history rows on any state/severity/implication
// change, so history append is implicit.
async function upsertSignal(verdict) {
  const c = sb(); if (!c) throw new Error('Supabase not configured')
  const slug = `llm-${String(verdict.risk_category).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`
  const row = {
    slug,
    name: `AI flag: ${verdict.risk_category}`,
    category: 'policy',
    state: 'escalating',
    severity: Math.max(0, Math.min(100, Math.round(Number(verdict.confidence) || 0))),
    implication: implicationFor(String(verdict.risk_category)),
    granville_modifier: verdict.granville_modifier ?? {},
    source: `aggregate-geo-regime (worldmonitor public API + FRED, via 1min.ai ${MODEL})`,
    notes: `${verdict.transmission_chain}\nSignals: ${(verdict.relevant_signals ?? []).join('; ')}`,
    last_update: new Date().toISOString(),
  }
  const r = await fetch(`${c.url}/rest/v1/geopolitical_signals?on_conflict=slug`, {
    method: 'POST',
    headers: { ...c.headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row]),
  })
  if (!r.ok) throw new Error(`Supabase upsert ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return (await r.json())[0]
}

// Append-only per-run record: every evaluation — including gated-skip runs
// that never called the LLM — becomes a labeled data point. run_type lets
// later review distinguish gated-skip / gated-triggered / full-scan.
async function insertRunRecord({ runType, verdict, inputHash, errors, diff, tokenUsage }) {
  const c = sb(); if (!c) return 'Supabase not configured'
  const row = {
    run_type: runType,
    flagged: verdict.flagged === true,
    risk_category: verdict.flagged === true ? String(verdict.risk_category ?? '') : null,
    confidence: Math.max(0, Math.min(100, Math.round(Number(verdict.confidence) || 0))),
    categories_considered: verdict.categories_considered ?? [],
    categories_dismissed_reason: verdict.categories_dismissed_reason ?? {},
    verdict,
    input_hash: inputHash,
    source_errors: errors,
    diff: diff ?? {},
    token_usage: tokenUsage ?? null,
  }
  try {
    const r = await fetch(`${c.url}/rest/v1/geo_regime_runs`, {
      method: 'POST',
      headers: c.headers,
      body: JSON.stringify([row]),
    })
    return r.ok ? null : `geo_regime_runs insert ${r.status}: ${(await r.text()).slice(0, 150)}`
  } catch (e) { return e.message }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const secret = process.env.SNAPSHOT_SECRET
  if (!secret) return res.status(500).json({ error: 'SNAPSHOT_SECRET not configured' })
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' })
  const oneMinKey = process.env.ONEMIN_KEY
  if (!oneMinKey) return res.status(500).json({ error: 'ONEMIN_KEY not configured' })

  const body = typeof req.body === 'object' && req.body ? req.body : {}
  const force = req.query?.force === '1' || body.force === true
  const scanFull = req.query?.scan === 'full' || body.scan === 'full'

  try {
    const { signals, errors } = await gatherSignals()
    const material = computeMaterialState(signals)
    const inputHash = JSON.stringify(material)

    const lastSnapshot = await readLastSnapshot()
    const confirmed = lastSnapshot?.material ?? null
    const pending = lastSnapshot?.pending ?? null

    // Full-scan always looks at the complete dataset and, since it's a full
    // fresh look-through, resets confirmed to current values across every
    // category and clears any pending hysteresis candidate outright.
    const gated = resolveGatedDiff(confirmed, pending, material)
    const diff = scanFull ? diffMaterialStates(confirmed, material) : gated

    // ── Gated skip: no material change, not forced, not a full scan ────────
    if (!scanFull && !force && !diff.changed) {
      await writeLastSnapshot(gated.nextConfirmed, gated.nextPending, signals)
      const skipVerdict = {
        flagged: false, skipped: true, reason: 'no material change since last snapshot',
        pendingCategories: gated.pendingCategories,
      }
      const runRecordError = await insertRunRecord({
        runType: 'gated-skip', verdict: skipVerdict, inputHash, errors, diff: diff.deltas, tokenUsage: null,
      })
      return res.status(200).json({
        skipped: true, runType: 'gated-skip', diff: diff.deltas,
        pendingCategories: gated.pendingCategories, runRecordError, sourceErrors: errors,
      })
    }

    // ── Gated-triggered (delta payload) or full-scan (complete payload) ────
    const runType = scanFull ? 'full-scan' : 'gated-triggered'
    const prompt = scanFull
      ? buildFullPrompt(signals, errors)
      : buildDeltaPrompt(signals, material, diff, errors)

    const { verdict, tokenUsage } = await callOneMin(prompt, oneMinKey)
    const result = { verdict, evaluatedAt: new Date().toISOString(), runType, tokenUsage }

    // Persist the flag, but never discard a completed LLM verdict over a
    // storage failure — surface it in the response instead (upsertError).
    let upserted = null, upsertError = null
    if (verdict.flagged === true) {
      try { upserted = await upsertSignal(verdict) }
      catch (e) { upsertError = e.message }
    }

    const runRecordError = await insertRunRecord({ runType, verdict, inputHash, errors, diff: diff.deltas, tokenUsage })
    // Full-scan: promote everything, clear all pending. Gated-triggered:
    // gated.nextConfirmed/nextPending already reflect the hysteresis outcome.
    if (scanFull) await writeLastSnapshot(material, {}, signals)
    else await writeLastSnapshot(gated.nextConfirmed, gated.nextPending, signals)

    return res.status(200).json({
      ...result, diff: diff.deltas, upsertedSignal: upserted?.slug ?? null, upsertError, runRecordError, sourceErrors: errors,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
