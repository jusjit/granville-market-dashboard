export async function fetchGeoRegime() {
  const res = await fetch('/api/aggregate-geo-regime')
  if (!res.ok) throw new Error(`Geo regime: HTTP ${res.status}`)
  return res.json()
}
