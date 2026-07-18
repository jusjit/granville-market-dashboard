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
