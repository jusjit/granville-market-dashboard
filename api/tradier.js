// Live SPX ATM implied-vol term structure. Computation lives in the shared
// core (lib/volSurfaceCore.mjs) so the snapshot cron produces identical data.
import { computeVolSurface, lastVolSnapshot } from '../lib/volSurfaceCore.mjs'

// SPX mega-caps whose earnings can move the index enough to show a vol kink.
const EARNINGS_TICKERS = new Set([
  'AAPL','MSFT','AMZN','GOOGL','GOOG','META','NVDA','TSLA','BRK.B',
  'UNH','JPM','V','JNJ','XOM','PG','MA','HD','AVGO','LLY','MRK',
])

// Hardcoded calendars — these orgs publish schedules years ahead but have no FRED release.
const FOMC_DATES = [
  '2026-07-29','2026-09-16','2026-10-28','2026-12-09',
  '2027-01-27','2027-03-17','2027-04-28','2027-06-16',
  '2027-07-28','2027-09-15','2027-10-27','2027-12-08',
]

// ISM Manufacturing PMI — 1st business day of month (ismworld.org)
const ISM_MFG_DATES = [
  '2026-08-03','2026-09-01','2026-10-01','2026-11-02','2026-12-01',
  '2027-01-04','2027-02-01','2027-03-01','2027-04-01','2027-05-03',
  '2027-06-01','2027-07-01','2027-08-02','2027-09-01','2027-10-01',
  '2027-11-01','2027-12-01',
]

// ISM Services PMI — 3rd business day of month (ismworld.org)
const ISM_SVC_DATES = [
  '2026-08-05','2026-09-03','2026-10-05','2026-11-04','2026-12-03',
  '2027-01-06','2027-02-03','2027-03-03','2027-04-05','2027-05-05',
  '2027-06-03','2027-07-06','2027-08-04','2027-09-03','2027-10-05',
  '2027-11-03','2027-12-03',
]

async function fetchEventCalendar(fredKey, finnhubKey) {
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 75 * 86400000).toISOString().slice(0, 10)
  const events = []

  const hardcoded = [
    [FOMC_DATES, 'FOMC'],
    [ISM_MFG_DATES, 'ISM-M'],
    [ISM_SVC_DATES, 'ISM-S'],
  ]
  for (const [dates, label] of hardcoded) {
    for (const d of dates) {
      if (d >= today && d <= horizon) events.push({ date: d, label })
    }
  }

  const fetches = []

  // FRED economic release calendars
  if (fredKey) {
    const fredReleases = [
      { id: 10, label: 'CPI' },
      { id: 50, label: 'NFP' },
      { id: 9,  label: 'Retail' },
      { id: 54, label: 'PCE' },
      { id: 91, label: 'UMich' },
      { id: 192, label: 'JOLTS' },
      { id: 291, label: 'Homes' },
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
