// Shared vol-surface computation used by both the live route (api/tradier.js)
// and the snapshot cron (api/snapshot-vol.js) so they never diverge.
//
// Fixes vs the original naive atmIV():
//  - Single option root (SPXW preferred, SPX fallback) — no more averaging
//    AM-settled SPX with PM-settled SPXW at the same strike.
//  - ATM IV interpolated between the two strikes bracketing spot, weighted by
//    distance — no discontinuous jump when spot crosses a strike boundary.
//  - Uses ORATS mid_iv (call+put averaged per strike); tracks bid/ask IV width.
//  - Per-expiry flags: wideSpread (unreliable quote) and lowConfidence
//    (outside RTH, wide spread, or >20% jump vs the last stored snapshot).

const BASE = 'https://api.tradier.com/v1'
const MAX_EXPIRATIONS = 12
export const WIDE_SPREAD_IV = 0.03 // ask_iv - bid_iv > 3 vol pts => wide/unreliable
export const JUMP_REL = 0.20       // >20% relative IV change vs last snapshot => low confidence

async function tradier(path, key) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Tradier ${r.status}: ${(await r.text()).slice(0, 150)}`)
  return r.json()
}

// Per-strike averaged mid_iv and bid/ask IV width, for a single root's contracts.
function strikeIVMap(options) {
  const byStrike = new Map()
  for (const o of options) {
    const iv = o.greeks?.mid_iv
    if (!(iv > 0)) continue
    if (!byStrike.has(o.strike)) byStrike.set(o.strike, { ivs: [], spreads: [] })
    const rec = byStrike.get(o.strike)
    rec.ivs.push(iv)
    const bi = o.greeks?.bid_iv, ai = o.greeks?.ask_iv
    if (ai > 0 && bi > 0 && ai >= bi) rec.spreads.push(ai - bi)
  }
  const out = new Map()
  for (const [k, rec] of byStrike) {
    out.set(k, {
      iv: rec.ivs.reduce((s, v) => s + v, 0) / rec.ivs.length,
      spread: rec.spreads.length ? rec.spreads.reduce((s, v) => s + v, 0) / rec.spreads.length : null,
    })
  }
  return out
}

// ATM IV interpolated between the two strikes bracketing spot.
function atmInterpolated(chain, spot) {
  const options = chain?.options?.option
  if (!options?.length) return null
  const root = options.some(o => o.root_symbol === 'SPXW') ? 'SPXW' : 'SPX'
  const map = strikeIVMap(options.filter(o => o.root_symbol === root))
  if (map.size === 0) return null

  const strikes = [...map.keys()].sort((a, b) => a - b)
  let kLow = null, kHigh = null
  for (const k of strikes) {
    if (k <= spot) kLow = k
    if (k >= spot && kHigh === null) kHigh = k
  }
  if (kLow === null) kLow = strikes[0]
  if (kHigh === null) kHigh = strikes[strikes.length - 1]

  const lo = map.get(kLow), hi = map.get(kHigh)
  if (kLow === kHigh) return { iv: lo.iv, spread: lo.spread, root }
  const w = (spot - kLow) / (kHigh - kLow) // 0 at kLow, 1 at kHigh
  const iv = lo.iv * (1 - w) + hi.iv * w
  const spread = (lo.spread != null && hi.spread != null)
    ? lo.spread * (1 - w) + hi.spread * w
    : (lo.spread ?? hi.spread)
  return { iv, spread, root }
}

export function isRTH(now = new Date()) {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  if (day === 0 || day === 6) return false
  const mins = et.getHours() * 60 + et.getMinutes()
  return mins >= 570 && mins <= 960 // 9:30–16:00 ET
}

// prevPoints: optional array of the last snapshot's points (for jump detection)
export async function computeVolSurface(tradierKey, prevPoints = null) {
  const [quoteData, expData] = await Promise.all([
    tradier('/markets/quotes?symbols=SPX', tradierKey),
    tradier('/markets/options/expirations?symbol=SPX&includeAllRoots=true', tradierKey),
  ])
  const spot = quoteData?.quotes?.quote?.last
  if (!spot) throw new Error('No SPX quote')

  let expirations = expData?.expirations?.date ?? []
  if (!Array.isArray(expirations)) expirations = [expirations]
  const cutoff = Date.now() + 60 * 24 * 3600 * 1000
  const within = expirations.filter(d => new Date(d).getTime() <= cutoff)
  const sampled = within.filter((d, i) => i < 4 || new Date(d + 'T12:00:00Z').getUTCDay() === 5)
  expirations = sampled.slice(0, MAX_EXPIRATIONS)
  if (!expirations.length) throw new Error('No SPX expirations')

  const chains = await Promise.all(
    expirations.map(exp =>
      tradier(`/markets/options/chains?symbol=SPX&expiration=${exp}&greeks=true`, tradierKey).catch(() => null)
    )
  )

  const now = Date.now()
  const points = []
  for (let i = 0; i < expirations.length; i++) {
    if (!chains[i]) continue
    const atm = atmInterpolated(chains[i], spot)
    if (atm == null) continue
    const T = Math.max((new Date(expirations[i] + 'T16:00:00-05:00').getTime() - now) / (365.25 * 24 * 3600 * 1000), 1 / 365)
    points.push({ expiration: expirations[i], T, spotIV: atm.iv, spread: atm.spread, root: atm.root })
  }
  if (points.length < 3) throw new Error(`Only ${points.length} usable expirations`)

  // Forward IV between adjacent expirations
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const num = b.spotIV ** 2 * b.T - a.spotIV ** 2 * a.T
    const den = b.T - a.T
    b.forwardIV = den > 0 && num > 0 ? Math.sqrt(num / den) : null
  }
  points[0].forwardIV = null

  // Kink detection
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], cur = points[i], next = points[i + 1]
    const frac = (cur.T - prev.T) / (next.T - prev.T)
    const interp = prev.spotIV + frac * (next.spotIV - prev.spotIV)
    cur.kink = cur.spotIV > interp * 1.15
    cur.confirmed = cur.kink && cur.forwardIV != null && cur.spotIV >= 0.9 * cur.forwardIV
  }
  points[0].kink = false
  points[points.length - 1].kink = false

  // Confidence flags
  const rth = isRTH(new Date(now))
  const prevByExp = {}
  if (Array.isArray(prevPoints)) for (const p of prevPoints) prevByExp[p.expiration] = p.spotIV
  for (const pt of points) {
    const reasons = []
    if (!rth) reasons.push('outside market hours — quotes may be stale')
    if (pt.spread != null && pt.spread > WIDE_SPREAD_IV) {
      reasons.push(`wide bid/ask (${(pt.spread * 100).toFixed(1)} vol pts)`)
    }
    const prevIV = prevByExp[pt.expiration]
    if (prevIV && Math.abs(pt.spotIV - prevIV) / prevIV > JUMP_REL) {
      const pct = ((pt.spotIV - prevIV) / prevIV) * 100
      reasons.push(`jumped ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs last snapshot`)
    }
    pt.wideSpread = pt.spread != null && pt.spread > WIDE_SPREAD_IV
    pt.lowConfidence = reasons.length > 0
    pt.flags = reasons
  }

  return { spot, updatedAt: new Date(now).toISOString(), points }
}

export async function lastVolSnapshot() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const r = await fetch(`${url}/rest/v1/vol_surface_snapshots?select=points&order=captured_at.desc&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return null
    const rows = await r.json()
    return rows[0]?.points ?? null
  } catch { return null }
}
