// Live SPX ATM implied-vol term structure. Computation lives in the shared
// core (lib/volSurfaceCore.mjs) so the snapshot cron produces identical data.
import { computeVolSurface, lastVolSnapshot } from '../lib/volSurfaceCore.mjs'

// SPX mega-caps whose earnings can move the index enough to show a vol kink.
const EARNINGS_TICKERS = new Set([
  'AAPL','MSFT','AMZN','GOOGL','GOOG','META','NVDA','TSLA','BRK.B',
  'UNH','JPM','V','JNJ','XOM','PG','MA','HD','AVGO','LLY','MRK',
])

// FOMC decision dates — Fed publishes years ahead; no FRED release for meeting days.
// Only need ~12 months from today; the FRED releases cover CPI/NFP dynamically.
const FOMC_DATES = [
  '2026-07-29','2026-09-16','2026-10-28','2026-12-09',
  '2027-01-27','2027-03-17','2027-04-28','2027-06-16',
  '2027-07-28','2027-09-15','2027-10-27','2027-12-08',
]

async function fetchEventCalendar(fredKey, finnhubKey) {
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 75 * 86400000).toISOString().slice(0, 10)
  const events = []

  // FOMC dates (hardcoded — FRED doesn't expose meeting dates as a release)
  for (const d of FOMC_DATES) {
    if (d >= today && d <= horizon) events.push({ date: d, label: 'FOMC' })
  }

  const fetches = []

  // FRED: CPI (release_id=10) and NFP (release_id=50)
  if (fredKey) {
    const fredReleases = [
      { id: 10, label: 'CPI' },
      { id: 50, label: 'NFP' },
    ]
    for (const rel of fredReleases) {
      fetches.push(
        fetch(`https://api.stlouisfed.org/fred/release/dates?release_id=${rel.id}&api_key=${fredKey}&file_type=json&include_release_dates_with_no_data=true&sort_order=asc&realtime_start=${today}&realtime_end=${horizon}&limit=10`,
          { signal: AbortSignal.timeout(5000) })
          .then(r => r.json())
          .then(data => {
            for (const d of (data.release_dates ?? [])) {
              if (d.date >= today && d.date <= horizon) events.push({ date: d.date, label: rel.label })
            }
          })
          .catch(err => console.warn(`FRED release ${rel.label} fetch failed: ${err.message}`))
      )
    }
  }

  // Finnhub: earnings for SPX mega-caps
  if (finnhubKey) {
    fetches.push(
      fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${horizon}&token=${finnhubKey}`,
        { signal: AbortSignal.timeout(5000) })
        .then(r => r.json())
        .then(data => {
          for (const e of (data.earningsCalendar ?? [])) {
            if (EARNINGS_TICKERS.has(e.symbol) && e.date >= today && e.date <= horizon) {
              events.push({ date: e.date, label: e.symbol })
            }
          }
        })
        .catch(err => console.warn(`Finnhub earnings fetch failed: ${err.message}`))
    )
  }

  await Promise.allSettled(fetches)
  events.sort((a, b) => a.date.localeCompare(b.date))
  return events
}

export default async function handler(req, res) {
  const key = process.env.TRADIER_KEY
  if (!key) return res.status(500).json({ error: 'TRADIER_KEY not configured' })
  try {
    const prev = await lastVolSnapshot() // for >20% jump detection
    const [result, events] = await Promise.all([
      computeVolSurface(key, prev),
      fetchEventCalendar(process.env.FRED_KEY, process.env.FINNHUB_KEY).catch(() => []),
    ])
    result.events = events
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json(result)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
