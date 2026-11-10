// Combined vol-surface API:
// POST /api/vol-history — Capture a vol surface snapshot (cron target, Bearer auth)
// GET  /api/vol-history — Return recent snapshots for the history slider
import { computeVolSurface, lastVolSnapshot } from '../lib/volSurfaceCore.mjs'
import { fetchEventCalendar } from './tradier.js'

// Neo-vix rows hold every expiry out to 45 days. The slider compares against the live curve
// (first 4 + Fridays), so thin to that set and recompute forwards across the kept expiries.
function sliderPoints(points) {
  if (!points?.some(p => p.src === 'neo')) return points
  const kept = points
    .filter((p, i) => i < 4 || new Date(`${p.expiration}T12:00:00Z`).getUTCDay() === 5)
    .slice(0, 12)
    .map(p => ({ ...p }))
  kept.forEach((p, i) => {
    const a = kept[i - 1]
    const num = a ? p.spotIV ** 2 * p.T - a.spotIV ** 2 * a.T : null
    p.forwardIV = a && p.T > a.T && num > 0 ? Math.sqrt(num / (p.T - a.T)) : null
    p.forwardNearExp = a?.expiration ?? null
    p.forwardFarExp = a ? p.expiration : null
    p.ivGap = p.forwardIV != null ? +(p.forwardIV - p.spotIV).toFixed(6) : null
  })
  return kept
}

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !sbKey) return res.status(500).json({ error: 'Supabase not configured' })

  // POST — capture snapshot (cron / workflow_dispatch)
  if (req.method === 'POST') {
    const secret = process.env.SNAPSHOT_SECRET
    if (!secret) return res.status(500).json({ error: 'SNAPSHOT_SECRET not configured' })
    if ((req.headers.authorization ?? '') !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const tradierKey = process.env.TRADIER_KEY
    if (!tradierKey) return res.status(500).json({ error: 'TRADIER_KEY not configured' })

    try {
      const prev = await lastVolSnapshot()
      const surface = await computeVolSurface(tradierKey, prev)
      const row = { captured_at: surface.updatedAt, spot: surface.spot, points: surface.points }
      const r = await fetch(`${url}/rest/v1/vol_surface_snapshots`, {
        method: 'POST',
        headers: {
          apikey: sbKey, Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify([row]),
      })
      if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`)
      return res.status(200).json({ success: true, captured_at: surface.updatedAt, expiries: surface.points.length })
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message })
    }
  }

  // GET ?events=1 — event calendar for the neo-vix surface capture (CDN-cached to protect Finnhub quota)
  if (req.method === 'GET' && req.query.events) {
    try {
      const events = await fetchEventCalendar(process.env.FRED_KEY, process.env.FINNHUB_KEY)
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')
      return res.status(200).json({ events })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // GET — return recent snapshots for the history slider
  if (req.method === 'GET') {
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 100)
    try {
      const r = await fetch(
        `${url}/rest/v1/vol_surface_snapshots?select=id,captured_at,spot,points&order=captured_at.desc&limit=${limit}`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } })
      if (!r.ok) throw new Error(`Supabase ${r.status}`)
      const rows = await r.json()
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
      return res.status(200).json({ snapshots: rows.map(r => ({ ...r, points: sliderPoints(r.points) })) })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
