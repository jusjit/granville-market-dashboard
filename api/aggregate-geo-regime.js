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
// frontend/api and is a separate future step.
// ────────────────────────────────────────────────────────────────────────────
//
// Auth: Authorization: Bearer <SNAPSHOT_SECRET> (same secret as api/snapshot.js,
// already present in Vercel env + GitHub Actions secrets — nothing new to add).
// Trigger: GitHub Actions cron every 4h (geo-regime-aggregator.yml) or manual
// GET/POST. `?force=1` bypasses the cache/dedupe and always calls the LLM.

const WM_BASE = process.env.WORLDMONITOR_API_BASE || 'https://www.worldmonitor.app'
const CACHE_TTL_MS = 3 * 60 * 60 * 1000 // < 4h cron interval, so an unchanged
// input hash within the same cycle never re-calls 1min.ai (mirrors the
// synthesis.js hash+TTL dedupe approach)

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

// Dedupe hash over the MATERIAL state only (statuses, posture levels, bucketed
// macro values) — noisy fields (timestamps, prose) excluded so the LLM is only
// re-called when something actually moved.
function hashInputs(s) {
  const round = (v, step) => (v == null ? null : Math.round(v / step) * step)
  const latest = arr => (Array.isArray(arr) && arr[0] ? arr[0].value : null)
  // Field names verified against live worldmonitor.app responses (2026-07):
  // chokepoints[].{id,status,disruptionScore}, theaters[].{theater,postureLevel,
  // activeFlights}, ciiScores[].{region,combinedScore,trend}.
  const material = {
    hormuz: s.hormuz?.status ?? null,
    chokepoints: (s.chokepoints?.chokepoints ?? [])
      .filter(c => ['hormuz_strait', 'bab_el_mandeb', 'suez', 'taiwan_strait'].includes(c.id))
      .map(c => `${c.id}:${c.status ?? ''}:${round(Number(c.disruptionScore ?? 0), 10)}`).sort(),
    shipping: (s.shippingStress?.carriers ?? [])
      .map(c => `${c.symbol}:${round(Number(c.changePct ?? 0), 2)}`).sort(),
    posture: (s.theaterPosture?.theaters ?? [])
      .map(t => `${t.theater}:${t.postureLevel ?? ''}:${round(Number(t.activeFlights ?? 0), 5)}`).sort(),
    // 10-point buckets: combinedScore recomputes continuously and jitters ±1-2
    // around bucket edges (observed CN 57.4↔57.6 flipping a 5-point bucket),
    // which would re-call the LLM on non-material change.
    cii: (s.riskScores?.ciiScores ?? [])
      .filter(c => ['TW', 'CN', 'IR', 'IL', 'JP', 'SA', 'YE', 'EG', 'RU', 'UA'].includes(c.region))
      .map(c => `${c.region}:${round(Number(c.combinedScore ?? 0), 10)}`).sort(),
    hyOas: round(latest(s.hyOas), 0.25),
    yen: round(latest(s.yen), 2),
    wti: round(latest(s.wtiSpot), 2),
    vix: round(latest(s.vix), 1),
  }
  return JSON.stringify(material)
}

const SYSTEM_PROMPT = `You are a geopolitical-to-markets edge detector. Your job is to flag risks BEFORE mainstream financial news picks them up — not to summarize current events.

Given: chokepoint status (Hormuz, Bab al Mandeb, Suez, Taiwan Strait), supply chain stress indices, geopolitical event density (GDELT/UCDP), and macro stress (credit spreads, yen fixings, CII).

Identify risks that would trigger: (1) oil/energy shock, (2) carry unwind, (3) equity drawdown — via a clear transmission mechanism, not speculation.

Flag ONLY if probability > 30% AND the market hasn't fully priced it yet — cross-check spot oil, SPX IV, and yen vol BEFORE flagging, not after. The edge is catching this ahead of confirmation, so bias toward earlier/lower-confidence flags with explicit confidence scores rather than waiting for certainty.

Output strict JSON: {flagged: boolean, risk_category: string, confidence: 0-100, transmission_chain: string, relevant_signals: string[], granville_modifier: {position_size_cap: number, alma_reversion_confidence: number}}`

