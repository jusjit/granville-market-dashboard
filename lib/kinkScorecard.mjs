/*
 * Kink & event scorecard — descriptive tracking. Rules fixed 2026-11-09; do not tune them as results
 * come in. Days/windows after REGISTERED are the forward sample; everything before is the baseline the
 * rules were found on. Treat as descriptive until the forward sample reaches FORWARD_MIN_DAYS flagged
 * days (one-day premium) and FORWARD_MIN_WINDOWS finished kinked windows (surface).
 *
 * One-day premium (Yahoo ^VIX1D, ^VIX, ^VIX9D, ^GSPC closes; FRED CPI/NFP dates; FOMC list below):
 *  - Kept day E: the previous trading day P is exactly the previous calendar day.
 *  - p = ln(VIX1D/denominator at P) − median of the same over the 20 previous kept non-event days,
 *    denominator VIX (30-day) or VIX9D.
 *  - Original rule: p > ln(1.15). New rule: p − expected event premium > ln(1.15), where the expected
 *    premium is the mean p of earlier events of the same type (pooled until a type has 5); 0 on
 *    ordinary days.
 *  - z = |ln(SPX E/P)| / (VIX1D(P)/100/√252). Next-day return = ln(SPX E/P) in bp.
 *  - Exploratory finding behind the direction column (2023-04 to 2026-11, not pre-registered):
 *    flagged days rose more than other days (VIX9D, new rule +39 bp, both halves, survives the
 *    prior-day return).
 *
 * Surface kinks (vol_surface_snapshots; Yahoo SPX closes):
 *  - Each window between adjacent expiries is scored once, from the last in-session snapshot taken on
 *    or before the day its near expiry settles (the price just before the window starts).
 *  - Forward vol in trading days. Original rule: the stored kink flag (near expiry ≥ 2 days out, no
 *    wide quote). New rule: forward vol 15% above its neighbours after removing the usual macro
 *    premium (a FOMC/CPI/NFP day = 1.52 ordinary days of variance).
 *  - Outcome: realized vol over the window (SPX close-to-close) ÷ forward vol, and the signed SPX move.
 */

const REGISTERED = '2026-11-09'
const FORWARD_MIN_DAYS = 40
const FORWARD_MIN_WINDOWS = 30
const LN115 = Math.log(1.15)
const EVENT_VAR_DAYS = 1.52
const FOMC = new Set([
  '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13',
  '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-16', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08',
])

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2 }
const round = (v, d = 2) => v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d))
const nyDate = t => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const nyf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const ny = iso => { const p = Object.fromEntries(nyf.formatToParts(new Date(iso)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute } }
const nextBiz = d => { const x = new Date(`${d}T12:00:00Z`); do { x.setUTCDate(x.getUTCDate() + 1) } while ([0, 6].includes(x.getUTCDay())); return x.toISOString().slice(0, 10) }
const bizDays = (a, b) => { let n = 0; const x = new Date(`${a}T12:00:00Z`); while (x.toISOString().slice(0, 10) < b) { x.setUTCDate(x.getUTCDate() + 1); if (![0, 6].includes(x.getUTCDay())) n++ } return n }

async function yahooCloses(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=1680000000&period2=${Math.floor(Date.now() / 1000)}&interval=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
  if (!r.ok) throw new Error(`Yahoo ${sym} HTTP ${r.status}`)
  const res = (await r.json()).chart.result[0], out = {}
  res.timestamp.forEach((t, i) => { const c = res.indicators.quote[0].close[i]; if (c != null) out[nyDate(t)] = c })
  return out
}

async function fredDates(id, key) {
  const r = await fetch(`https://api.stlouisfed.org/fred/release/dates?release_id=${id}&api_key=${key}&file_type=json&include_release_dates_with_no_data=true&realtime_start=2023-01-01&realtime_end=2027-12-31&sort_order=asc&limit=1000`,
    { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}`)
  return new Set((await r.json()).release_dates.map(x => x.date))
}

async function sbAll(url, key, path) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${f}-${f + 999}` } })
    if (!r.ok) throw new Error(`Supabase ${r.status}`)
    const j = await r.json()
    out.push(...j)
    if (j.length < 1000) return out
  }
}

