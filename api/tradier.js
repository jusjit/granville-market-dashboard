// Live SPX ATM implied-vol term structure. Computation lives in the shared
// core (lib/volSurfaceCore.mjs) so the snapshot cron produces identical data.
import { computeVolSurface, lastVolSnapshot } from '../lib/volSurfaceCore.mjs'

export default async function handler(req, res) {
  const key = process.env.TRADIER_KEY
  if (!key) return res.status(500).json({ error: 'TRADIER_KEY not configured' })
  try {
    const prev = await lastVolSnapshot() // for >20% jump detection
    const result = await computeVolSurface(key, prev)
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json(result)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
