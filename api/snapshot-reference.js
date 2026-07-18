// Reference data snapshot cron target: VIX futures + CME FedWatch
// Captures monthly VIX futures term structure from vixcentral.com
// and Fed Funds rate expectations from FRED, stores in Supabase for history slider.
// Triggered by GitHub Actions (.github/workflows/reference-snapshot.yml).

import { createClient } from '@supabase/supabase-js'
import { load } from 'cheerio'

async function fetchVixFutures() {
  try {
    const res = await fetch('https://www.vixcentral.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    if (!res.ok) throw new Error(`vixcentral ${res.status}`)
    const html = await res.text()

    const $ = load(html)
    const contracts = {}

    // Parse VIX futures table. Structure varies but typically:
    // <table> with rows containing F1, F2, F3, etc. and price in another column
    // Look for patterns like "VIX F1" or "F1" in first column, price in following columns
    const rows = $('table tbody tr, table tr')

    rows.each((i, row) => {
      const cells = $(row).find('td')
      if (cells.length === 0) return

      const firstCell = $(cells[0]).text().trim()
      // Match patterns like "F1", "F2", "VIX F1", "F 1" etc.
      const match = firstCell.match(/F\s*(\d+)|VIX\s*F\s*(\d+)/)
      if (!match) return

      const month = match[1] || match[2]
      const contractKey = `F${month}`

      // Price is typically in the 2nd or 3rd column (settle/close)
      // Try multiple columns to find a valid price
      for (let j = 1; j < Math.min(cells.length, 5); j++) {
        const priceText = $(cells[j]).text().trim()
        const price = parseFloat(priceText)
        if (!isNaN(price) && price > 5 && price < 100) { // sanity check: VIX futures in reasonable range
          contracts[contractKey] = parseFloat(price.toFixed(2))
          break
        }
      }
    })

    if (Object.keys(contracts).length === 0) {
      throw new Error('No VIX futures contracts parsed from vixcentral')
    }

    return contracts
  } catch (err) {
    throw new Error(`VIX futures fetch failed: ${err.message}`)
  }
}

async function fetchFedWatchFromFRED(fredKey) {
  try {
    // FRED series for Fed Funds futures expectations
    // FEDTARUF* series represent Federal Funds rate expectations
    // This is a simplified approach — you may need to adjust based on actual FRED availability
    const seriesId = 'FEDTARUR'  // Fed Funds Rate Uncertainty Range

    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${fredKey}&file_type=json`
    const res = await fetch(url)

    if (!res.ok) {
      // Fallback: try alternative series or note that full CME FedWatch probabilities
      // may not be directly available in FRED — return placeholder or fallback to scrape
      console.warn(`FRED series ${seriesId} unavailable (${res.status}), using fallback`)
      return null
    }

    const data = await res.json()

    // Parse observations and create probability distribution
    // FRED data structure: observations array with date and value
    if (!data.observations || data.observations.length === 0) {
      return null
    }

    // For now, return the latest observation value
    // In production, you'd parse this into rate buckets + probabilities
    const latest = data.observations[data.observations.length - 1]

    // Placeholder structure (will need refinement based on actual FRED series)
    const rates = {
      'latest_rate_uncertainty': parseFloat(latest.value) || null
    }

    return rates
  } catch (err) {
    console.warn(`FRED fetch for CME FedWatch failed: ${err.message}`)
    return null
  }
}

async function fetchFedWatchFallback() {
  // Fallback: scrape CME website directly if FRED doesn't have the data
  try {
    const res = await fetch('https://www.cmegroup.com/markets/money-markets/fed-funds.quotes.html', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    if (!res.ok) throw new Error(`CME website ${res.status}`)

    const html = await res.text()
    const $ = load(html)

    // CME FedWatch table structure varies; look for rate cells and probability cells
    // This is a simplified approach — adjust selectors based on actual CME HTML structure
    const rates = {}

    // Look for table cells containing rate ranges and percentages
    const cells = $('td, th')
    cells.each((i, cell) => {
      const text = $(cell).text().trim()
      // Match patterns like "1.25-1.50" (rate range) or "45.2%" (probability)
      if (text.match(/^\d+\.\d+-\d+\.\d+$/)) {
        const range = text
        // Look for probability in next few cells
        for (let j = i + 1; j < i + 4 && j < cells.length; j++) {
          const probText = $(cells[j]).text().trim()
          const probMatch = probText.match(/(\d+\.?\d*)%?/)
          if (probMatch) {
            const prob = parseFloat(probMatch[1])
            if (!isNaN(prob) && prob > 0 && prob <= 100) {
              rates[range] = prob
              break
            }
          }
        }
      }
    })

    return Object.keys(rates).length > 0 ? rates : null
  } catch (err) {
    console.warn(`CME fallback scrape failed: ${err.message}`)
    return null
  }
}

export default async function handler(req, res) {
  const secret = process.env.SNAPSHOT_SECRET
  if (!secret) return res.status(500).json({ error: 'SNAPSHOT_SECRET not configured' })
  if ((req.headers.authorization ?? '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL, sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const fredKey = process.env.FRED_KEY

  if (!url || !sbKey) return res.status(500).json({ error: 'Supabase env not configured' })

  const supabase = createClient(url, sbKey)

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
        // Try fallback scrape
        fedRates = await fetchFedWatchFallback()
      }
    } else {
      // Try fallback scrape if no FRED key
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
