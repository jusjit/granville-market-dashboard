#!/usr/bin/env node
// Noah Predict sanity-check helper
// Subcommands:
//   get-theme   — fetch geo regime data, return highest-severity theme as JSON
//   log         — write a sanity-check row to Supabase (reads JSON from stdin)
//   backfill    — fill market_outcome_7d/30d on rows where the window has passed

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env')
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].trim()
  }
}

function sb() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    headersRead: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  }
}

const THEME_TO_MARKET = {
  oil_shock_risk: {
    fred: ['DCOILWTICO', 'DCOILBRENTEU'],
    finnhub: [],
    labels: { DCOILWTICO: 'WTI Crude', DCOILBRENTEU: 'Brent Crude' },
  },
  carry_unwind: {
    fred: [],
    finnhub: ['VIXY'],
    frankfurter: ['USD/JPY'],
    labels: { 'USD/JPY': 'USD/JPY', VIXY: 'VIX (VIXY proxy)' },
  },
  equity_drawdown_severity: {
    fred: [],
    finnhub: ['SPY', 'VIXY'],
    labels: { SPY: 'SPX (SPY proxy)', VIXY: 'VIX (VIXY proxy)' },
  },
  safe_haven_bid: {
    fred: ['GOLDAMGBD228NLBM'],
    finnhub: ['VIXY'],
    labels: { GOLDAMGBD228NLBM: 'Gold (London AM)', VIXY: 'VIX (VIXY proxy)' },
  },
  freight_cost_shock: {
    fred: ['DCOILWTICO', 'DHHNGSP'],
    finnhub: [],
    labels: { DCOILWTICO: 'WTI Crude', DHHNGSP: 'Natural Gas (HH)' },
  },
}
const DEFAULT_MARKET = {
  fred: ['DCOILWTICO'],
  finnhub: ['SPY', 'VIXY'],
  labels: { DCOILWTICO: 'WTI Crude', SPY: 'SPX (SPY proxy)', VIXY: 'VIX (VIXY proxy)' },
}

async function fetchFred(seriesId) {
  const key = process.env.VITE_FRED_KEY || process.env.FRED_KEY
  if (!key) return null
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=5`
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!r.ok) return null
  const d = await r.json()
  const obs = (d.observations ?? []).filter(o => o.value !== '.')
  return obs.length ? { date: obs[0].date, value: Number(obs[0].value) } : null
}

async function fetchFredOnDate(seriesId, targetDate) {
  const key = process.env.VITE_FRED_KEY || process.env.FRED_KEY
  if (!key) return null
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=5&observation_end=${targetDate}`
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!r.ok) return null
  const d = await r.json()
  const obs = (d.observations ?? []).filter(o => o.value !== '.')
  return obs.length ? { date: obs[0].date, value: Number(obs[0].value) } : null
}

async function fetchFinnhub(symbols) {
  const key = process.env.VITE_FINNHUB_KEY || process.env.FINNHUB_KEY
  if (!key || !symbols.length) return {}
  const results = {}
  for (const sym of symbols) {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${key}`
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (r.ok) {
        const d = await r.json()
        results[sym] = { price: d.c, prevClose: d.pc }
      }
    } catch {}
  }
  return results
}

async function fetchUsdJpy() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=JPY', {
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return null
    const d = await r.json()
    return { date: d.date, value: d.rates?.JPY ?? null }
  } catch { return null }
}

async function fetchUsdJpyOnDate(targetDate) {
  try {
    const r = await fetch(`https://api.frankfurter.app/${targetDate}?from=USD&to=JPY`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return null
    const d = await r.json()
    return { date: d.date, value: d.rates?.JPY ?? null }
  } catch { return null }
}

function resolveMarketMapping(theme) {
  if (THEME_TO_MARKET[theme]) return THEME_TO_MARKET[theme]
  const t = theme.toLowerCase()
  if (t.includes('oil') || t.includes('energy')) return THEME_TO_MARKET.oil_shock_risk
  if (t.includes('carry') || t.includes('yen') || t.includes('boj')) return THEME_TO_MARKET.carry_unwind
  if (t.includes('equity') || t.includes('drawdown')) return THEME_TO_MARKET.equity_drawdown_severity
  if (t.includes('haven') || t.includes('gold')) return THEME_TO_MARKET.safe_haven_bid
  if (t.includes('freight') || t.includes('shipping')) return THEME_TO_MARKET.freight_cost_shock
  return DEFAULT_MARKET
}

