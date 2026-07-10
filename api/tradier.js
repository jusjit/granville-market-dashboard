// Vol surface via Tradier options chains (ORATS greeks include implied vol).
// Returns ATM spot IV per expiration, forward IV between adjacent expirations,
// kink detection (>15% above neighbor interpolation), and confirmation
// (spot IV >= 90% of forward IV = real put buying, not anticipation).

const BASE = 'https://api.tradier.com/v1'
const MAX_EXPIRATIONS = 12

async function tradier(path, key) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Tradier ${r.status}: ${(await r.text()).slice(0, 150)}`)
  return r.json()
}

function atmIV(chain, spot) {
  // Average call+put mid_iv at the strike closest to spot
  const options = chain?.options?.option
  if (!options?.length) return null
  let bestStrike = null, bestDist = Infinity
  for (const o of options) {
    const dist = Math.abs(o.strike - spot)
    if (dist < bestDist) { bestDist = dist; bestStrike = o.strike }
  }
  const atm = options.filter(o => o.strike === bestStrike && o.greeks?.mid_iv > 0)
  if (!atm.length) return null
  return atm.reduce((s, o) => s + o.greeks.mid_iv, 0) / atm.length
}

export default async function handler(req, res) {
  const key = process.env.TRADIER_KEY
  if (!key) return res.status(500).json({ error: 'TRADIER_KEY not configured' })

  try {
    // Underlying spot + expirations in parallel
    const [quoteData, expData] = await Promise.all([
      tradier('/markets/quotes?symbols=SPX', key),
      tradier('/markets/options/expirations?symbol=SPX&includeAllRoots=true', key),
    ])
    const spot = quoteData?.quotes?.quote?.last
    if (!spot) throw new Error('No SPX quote')
    let expirations = expData?.expirations?.date ?? []
    if (!Array.isArray(expirations)) expirations = [expirations]
    // Sample: first 4 near-term expiries, then Fridays only, out to ~60 days
    const cutoff = Date.now() + 60 * 24 * 3600 * 1000
    const within = expirations.filter(d => new Date(d).getTime() <= cutoff)
    const sampled = within.filter((d, i) => i < 4 || new Date(d + 'T12:00:00Z').getUTCDay() === 5)
    expirations = sampled.slice(0, MAX_EXPIRATIONS)
    if (!expirations.length) throw new Error('No SPX expirations')

    // Fetch chains in parallel
    const chains = await Promise.all(
      expirations.map(exp =>
        tradier(`/markets/options/chains?symbol=SPX&expiration=${exp}&greeks=true`, key)
          .catch(() => null)
      )
    )

    const now = Date.now()
    const points = []
    for (let i = 0; i < expirations.length; i++) {
      if (!chains[i]) continue
      const iv = atmIV(chains[i], spot)
      if (iv == null) continue
      const T = Math.max((new Date(expirations[i] + 'T16:00:00-05:00').getTime() - now) / (365.25 * 24 * 3600 * 1000), 1 / 365)
      points.push({ expiration: expirations[i], T, spotIV: iv })
    }
    if (points.length < 3) throw new Error(`Only ${points.length} usable expirations`)

    // Forward IV between adjacent expirations:
    // FIV(T1→T2) = sqrt((IV2²·T2 − IV1²·T1) / (T2 − T1))
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      const num = b.spotIV ** 2 * b.T - a.spotIV ** 2 * a.T
      const den = b.T - a.T
      b.forwardIV = den > 0 && num > 0 ? Math.sqrt(num / den) : null
    }
    points[0].forwardIV = null

    // Kink detection: IV elevated >15% vs the time-interpolated line between neighbors
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1], cur = points[i], next = points[i + 1]
      const frac = (cur.T - prev.T) / (next.T - prev.T)
      const interp = prev.spotIV + frac * (next.spotIV - prev.spotIV)
      cur.kink = cur.spotIV > interp * 1.15
      // Confirmed: spot IV rising into forward — real hedging, not anticipation
      cur.confirmed = cur.kink && cur.forwardIV != null && cur.spotIV >= 0.9 * cur.forwardIV
    }
    points[0].kink = false
    points[points.length - 1].kink = false

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json({ spot, updatedAt: new Date().toISOString(), points })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
