// Returns recent vol-surface snapshots (newest first) for the history slider.
// Small payload: ~4 snapshots/day × a few days, each ~12 expiry points.
export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Supabase not configured' })
  const limit = Math.min(parseInt(req.query.limit ?? '40', 10) || 40, 100)
  try {
    const r = await fetch(
      `${url}/rest/v1/vol_surface_snapshots?select=id,captured_at,spot,points&order=captured_at.desc&limit=${limit}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!r.ok) throw new Error(`Supabase ${r.status}`)
    const rows = await r.json()
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json({ snapshots: rows })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
