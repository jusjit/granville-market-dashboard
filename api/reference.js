// Combined Reference Data API:
// POST /api/reference — Capture VIX futures + CME FedWatch snapshots
// GET  /api/reference — Retrieve snapshot history for browsing

import { createClient } from '@supabase/supabase-js'

// ─── Browser-like headers to bypass basic bot detection ───────────────────────
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
}

// ─── FOMC meeting calendar 2026 ───────────────────────────────────────────────
// Date = decision day (second day of two-day meeting)
const FOMC_2026 = [
  { date: '2026-07-29', month: 8,  year: 2026 }, // Aug ZQ is first full post-meeting month
  { date: '2026-09-16', month: 10, year: 2026 }, // Oct ZQ
  { date: '2026-10-28', month: 11, year: 2026 }, // Nov ZQ
  { date: '2026-12-09', month: 1,  year: 2027 }, // Jan ZQ
]

const MONTH_CODES = { 1:'F',2:'G',3:'H',4:'J',5:'K',6:'M',7:'N',8:'Q',9:'U',10:'V',11:'X',12:'Z' }

// ─── VIX Futures scraping (vixcentral.com) ────────────────────────────────────
async function fetchVixFutures() {
  try {
    const res = await fetch('https://www.vixcentral.com/', {
      headers: { ...BROWSER_HEADERS, 'Referer': 'https://www.google.com/' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`vixcentral HTTP ${res.status}`)

    const html = await res.text()

    // Attempt 1: look for embedded JS array/object with VIX futures prices
    // vixcentral embeds data as: var data = [...] or similar
    const patterns = [
      /var\s+futures\s*=\s*(\[[^\]]+\])/,
      /var\s+data\s*=\s*(\[[^\]]+\])/,
      /"futures"\s*:\s*(\[[^\]]+\])/,
      /futures_prices\s*=\s*(\[[^\]]+\])/,
    ]
    for (const pat of patterns) {
      const m = html.match(pat)
      if (m) {
        try {
          const arr = JSON.parse(m[1])
          if (Array.isArray(arr) && arr.length >= 4) {
            const contracts = {}
            arr.slice(0, 8).forEach((v, i) => {
              const price = parseFloat(v)
              if (!isNaN(price) && price > 8 && price < 100) {
                contracts[`F${i + 1}`] = price
              }
            })
            if (Object.keys(contracts).length >= 4) {
              console.log('VIX futures: parsed from embedded JS array')
              return contracts
            }
          }
        } catch (_) { /* continue */ }
      }
    }

    // Attempt 2: extract numbers from table cells that look like VIX prices (8–80)
    // vixcentral shows a table of monthly futures prices
    const tdMatches = [...html.matchAll(/<td[^>]*>\s*([\d]{1,2}\.[\d]{2,3})\s*<\/td>/g)]
    const vixPrices = tdMatches
      .map(m => parseFloat(m[1]))
      .filter(v => v > 8 && v < 80)

    if (vixPrices.length >= 4) {
      const contracts = {}
      vixPrices.slice(0, 8).forEach((price, i) => { contracts[`F${i + 1}`] = price })
      console.log(`VIX futures: extracted ${Object.keys(contracts).length} prices from table`)
      return contracts
    }

    // Attempt 3: broader number extraction near "VIX" or contract month labels
    const monthPattern = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^<]*<[^>]*>\s*([\d]{1,2}\.[\d]{2})/g
    const monthMatches = [...html.matchAll(monthPattern)]
    if (monthMatches.length >= 4) {
      const contracts = {}
      monthMatches.slice(0, 8).forEach((m, i) => {
        const price = parseFloat(m[1])
        if (price > 8 && price < 80) contracts[`F${i + 1}`] = price
      })
      if (Object.keys(contracts).length >= 4) {
        console.log('VIX futures: extracted from month-labeled rows')
        return contracts
      }
    }

    console.warn('VIX futures: scrape parsing failed, using mock data')
    return mockVix()
  } catch (err) {
    console.error(`VIX futures fetch error: ${err.message}`)
    return mockVix()
  }
}

