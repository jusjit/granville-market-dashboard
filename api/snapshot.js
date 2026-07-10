// Twice-daily dashboard snapshot: recomputes Granville signals + macro states
// server-side, upserts into dashboard_snapshots, and (on type=close) upserts
// the day's SPX/VIX OHLC into market_data for the Alma rules engine.
// Auth: Authorization: Bearer <SNAPSHOT_SECRET>. Trigger: GitHub Actions cron.

// ── Granville signal definitions (mirror src/lib/signals.js) ────────────────
const SIGNAL_DEFS = [
  { id: 'breadth', numerator: 'RSP', denominator: 'SPY', neutralBand: 0.005, doubleWeight: true },
  { id: 'defensive', numerator: 'XLP', denominator: 'XLY', neutralBand: 0.005, inverted: true },
  { id: 'credit', numerator: 'HYG', denominator: 'LQD', neutralBand: 0.005 },
  { id: 'bellwether', numerator: 'SOXX', denominator: 'SPY', neutralBand: 0.005 },
  { id: 'volatility', isAbsolute: true, absoluteBull: 17, absoluteBear: 25, inverted: true },
  { id: 'riskAppetite', numerator: 'SPHB', denominator: 'SPLV', neutralBand: 0.005 },
  { id: 'transport', numerator: 'IYT', denominator: 'SPY', neutralBand: 0.003 },
]
const MAX_RAW = 160

// snapshot column prefix per signal id
const COL_PREFIX = {
  breadth: 'breadth', defensive: 'defensive', credit: 'credit',
  bellwether: 'bellwether', volatility: 'volatility',
  riskAppetite: 'risk_appetite', transport: 'transport',
}

