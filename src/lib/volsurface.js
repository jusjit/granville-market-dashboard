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

// Attach event labels from the dynamic calendar returned by /api/tradier.
// An expiry "covers" events after the previous expiry up to its own date.
export function annotateEvents(points, events = []) {
  return points.map((p, i) => {
    const prev = i > 0 ? points[i - 1].expiration : '1970-01-01'
    const matched = events
      .filter(e => e.date > prev && e.date <= p.expiration)
      .map(e => e.label)
    return { ...p, events: [...new Set(matched)] }
  })
}
