// Returns recent VIX futures and CME FedWatch snapshots for history slider browsing.
// Small payload: ~2 snapshots/day (4h cadence) × a few days.

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Supabase not configured' })

  const limit = Math.min(parseInt(req.query.limit ?? '40', 10) || 40, 100)

  const supabase = createClient(url, key)

  try {
    // Fetch both VIX and Fed Watch snapshots in parallel
    const [vixR, fedR] = await Promise.all([
      supabase.from('vix_futures_snapshots').select('id,captured_at,contracts').order('captured_at', { ascending: false }).limit(limit),
      supabase.from('fed_watch_snapshots').select('id,captured_at,rates').order('captured_at', { ascending: false }).limit(limit),
    ])

    if (vixR.error) throw new Error(`VIX snapshots fetch: ${vixR.error.message}`)
    if (fedR.error) throw new Error(`Fed Watch snapshots fetch: ${fedR.error.message}`)

    // Merge by captured_at timestamp (take union of both, sorted desc)
    const merged = new Map()
    for (const row of (vixR.data || [])) {
      const key = row.captured_at
      if (!merged.has(key)) merged.set(key, {})
      merged.get(key).vix = { id: row.id, contracts: row.contracts }
    }
    for (const row of (fedR.data || [])) {
      const key = row.captured_at
      if (!merged.has(key)) merged.set(key, {})
      merged.get(key).fed = { id: row.id, rates: row.rates }
    }

    // Convert to sorted array (newest first)
    const snapshots = Array.from(merged.entries())
      .sort((a, b) => new Date(b[0]) - new Date(a[0]))
      .map(([capturedAt, data]) => ({
        captured_at: capturedAt,
        vix: data.vix || null,
        fed: data.fed || null,
      }))

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json({ snapshots })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