async function finnhubQuotes(symbols, key) {
  const out = {}
  await Promise.all(symbols.map(async sym => {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`)
    if (!r.ok) return
    const d = await r.json()
    if (d.c && d.pc) out[sym] = { price: d.c, prevClose: d.pc }
  }))
  return out
}

async function tradierQuotes(symbols, key) {
  const r = await fetch(`https://api.tradier.com/v1/markets/quotes?symbols=${symbols.join(',')}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Tradier ${r.status}`)
  let q = (await r.json())?.quotes?.quote ?? []
  if (!Array.isArray(q)) q = [q]
  const out = {}
  for (const item of q) out[item.symbol] = item
  return out
}

async function fredLatest(seriesIds, key) {
  const out = {}
  await Promise.all(seriesIds.map(async id => {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=10`
    const r = await fetch(url)
    if (!r.ok) return
    const obs = (await r.json()).observations?.filter(o => o.value !== '.').map(o => parseFloat(o.value))
    if (obs?.length) out[id] = obs // [latest, prev, ...]
  }))
  return out
}

function directionState(current, prev, upLabel, stableLabel, downLabel, threshold = 0.05) {
  if (prev == null) return stableLabel
  const delta = current - prev
  if (delta > threshold) return upLabel
  if (delta < -threshold) return downLabel
  return stableLabel
}

function vixLevelState(price) {
  if (price < 15) return 'Complacent'
  if (price < 20) return 'Calm'
  if (price < 28) return 'Elevated'
  return 'Fear'
}

function nyDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

async function supabaseUpsert(table, row, onConflict) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const r = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([row]),
  })
  if (!r.ok) throw new Error(`Supabase ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

export default async function handler(req, res) {
  const secret = process.env.SNAPSHOT_SECRET
  if (!secret) return res.status(500).json({ error: 'SNAPSHOT_SECRET not configured' })
  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' })

  const type = req.query.type
  if (type !== 'premarket' && type !== 'close') {
    return res.status(400).json({ error: '?type must be premarket or close' })
  }

  const finnhubKey = process.env.FINNHUB_KEY
  const tradierKey = process.env.TRADIER_KEY
  const fredKey = process.env.FRED_KEY

  try {
    const etfSymbols = ['RSP', 'SPY', 'XLP', 'XLY', 'HYG', 'LQD', 'SOXX', 'SPHB', 'SPLV', 'IYT', 'UUP', 'IWM']
    const [etf, idx, fred] = await Promise.all([
      finnhubQuotes(etfSymbols, finnhubKey),
      tradierQuotes(['VIX', 'VIX3M', 'SPX'], tradierKey),
      fredLatest(['BAMLH0A0HYM2', 'DFII10', 'T5YIFR', 'DGS10'], fredKey),
    ])

    // ── Granville signals (same scoring as src/lib/signals.js) ─────────────
    const snap = {}
    let rawTotal = 0
    let breadthPct = null
    for (const def of SIGNAL_DEFS) {
      const prefix = COL_PREFIX[def.id]
      let pctChange = null, score, reading
      if (def.isAbsolute) {
        const vix = idx.VIX
        if (!vix?.last) { score = 10; reading = 'Neutral' }
        else {
          pctChange = vix.prevclose ? ((vix.last - vix.prevclose) / vix.prevclose) * 100 : null
          score = vix.last <= def.absoluteBull ? 20 : vix.last >= def.absoluteBear ? 0 : 10
          reading = score === 20 ? 'Bullish' : score === 0 ? 'Bearish' : 'Neutral'
        }
      } else {
        const num = etf[def.numerator], den = etf[def.denominator]
        if (!num || !den) { score = def.doubleWeight ? 20 : 10; reading = 'Neutral' }
        else {
          const ratioNow = num.price / den.price
          const ratioPrev = num.prevClose / den.prevClose
          const pct = ratioPrev !== 0 ? (ratioNow - ratioPrev) / ratioPrev : 0
          pctChange = pct * 100
          const eff = def.inverted ? -pct : pct
          if (eff > def.neutralBand) score = def.doubleWeight ? 40 : 20
          else if (eff < -def.neutralBand) score = 0
          else score = def.doubleWeight ? 20 : 10
          const bull = def.doubleWeight ? 40 : 20
          reading = score === bull ? 'Bullish' : score === 0 ? 'Bearish' : 'Neutral'
        }
      }
      rawTotal += score
      if (def.id === 'breadth') breadthPct = pctChange
      snap[`${prefix}_reading`] = reading
      snap[`${prefix}_pct_change`] = pctChange
    }

    const spy = etf.SPY
    const spyRising = spy ? spy.price > spy.prevClose : false
    const divergence = spyRising && breadthPct != null && breadthPct < 0
    let composite = Math.round((rawTotal / MAX_RAW) * 100)
    if (divergence && composite > 60) composite = 60
    const phase = composite >= 67 ? 'Bull' : composite <= 33 ? 'Bear' : 'Transitional'

    // ── Macro states ────────────────────────────────────────────────────────
    const vix = idx.VIX, vix3m = idx.VIX3M
    snap.vix_level = vix?.last ?? null
    snap.vix_state = vix?.last != null ? vixLevelState(vix.last) : null
    if (vix?.last != null && vix3m?.last != null) {
      const ratio = vix.last / vix3m.last
      snap.vix_term_structure = ratio
      snap.vix_term_state = ratio > 1.0 ? 'Backwardation' : ratio < 0.92 ? 'Steep Contango' : 'Contango'
    } else { snap.vix_term_structure = null; snap.vix_term_state = null }

    const uup = etf.UUP
    if (uup) {
      const pct = ((uup.price - uup.prevClose) / uup.prevClose) * 100
      snap.dollar_pct_change = pct
      snap.dollar_state = pct > 0.3 ? 'Strengthening' : pct < -0.3 ? 'Weakening' : 'Stable'
    } else { snap.dollar_pct_change = null; snap.dollar_state = null }

    const iwm = etf.IWM
    if (iwm && spy) {
      const rNow = iwm.price / spy.price, rPrev = iwm.prevClose / spy.prevClose
      const pct = rPrev !== 0 ? ((rNow - rPrev) / rPrev) * 100 : 0
      snap.small_large_cap_state = pct > 0.3 ? 'Outperforming' : pct < -0.3 ? 'Underperforming' : 'Inline'
    } else { snap.small_large_cap_state = null }

    const hy = fred.BAMLH0A0HYM2, ry = fred.DFII10, inf = fred.T5YIFR, nom = fred.DGS10
    snap.hy_spread = hy?.[0] ?? null
    snap.hy_spread_state = hy ? directionState(hy[0], hy[1], 'Widening', 'Stable', 'Tightening', 0.05) : null
    snap.real_yield = ry?.[0] ?? null
    snap.real_yield_state = ry ? directionState(ry[0], ry[1], 'Rising', 'Stable', 'Falling', 0.03) : null
    snap.inflation_fwd = inf?.[0] ?? null
    snap.inflation_fwd_state = inf ? directionState(inf[0], inf[1], 'Rising', 'Stable', 'Falling', 0.03) : null
    if (nom && ry) {
      const be = nom[0] - ry[0]
      const bePrev = nom[1] != null && ry[1] != null ? nom[1] - ry[1] : null
      snap.breakeven_inflation = be
      snap.breakeven_state = directionState(be, bePrev, 'Rising', 'Stable', 'Falling', 0.03)
    } else { snap.breakeven_inflation = null; snap.breakeven_state = null }

    const date = nyDate()
    const row = {
      date, snapshot_time: type,
      composite_score: composite, market_phase: phase,
      divergence_warning: divergence, spy_price: spy?.price ?? null,
      ...snap,
    }
    await supabaseUpsert('dashboard_snapshots', row, 'date,snapshot_time')

    // ── market_data upsert (close only — full day's OHLC is final) ─────────
    if (type === 'close') {
      const spx = idx.SPX, vixQ = idx.VIX
      if (spx?.open != null && vixQ?.open != null) {
        await supabaseUpsert('market_data', {
          date,
          spx_open: spx.open, spx_high: spx.high, spx_low: spx.low, spx_close: spx.last,
          spx_prev_close: spx.prevclose,
          spx_gap_pct: spx.prevclose ? ((spx.open - spx.prevclose) / spx.prevclose) * 100 : null,
          vix_open: vixQ.open, vix_high: vixQ.high, vix_low: vixQ.low, vix_close: vixQ.last,
          vix_prev_close: vixQ.prevclose,
          vix_gap_pct: vixQ.prevclose ? ((vixQ.open - vixQ.prevclose) / vixQ.prevclose) * 100 : null,
        }, 'date')
      }
    }

    return res.status(200).json({ success: true, date, snapshot_time: type, composite_score: composite })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}
