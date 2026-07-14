// Vol-surface snapshot cron target. Bearer SNAPSHOT_SECRET (same as the
// dashboard snapshot). Computes the current term structure and stores it in
// vol_surface_snapshots for the history slider. Triggered by GitHub Actions.
import { computeVolSurface, lastVolSnapshot } from '../lib/volSurfaceCore.mjs'

export default async function handler(req, res) {
  const secret = process.env.SNAPSHOT_SECRET
  if (!secret) return res.status(500).json({ error: 'SNAPSHOT_SECRET not configured' })
  if ((req.headers.authorization ?? '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const tradierKey = process.env.TRADIER_KEY
  const url = process.env.SUPABASE_URL, sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!tradierKey || !url || !sbKey) return res.status(500).json({ error: 'env not configured' })

  try {
    const prev = await lastVolSnapshot()
    const surface = await computeVolSurface(tradierKey, prev)
    const row = {
      captured_at: surface.updatedAt,
      spot: surface.spot,
      points: surface.points,
    }
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
