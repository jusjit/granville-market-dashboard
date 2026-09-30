// Client-side fetch wrapper for VIX futures and CME FedWatch snapshots
// Consolidated endpoint: /api/reference (GET for history, POST for capture)

export async function fetchReferenceHistory(limit = 40) {
  const url = `/api/reference?limit=${limit}`
  const r = await fetch(url, { method: 'GET' })
  if (!r.ok) throw new Error(`Reference history: HTTP ${r.status}`)
  const data = await r.json()
  if (data.error) throw new Error(data.error)
  return data.snapshots || []
}

// Returns the latest snapshot formatted for ReferenceDataPanel: { vix, fed }
export async function fetchReferenceLatest() {
  const snapshots = await fetchReferenceHistory(1)
  const snap = snapshots[0]
  if (!snap) return null
  return {
    vix: snap.vix ? { contracts: snap.vix.contracts } : null,
    fed: snap.fed ? { rates: snap.fed.rates }  : null,
  }
}

export async function fetchOvernightContext() {
  const r = await fetch('/api/reference?type=overnight')
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error ?? `Overnight context: HTTP ${r.status}`)
  return data
}