// ── one-day premium ──────────────────────────────────────────────────────────
function premiumRows(spx, v1d, denom, typesOf) {
  const dates = Object.keys(spx).sort()
  const hist = [], prior = {}, rows = []
  const expectedFor = types => {
    if (!types.length) return 0
    const pooled = Object.values(prior).flat()
    return mean(types.map(t => (prior[t]?.length ?? 0) >= 5 ? mean(prior[t]) : (pooled.length ? mean(pooled) : 0)))
  }
  for (let i = 1; i < dates.length; i++) {
    const E = dates[i], P = dates[i - 1]
    if (E < '2023-04-25' || v1d[P] == null || denom[P] == null) continue
    if ((Date.parse(E) - Date.parse(P)) / 864e5 !== 1) continue
    const types = typesOf(E), ratio = Math.log(v1d[P] / denom[P])
    if (hist.length >= 20) {
      const p = ratio - median(hist.slice(-20)), d = p - expectedFor(types)
      const ret = Math.log(spx[E] / spx[P])
      rows.push({ E, types, p, d, orig: p > LN115, neu: d > LN115, z: Math.abs(ret) / (v1d[P] / 100 / Math.sqrt(252)), ret: ret * 1e4 })
      for (const t of types) (prior[t] ??= []).push(p)
    }
    if (!types.length) hist.push(ratio)
  }
  // Tomorrow's reading from the latest close (no outcome yet).
  const L = dates.at(-1), E = nextBiz(L), types = typesOf(E)
  let next = null
  if (v1d[L] != null && denom[L] != null && hist.length >= 20) {
    const p = Math.log(v1d[L] / denom[L]) - median(hist.slice(-20)), d = p - expectedFor(types)
    next = { session: E, basedOnClose: L, types, premiumPct: round((Math.exp(p) - 1) * 100, 1), vsUsualPct: round((Math.exp(d) - 1) * 100, 1), orig: p > LN115, neu: d > LN115 }
  }
  return { rows, next }
}

function summarize(rows) {
  const g = f => ({
    n: f.length,
    z: round(mean(f.map(r => r.z)), 3),
    retBp: round(mean(f.map(r => r.ret)), 1),
    upPct: f.length ? round(100 * f.filter(r => r.ret > 0).length / f.length, 0) : null,
  })
  const out = {}
  for (const [name, a, b] of [['baseline', '0000', REGISTERED], ['forward', REGISTERED, '9999']]) {
    const s = rows.filter(r => (name === 'baseline' ? r.E <= b : r.E > a))
    out[name] = {
      days: s.length,
      original: { flagged: g(s.filter(r => r.orig)), other: g(s.filter(r => !r.orig)) },
      new: { flagged: g(s.filter(r => r.neu)), other: g(s.filter(r => !r.neu)) },
      macro: g(s.filter(r => r.types.length)),
      ordinary: g(s.filter(r => !r.types.length)),
      // Event days split by the original flag: an event the market did NOT pay up for is information too.
      eventFlagged: g(s.filter(r => r.types.length && r.orig)),
      eventNotFlagged: g(s.filter(r => r.types.length && !r.orig)),
    }
  }
  return out
}

