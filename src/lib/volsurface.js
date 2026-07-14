export async function fetchVolSurface() {
  const res = await fetch('/api/tradier')
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `tradier API ${res.status}`)
  }
  return res.json()
}

// Recent persisted snapshots for the history slider (newest first).
export async function fetchVolHistory() {
  const res = await fetch('/api/vol-history')
  if (!res.ok) throw new Error(`vol-history ${res.status}`)
  const data = await res.json()
  return data.snapshots ?? []
}

// Hardcoded 2026 recurring macro events (approximate standard schedule).
// FOMC = decision day (second day of meeting); NFP = first Friday; CPI ≈ mid-month.
const EVENTS_2026 = [
  { date: '2026-01-28', label: 'FOMC' }, { date: '2026-03-18', label: 'FOMC' },
  { date: '2026-04-29', label: 'FOMC' }, { date: '2026-06-17', label: 'FOMC' },
  { date: '2026-07-29', label: 'FOMC' }, { date: '2026-09-16', label: 'FOMC' },
  { date: '2026-10-28', label: 'FOMC' }, { date: '2026-12-09', label: 'FOMC' },
  { date: '2026-01-02', label: 'NFP' }, { date: '2026-02-06', label: 'NFP' },
  { date: '2026-03-06', label: 'NFP' }, { date: '2026-04-03', label: 'NFP' },
  { date: '2026-05-01', label: 'NFP' }, { date: '2026-06-05', label: 'NFP' },
  { date: '2026-07-03', label: 'NFP' }, { date: '2026-08-07', label: 'NFP' },
  { date: '2026-09-04', label: 'NFP' }, { date: '2026-10-02', label: 'NFP' },
  { date: '2026-11-06', label: 'NFP' }, { date: '2026-12-04', label: 'NFP' },
  { date: '2026-01-13', label: 'CPI' }, { date: '2026-02-11', label: 'CPI' },
  { date: '2026-03-11', label: 'CPI' }, { date: '2026-04-14', label: 'CPI' },
  { date: '2026-05-12', label: 'CPI' }, { date: '2026-06-10', label: 'CPI' },
  { date: '2026-07-14', label: 'CPI' }, { date: '2026-08-12', label: 'CPI' },
  { date: '2026-09-11', label: 'CPI' }, { date: '2026-10-13', label: 'CPI' },
  { date: '2026-11-12', label: 'CPI' }, { date: '2026-12-10', label: 'CPI' },
]

// Attach event labels: an expiry "covers" events after the previous expiry
// up to and including its own date.
export function annotateEvents(points) {
  return points.map((p, i) => {
    const prev = i > 0 ? points[i - 1].expiration : '1970-01-01'
    const events = EVENTS_2026
      .filter(e => e.date > prev && e.date <= p.expiration)
      .map(e => e.label)
    return { ...p, events: [...new Set(events)] }
  })
}