async function getMarketState(theme) {
  const mapping = resolveMarketMapping(theme)
  const state = {}

  const fredPromises = (mapping.fred || []).map(async id => {
    const v = await fetchFred(id)
    if (v) state[id] = { ...v, label: mapping.labels?.[id] || id }
  })

  const finnhubData = fetchFinnhub(mapping.finnhub || []).then(d => {
    for (const [sym, v] of Object.entries(d)) {
      state[sym] = { ...v, label: mapping.labels?.[sym] || sym }
    }
  })

  const fxPromise = (mapping.frankfurter || []).includes('USD/JPY')
    ? fetchUsdJpy().then(v => { if (v) state['USD/JPY'] = { ...v, label: 'USD/JPY' } })
    : Promise.resolve()

  await Promise.allSettled([...fredPromises, finnhubData, fxPromise])
  return state
}

async function getMarketStateOnDate(theme, targetDate) {
  const mapping = resolveMarketMapping(theme)
  const state = {}

  const fredPromises = (mapping.fred || []).map(async id => {
    const v = await fetchFredOnDate(id, targetDate)
    if (v) state[id] = { ...v, label: mapping.labels?.[id] || id }
  })

  const fxPromise = (mapping.frankfurter || []).includes('USD/JPY')
    ? fetchUsdJpyOnDate(targetDate).then(v => { if (v) state['USD/JPY'] = { ...v, label: 'USD/JPY' } })
    : Promise.resolve()

  // Finnhub only gives current quotes, not historical — skip for backfill
  // For SPY/VIXY historical, we'd need Tradier candles or accept FRED-only
  await Promise.allSettled([...fredPromises, fxPromise])
  return state
}

// ── Subcommands ────────────────────────────────────────────────────────────