// ── surface kinks ────────────────────────────────────────────────────────────
async function surfaceSection(url, key, macroDates, typesOf, spx) {
  const meta = await sbAll(url, key, 'vol_surface_snapshots?select=id,captured_at&order=captured_at.asc')
  const lastPerDay = new Map()
  for (const m of meta) { const t = ny(m.captured_at); if (t.min >= 570 && t.min <= 960) lastPerDay.set(t.date, m.id) }
  const ids = [...lastPerDay.values()], byId = new Map()
  for (let i = 0; i < ids.length; i += 100) {
    for (const r of await sbAll(url, key, `vol_surface_snapshots?select=id,captured_at,points&id=in.(${ids.slice(i, i + 100).join(',')})`)) byId.set(r.id, r)
  }
  // Yahoo closes: market_data misses days whenever the close cron fails.
  const close = spx, mdDates = Object.keys(spx).sort(), lastMd = mdDates.at(-1)

  const windows = new Map()
  for (const [date, id] of [...lastPerDay.entries()].sort()) {
    const pts = [...(byId.get(id)?.points ?? [])].sort((x, y) => x.T - y.T)
    const W = []
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      if (a.T < 2 / 365 || a.spotIV <= 0.04 || b.spotIV <= 0.04) continue
      const n = bizDays(a.expiration, b.expiration), dv = b.spotIV ** 2 * b.T - a.spotIV ** 2 * a.T
      if (n < 1 || dv <= 0) continue
      const fv = Math.sqrt(dv / n * 252)
      const macro = [...macroDates].filter(E => a.expiration < E && E <= b.expiration)
      const adj = fv / Math.sqrt((n - macro.length + EVENT_VAR_DAYS * macro.length) / n)
      // Neo-vix rows carry the full calendar captured at the time; older rows only the macro dates.
      const events = b.events ?? macro.flatMap(typesOf)
      W.push({ near: a.expiration, far: b.expiration, n, fv, adj, macro: macro.length, events, orig: !!(b.kink && b.T > a.T + 1e-9 && !b.wideSpread && b.T >= 2 / 365) })
    }
    W.forEach((w, i) => {
      const nb = [W[i - 1], W[i + 1]].filter(Boolean)
      w.neu = nb.length === 2 && w.adj / mean(nb.map(x => x.adj)) - 1 > 0.15
      // Keep the latest snapshot taken on or before the window starts.
      if (date <= w.near) windows.set(`${w.near}|${w.far}`, { ...w, snapshotDate: date })
    })
  }

  const scored = [...windows.values()].map(w => {
    if (w.far > lastMd || close[w.near] == null) return { ...w, finished: false }
    const inW = mdDates.filter(d => d > w.near && d <= w.far)
    const rets = inW.map(d => { const j = mdDates.indexOf(d); return j > 0 ? Math.log(close[d] / close[mdDates[j - 1]]) : null }).filter(v => v != null)
    if (!rets.length || close[w.far] == null) return { ...w, finished: false }
    return { ...w, finished: true, ratio: Math.sqrt(mean(rets.map(r => r * r)) * 252) / w.fv, retBp: Math.log(close[w.far] / close[w.near]) * 1e4, days: rets.length }
  })
  const tally = list => {
    const f = list.filter(w => w.finished)
    return { finished: f.length, pending: list.length - f.length, realizedOverImplied: round(mean(f.map(w => w.ratio))), upPct: f.length ? round(100 * f.filter(w => w.retBp > 0).length / f.length, 0) : null, bpPerDay: round(mean(f.map(w => w.retBp / w.days)), 1) }
  }
  const groups = list => ({
    original: tally(list.filter(w => w.orig)),
    new: tally(list.filter(w => w.neu)),
    event: tally(list.filter(w => w.macro > 0)),
    eventKink: tally(list.filter(w => w.macro > 0 && w.orig)),
    eventNoKink: tally(list.filter(w => w.macro > 0 && !w.orig)),
    ordinary: tally(list.filter(w => !w.orig && !w.neu && w.macro === 0)),
  })
  const flagged = scored.filter(w => w.orig || w.neu).sort((a, b) => b.near.localeCompare(a.near)).slice(0, 25).map(w => ({
    near: w.near, far: w.far, snapshotDate: w.snapshotDate, rules: [w.orig && 'original', w.neu && 'new'].filter(Boolean),
    events: w.events, forwardVolPct: round(w.fv * 100, 1), finished: w.finished,
    realizedOverImplied: w.finished ? round(w.ratio) : null, retBp: w.finished ? round(w.retBp, 0) : null,
  }))
  return {
    dataThrough: lastMd,
    baseline: groups(scored.filter(w => w.snapshotDate <= REGISTERED)),
    forward: groups(scored.filter(w => w.snapshotDate > REGISTERED)),
    flagged,
  }
}

export async function computeScorecard({ supabaseUrl, supabaseKey, fredKey }) {
  const [spx, v1d, vix, v9d, CPI, NFP] = await Promise.all([
    yahooCloses('^GSPC'), yahooCloses('^VIX1D'), yahooCloses('^VIX'), yahooCloses('^VIX9D'),
    fredDates(10, fredKey), fredDates(50, fredKey),
  ])
  const typesOf = d => [FOMC.has(d) && 'FOMC', CPI.has(d) && 'CPI', NFP.has(d) && 'NFP'].filter(Boolean)
  const oneDay = {}
  for (const [name, denom] of [['vix', vix], ['vix9d', v9d]]) {
    const { rows, next } = premiumRows(spx, v1d, denom, typesOf)
    oneDay[name] = { ...summarize(rows), next }
  }
  const macroDates = new Set([...FOMC, ...CPI, ...NFP].filter(d => d >= '2026-06-01'))
  return {
    computedAt: new Date().toISOString(),
    registered: REGISTERED,
    thresholds: { forwardMinDays: FORWARD_MIN_DAYS, forwardMinWindows: FORWARD_MIN_WINDOWS },
    oneDayDataThrough: Object.keys(spx).sort().at(-1),
    oneDay,
    surface: await surfaceSection(supabaseUrl, supabaseKey, macroDates, typesOf, spx),
  }
}