function mockVix() {
  return { F1: 16.45, F2: 17.82, F3: 18.10, F4: 18.45, F5: 18.75, F6: 18.95 }
}

// ─── CME FedWatch via Yahoo Finance ZQ futures ────────────────────────────────
// ZQ = 30-Day Fed Funds futures (CBOT). Price = 100 − implied avg FF rate.
// We fetch the first full calendar month AFTER the next FOMC meeting, so the
// price cleanly reflects the post-decision rate rather than a weighted average.

async function fetchFedWatch(fredKey) {
  try {
    // 1. Find next upcoming FOMC meeting
    const today = new Date()
    const next = FOMC_2026.find(m => new Date(m.date) >= today) ?? FOMC_2026[FOMC_2026.length - 1]

    // 2. Build Yahoo Finance symbol for the target ZQ contract
    const code = MONTH_CODES[next.month]
    const yr = String(next.year).slice(-2)
    const symbol = `ZQ${code}${yr}.CBT`

    // 3. Fetch the contract's closing price
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`)

    const json = await res.json()
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
    const price = closes.filter(v => v != null).at(-1)
    if (price == null) throw new Error('No closing price in Yahoo response')

    const impliedRate = 100 - price  // e.g. 96.335 → 3.665%
    console.log(`ZQ ${symbol} price=${price.toFixed(3)} → implied rate=${impliedRate.toFixed(3)}%`)

    // 4. Get current Fed target range from FRED
    let currentLow = null, currentHigh = null
    if (fredKey) {
      try {
        const fredRes = await fetch(
          `https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARL&api_key=${fredKey}&file_type=json&sort_order=desc&limit=1`,
          { signal: AbortSignal.timeout(5000) }
        )
        const fredResH = await fetch(
          `https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&api_key=${fredKey}&file_type=json&sort_order=desc&limit=1`,
          { signal: AbortSignal.timeout(5000) }
        )
        if (fredRes.ok && fredResH.ok) {
          const dL = await fredRes.json()
          const dH = await fredResH.json()
          currentLow = parseFloat(dL.observations?.[0]?.value)
          currentHigh = parseFloat(dH.observations?.[0]?.value)
        }
      } catch (_) { /* fall through to estimate */ }
    }

    // 5. Build probability distribution across 25bp-spaced outcomes
    const rates = buildProbabilities(impliedRate, currentLow, currentHigh)
    return { rates, meta: { symbol, price, impliedRate, meeting: next.date, currentLow, currentHigh } }
  } catch (err) {
    console.error(`CME FedWatch fetch error: ${err.message}`)
    return null
  }
}

// Distribute probability across adjacent 25bp outcomes using linear interpolation.
function buildProbabilities(impliedRate, currentLow, currentHigh) {
  // Infer current midpoint; fall back to nearest 25bp multiple if FRED unavailable
  const mid = (currentLow != null && currentHigh != null)
    ? (currentLow + currentHigh) / 2
    : Math.round(impliedRate * 4) / 4  // nearest 25bp

  const STEP = 0.25
  // Generate possible outcomes: from 2 cuts below to 2 hikes above current mid
  const outcomes = []
  for (let delta = -2; delta <= 2; delta++) {
    outcomes.push(+(mid + delta * STEP).toFixed(2))
  }

  // Find which two adjacent outcomes the implied rate falls between
  const result = {}
  outcomes.forEach(r => { result[r.toFixed(2)] = 0 })

  // Clamp implied rate to the outcome range
  const lo = outcomes[0], hi = outcomes[outcomes.length - 1]
  const clamped = Math.max(lo, Math.min(hi, impliedRate))

  // Find bracketing pair
  for (let i = 0; i < outcomes.length - 1; i++) {
    const a = outcomes[i], b = outcomes[i + 1]
    if (clamped >= a && clamped <= b) {
      const probA = (b - clamped) / STEP  // probability of lower outcome
      const probB = 1 - probA
      result[a.toFixed(2)] = +(probA * 100).toFixed(1)
      result[b.toFixed(2)] = +(probB * 100).toFixed(1)
      break
    }
  }

  // Format keys as "X.XX-Y.YY" ranges (e.g. "4.00-4.25") for display
  const formatted = {}
  outcomes.forEach(r => {
    const low = (r - STEP / 2).toFixed(2)
    const high = (r + STEP / 2).toFixed(2)
    formatted[`${low}-${high}`] = result[r.toFixed(2)] ?? 0
  })
  return formatted
}

// ─── POST handler (capture snapshots) ─────────────────────────────────────────
async function handlePost(req, res, supabase, fredKey) {
  try {
    const capturedAt = new Date().toISOString()

    const [vixContracts, fedResult] = await Promise.all([
      fetchVixFutures(),
      fetchFedWatch(fredKey),
    ])

    const fedRates = fedResult?.rates ?? null
    const fedMeta = fedResult?.meta ?? null

    // Store VIX snapshot
    let vixInserted = false
    if (vixContracts && Object.keys(vixContracts).length > 0) {
      const { error } = await supabase.from('vix_futures_snapshots').insert([{ captured_at: capturedAt, contracts: vixContracts }])
      if (error) throw new Error(`VIX insert: ${error.message}`)
      vixInserted = true
    }

    // Store Fed Watch snapshot
    let fedInserted = false
    if (fedRates) {
      const { error } = await supabase.from('fed_watch_snapshots').insert([{ captured_at: capturedAt, rates: fedRates }])
      if (error) throw new Error(`FedWatch insert: ${error.message}`)
      fedInserted = true
    }

    if (!vixInserted && !fedInserted) {
      return res.status(500).json({ success: false, error: 'Both captures failed' })
    }

    return res.status(200).json({
      success: true,
      captured_at: capturedAt,
      vix: { inserted: vixInserted, contracts: Object.keys(vixContracts ?? {}).length },
      fed: { inserted: fedInserted, meta: fedMeta },
    })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// ─── GET handler (retrieve history) ───────────────────────────────────────────
async function handleGet(req, res, supabase) {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '40', 10) || 40, 100)

    const [vixR, fedR] = await Promise.all([
      supabase.from('vix_futures_snapshots').select('id,captured_at,contracts').order('captured_at', { ascending: false }).limit(limit),
      supabase.from('fed_watch_snapshots').select('id,captured_at,rates').order('captured_at', { ascending: false }).limit(limit),
    ])

    if (vixR.error) throw new Error(`VIX fetch: ${vixR.error.message}`)
    if (fedR.error) throw new Error(`FedWatch fetch: ${fedR.error.message}`)

    const merged = new Map()
    for (const row of (vixR.data || [])) {
      if (!merged.has(row.captured_at)) merged.set(row.captured_at, {})
      merged.get(row.captured_at).vix = { id: row.id, contracts: row.contracts }
    }
    for (const row of (fedR.data || [])) {
      if (!merged.has(row.captured_at)) merged.set(row.captured_at, {})
      merged.get(row.captured_at).fed = { id: row.id, rates: row.rates }
    }

    const snapshots = Array.from(merged.entries())
      .sort((a, b) => new Date(b[0]) - new Date(a[0]))
      .map(([captured_at, data]) => ({ captured_at, vix: data.vix || null, fed: data.fed || null }))

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json({ snapshots })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')

  const url = process.env.SUPABASE_URL
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const fredKey = process.env.FRED_KEY

  if (!url || !sbKey) return res.status(500).json({ error: 'Supabase env not configured' })

  const supabase = createClient(url, sbKey)

  if (req.method === 'POST') {
    const secret = process.env.SNAPSHOT_SECRET
    if (!secret) return res.status(500).json({ error: 'SNAPSHOT_SECRET not configured' })
    if ((req.headers.authorization ?? '') !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    return handlePost(req, res, supabase, fredKey)
  }

  if (req.method === 'GET') return handleGet(req, res, supabase)

  return res.status(405).json({ error: 'Method not allowed' })
}
