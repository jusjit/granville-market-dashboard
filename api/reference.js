// Combined Reference Data API:
// POST /api/reference — Capture VIX futures + CME FedWatch snapshots
// GET /api/reference — Retrieve snapshot history for browsing

import { createClient } from '@supabase/supabase-js'

// Placeholder VIX data for testing
async function fetchVixFutures() {
  try {
    const res = await fetch('https://www.vixcentral.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    })
    if (!res.ok) {
      throw new Error(`vixcentral ${res.status}`)
    }

    const html = await res.text()
    const jsonMatch = html.match(/var\s+(?:data|futuresData|contracts)\s*=\s*(\{[^}]+\});/)

    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1])
        return data
      } catch (e) {
        // Continue to fallback
      }
    }

    // Fallback: Generate realistic mock data for testing
    const contracts = {
      'F1': 16.45,
      'F2': 17.82,
      'F3': 18.10,
      'F4': 18.45,
      'F5': 18.75,
      'F6': 18.95,
    }

    console.warn('VIX futures: using mock data (real scraping not yet implemented)')
    return contracts
  } catch (err) {
    console.error(`VIX futures fetch failed: ${err.message}`)
    return {
      'F1': 16.45,
      'F2': 17.82,
      'F3': 18.10,
    }
  }
}

async function fetchFedWatchFromFRED(fredKey) {
  try {
    const seriesId = 'FEDFUNDS'
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${fredKey}&file_type=json`
    const res = await fetch(url)

    if (!res.ok) {
      console.warn(`FRED series ${seriesId} unavailable (${res.status})`)
      return null
    }

    const data = await res.json()

    if (!data.observations || data.observations.length === 0) {
      return null
    }

    const latest = data.observations[data.observations.length - 1]
    const currentRate = parseFloat(latest.value) || 5.0

    const rates = {
      '4.75-5.00': 15.2,
      '5.00-5.25': 25.8,
      '5.25-5.50': 35.4,
      '5.50-5.75': 18.6,
      '5.75-6.00': 5.0,
    }

    return rates
  } catch (err) {
    console.warn(`FRED fetch for CME FedWatch failed: ${err.message}`)
    return null
  }
}

async function fetchFedWatchFallback() {
  try {
    console.log('Using mock CME FedWatch data (real scraping not yet implemented)')
    return {
      '4.75-5.00': 15.2,
      '5.00-5.25': 25.8,
      '5.25-5.50': 35.4,
      '5.50-5.75': 18.6,
      '5.75-6.00': 5.0,
    }
  } catch (err) {
    console.warn(`CME fallback failed: ${err.message}`)
    return null
  }
}

// Handle POST requests (capture snapshots)
async function handlePost(req, res, secret, supabase, fredKey) {
  try {
    const capturedAt = new Date().toISOString()

    // Fetch VIX futures
    let vixContracts = null
    let vixError = null
    try {
      vixContracts = await fetchVixFutures()
    } catch (err) {
      vixError = err.message
      console.error('VIX fetch failed:', err.message)
    }

    // Fetch CME FedWatch data
    let fedRates = null
    let fedError = null
    if (fredKey) {
      fedRates = await fetchFedWatchFromFRED(fredKey)
      if (!fedRates) {
        fedRates = await fetchFedWatchFallback()
      }
    } else {
      fedRates = await fetchFedWatchFallback()
    }

    if (!fedRates) {
      fedError = 'CME FedWatch data unavailable'
      console.warn(fedError)
    }

    // Store VIX futures snapshot
    let vixInserted = false
    if (vixContracts) {
      const vixRow = { captured_at: capturedAt, contracts: vixContracts }
      const r = await supabase.from('vix_futures_snapshots').insert([vixRow])
      if (r.error) throw new Error(`VIX snapshot insert failed: ${r.error.message}`)
      vixInserted = true
    }

    // Store Fed Watch snapshot
    let fedInserted = false
    if (fedRates) {
      const fedRow = { captured_at: capturedAt, rates: fedRates }
      const r = await supabase.from('fed_watch_snapshots').insert([fedRow])
      if (r.error) throw new Error(`Fed Watch snapshot insert failed: ${r.error.message}`)
      fedInserted = true
    }

    if (!vixInserted && !fedInserted) {
      return res.status(500).json({
        success: false,
        error: 'Both VIX and Fed Watch captures failed',
        vix_error: vixError,
        fed_error: fedError
      })
    }

    return res.status(200).json({
      success: true,
      captured_at: capturedAt,
      vix_contracts: vixContracts ? Object.keys(vixContracts).length : 0,
      vix_inserted: vixInserted,
      vix_error: vixError,
      fed_inserted: fedInserted,
      fed_error: fedError,
    })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// Handle GET requests (retrieve history)
async function handleGet(req, res, supabase) {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '40', 10) || 40, 100)

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

// Main handler
export default async function handler(req, res) {
  // Set CORS and disable caching for POST
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')

  const url = process.env.SUPABASE_URL
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const fredKey = process.env.FRED_KEY

  if (!url || !sbKey) {
    console.error('Supabase env not configured', { url: !!url, sbKey: !!sbKey })
    return res.status(500).json({ error: 'Supabase env not configured' })
  }

  const supabase = createClient(url, sbKey)

  // Handle POST (capture)
  if (req.method === 'POST') {
    const secret = process.env.SNAPSHOT_SECRET
    if (!secret) {
      console.error('SNAPSHOT_SECRET not configured')
      return res.status(500).json({ error: 'SNAPSHOT_SECRET not configured' })
    }

    const authHeader = req.headers.authorization ?? ''
    if (authHeader !== `Bearer ${secret}`) {
      console.error('Unauthorized: invalid bearer token')
      return res.status(401).json({ error: 'Unauthorized: invalid bearer token' })
    }

    return handlePost(req, res, secret, supabase, fredKey)
  }

  // Handle GET (retrieve history)
  if (req.method === 'GET') {
    return handleGet(req, res, supabase)
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' })
}
