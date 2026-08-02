export async function fetchGeoRegime(window = 30) {
  const url = window ? `/api/aggregate-geo-regime?window=${window}` : '/api/aggregate-geo-regime'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Geo regime: HTTP ${res.status}`)
  return res.json()
}