async function cmdGetTheme() {
  loadEnv()
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://private-market-dashboard.vercel.app'

  const r = await fetch(`${baseUrl}/api/aggregate-geo-regime?window=7`, {
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) {
    console.error(`Failed to fetch geo regime data: ${r.status}`)
    process.exit(1)
  }
  const data = await r.json()

  // Find highest-severity theme from recent assessed runs
  const assessed = (data.reasoningTimeline ?? [])
    .filter(r => r.flagged)
    .sort((a, b) => b.confidence - a.confidence)

  let theme = null
  let geoRead = {}

  if (assessed.length > 0) {
    const top = assessed[0]
    theme = top.risk_category
    geoRead = {
      risk_category: top.risk_category,
      confidence: top.confidence,
      reasoning: top.reasoning,
      bottom_line: top.bottom_line,
      relevant_signals: top.relevant_signals,
      evaluated_at: top.evaluated_at,
    }
  } else {
    // No flagged runs — use regime view
    const regime = data.regime
    if (regime) {
      const fields = ['oil_shock_risk', 'carry_unwind_pressure', 'equity_drawdown_severity', 'safe_haven_bid', 'freight_cost_shock']
      let maxSev = 0
      for (const f of fields) {
        const v = Number(regime[f]) || 0
        if (v > maxSev) { maxSev = v; theme = f.replace('_pressure', '') }
      }
    }
    if (!theme) theme = 'oil_shock_risk' // fallback
    geoRead = {
      risk_category: theme,
      confidence: 0,
      reasoning: 'No flagged risks in the past 7 days',
      source: 'regime_view_fallback',
    }
  }

  // Collect signal context
  const signals = (data.signals ?? []).slice(0, 5).map(s => ({
    slug: s.slug, severity: s.severity, risk_category: s.risk_category,
  }))
  geoRead.active_signals = signals
  geoRead.tier_tracking = data.tierTracking

  // Get market state for the theme
  const market = await getMarketState(theme)

  // Build entities/geography for Noah from the theme
  const THEME_ENTITIES = {
    oil_shock_risk: { entities: ['crude oil', 'WTI', 'Brent'], geography: 'Middle East, Strait of Hormuz' },
    'oil/energy shock': { entities: ['crude oil', 'WTI', 'Brent', 'natural gas'], geography: 'Middle East, Strait of Hormuz' },
    carry_unwind: { entities: ['Japanese yen', 'carry trade', 'BOJ'], geography: 'Japan, global' },
    equity_drawdown_severity: { entities: ['equity markets', 'S&P 500'], geography: 'global' },
    safe_haven_bid: { entities: ['gold', 'US Treasury'], geography: 'global' },
    freight_cost_shock: { entities: ['shipping', 'freight', 'Suez Canal'], geography: 'Red Sea, Suez, global' },
  }
  // Normalize theme to match market mapping keys
  const themeNorm = theme.toLowerCase()
  const matchKey = Object.keys(THEME_ENTITIES).find(k => themeNorm.includes(k.replace(/_/g, ' ')) || k.includes(themeNorm.split('/')[0]))
  const noahParams = THEME_ENTITIES[matchKey || theme] || { entities: [theme.replace(/[_/]/g, ' ')], geography: 'global' }

  console.log(JSON.stringify({
    theme,
    geoRead,
    market,
    noahParams,
  }))
}

async function cmdLog() {
  loadEnv()
  const c = sb()
  if (!c) { console.error('Supabase not configured'); process.exit(1) }

  // Read JSON payload from stdin
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const row = JSON.parse(input)

  const r = await fetch(`${c.url}/rest/v1/noah_sanity_check_log?on_conflict=date`, {
    method: 'POST',
    headers: { ...c.headers, Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify([{
      date: row.date,
      theme: row.theme,
      geo_monitor_read: row.geo_monitor_read,
      noah_read: row.noah_read,
      market_state_at_log_time: row.market_state_at_log_time,
      noah_job_id: row.noah_job_id || null,
      status: row.status || 'completed',
      error_message: row.error_message || null,
    }]),
  })
  if (!r.ok) {
    console.error(`Supabase insert failed: ${r.status} ${await r.text()}`)
    process.exit(1)
  }
  const result = await r.json()
  console.log(JSON.stringify({ ok: true, id: result[0]?.id }))
}

async function cmdBackfill() {
  loadEnv()
  const c = sb()
  if (!c) { console.error('Supabase not configured'); process.exit(1) }

  const now = new Date()
  const fmt = d => d.toISOString().slice(0, 10)

  // Fetch rows missing 7d or 30d outcomes
  const r = await fetch(
    `${c.url}/rest/v1/noah_sanity_check_log?status=eq.completed&or=(market_outcome_7d.is.null,market_outcome_30d.is.null)&order=date.asc`,
    { headers: c.headersRead }
  )
  if (!r.ok) { console.error(`Fetch failed: ${r.status}`); process.exit(1) }
  const rows = await r.json()

  let filled = 0
  for (const row of rows) {
    const logDate = new Date(row.date + 'T00:00:00Z')
    const day7 = new Date(logDate.getTime() + 7 * 86400000)
    const day30 = new Date(logDate.getTime() + 30 * 86400000)

    const updates = {}

    if (!row.market_outcome_7d && day7 < now) {
      const state = await getMarketStateOnDate(row.theme, fmt(day7))
      if (Object.keys(state).length) {
        updates.market_outcome_7d = state
      }
    }

    if (!row.market_outcome_30d && day30 < now) {
      const state = await getMarketStateOnDate(row.theme, fmt(day30))
      if (Object.keys(state).length) {
        updates.market_outcome_30d = state
      }
    }

    if (Object.keys(updates).length) {
      const patchR = await fetch(`${c.url}/rest/v1/noah_sanity_check_log?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: c.headers,
        body: JSON.stringify(updates),
      })
      if (patchR.ok) filled++
      else console.error(`Backfill row ${row.id} failed: ${patchR.status}`)
    }
  }

  console.log(JSON.stringify({ checked: rows.length, filled }))
}

// ── Main ───────────────────────────────────────────────────────────────────

const cmd = process.argv[2]
switch (cmd) {
  case 'get-theme': await cmdGetTheme(); break
  case 'log': await cmdLog(); break
  case 'backfill': await cmdBackfill(); break
  default:
    console.error('Usage: node noah-sanity-check.mjs <get-theme|log|backfill>')
    process.exit(1)
}
