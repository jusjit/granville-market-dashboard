// Client-side fetch wrapper for VIX futures and CME FedWatch snapshots

export async function fetchReferenceHistory(limit = 40) {
  const url = `/api/reference-history?limit=${limit}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Reference history: HTTP ${r.status}`)
  const data = await r.json()
  if (data.error) throw new Error(data.error)
  return data.snapshots || []
}