function buildPrompt(signals, errors) {
  return `${SYSTEM_PROMPT}

CURRENT SIGNAL DATA (JSON, null = source unavailable${errors.length ? `; failed sources: ${errors.join('; ')}` : ''}):
${JSON.stringify(signals).slice(0, 60000)}

Respond with the strict JSON object only — no markdown fences, no commentary.`
}

// Same 1min.ai call shape as api/synthesis.js — promptObject format, NOT a
// messages array (messages format is rejected with PROMPT_OBJECT_VALIDATION_FAILED).
async function callOneMin(prompt, key) {
  const r = await fetch('https://api.1min.ai/api/chat-with-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-KEY': key },
    body: JSON.stringify({ type: 'CHAT', model: 'claude-sonnet-4-6', promptObject: { prompt, isMixed: false } }),
  })
  if (!r.ok) throw new Error(`1min.ai ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const data = await r.json()
  const text = data?.aiRecord?.aiRecordDetail?.resultObject?.[0]
  if (!text) throw new Error(`Unexpected 1min.ai response shape: ${JSON.stringify(data).slice(0, 200)}`)
  // Strict-JSON contract, but defend against fenced/prefixed output anyway.
  const match = String(text).replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`LLM did not return JSON: ${String(text).slice(0, 200)}`)
  return JSON.parse(match[0])
}

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return { url, headers }
}

async function cacheRead() {
  const c = sb(); if (!c) return null
  try {
    const r = await fetch(`${c.url}/rest/v1/geo_regime_cache?id=eq.1&select=result,input_hash,created_at`, { headers: c.headers })
    if (!r.ok) return null
    return (await r.json())[0] ?? null
  } catch { return null }
}

async function cacheWrite(result, inputHash) {
  const c = sb(); if (!c) return
  try {
    await fetch(`${c.url}/rest/v1/geo_regime_cache?on_conflict=id`, {
      method: 'POST',
      headers: { ...c.headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ id: 1, result, input_hash: inputHash, created_at: new Date().toISOString() }]),
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
    source: 'aggregate-geo-regime (worldmonitor public API + FRED, via 1min.ai claude-sonnet-4-6)',
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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const secret = process.env.SNAPSHOT_SECRET
  if (!secret) return res.status(500).json({ error: 'SNAPSHOT_SECRET not configured' })
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' })
  const oneMinKey = process.env.ONEMIN_KEY
  if (!oneMinKey) return res.status(500).json({ error: 'ONEMIN_KEY not configured' })

  const force = req.query?.force === '1' || (typeof req.body === 'object' && req.body?.force === true)

  try {
    const { signals, errors } = await gatherSignals()
    const inputHash = hashInputs(signals)

    if (!force) {
      const cached = await cacheRead()
      if (cached?.result &&
          Date.now() - new Date(cached.created_at).getTime() < CACHE_TTL_MS &&
          cached.input_hash === inputHash) {
        return res.status(200).json({ ...cached.result, cached: true, sourceErrors: errors })
      }
    }

    const verdict = await callOneMin(buildPrompt(signals, errors), oneMinKey)
    const result = { verdict, evaluatedAt: new Date().toISOString() }

    // Persist the flag, but never discard a completed LLM verdict over a
    // storage failure — surface it in the response instead (upsertError).
    let upserted = null, upsertError = null
    if (verdict.flagged === true) {
      try { upserted = await upsertSignal(verdict) }
      catch (e) { upsertError = e.message }
    }

    await cacheWrite(result, inputHash)
    return res.status(200).json({ ...result, cached: false, upsertedSignal: upserted?.slug ?? null, upsertError, sourceErrors: errors })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
