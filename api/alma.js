import { createClient } from '@supabase/supabase-js'

const TOL = 0.001 // 0.1% touch tolerance — matches the backtest (alma_pipeline_final.py TOL)
const DAILY_LEVEL_FIELDS = ['centroid', 'upside_pivot', 'downside_pivot', 'upside_target', 'downside_target']

function nyDateFromEpochMs(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

async function tradier(path, key) {
  const r = await fetch(`https://api.tradier.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Tradier ${r.status}: ${(await r.text()).slice(0, 150)}`)
  return r.json()
}

async function fetchLiveQuote(tradierKey) {
  const data = await tradier('/markets/quotes?symbols=SPX,VIX', tradierKey)
  let q = data?.quotes?.quote ?? []
  if (!Array.isArray(q)) q = [q]
  const map = {}
  for (const item of q) map[item.symbol] = item
  return map
}

// Tradier's timesales "time" field is already America/New_York wall-clock
// (e.g. "2026-07-17T09:30:00" for the 9:30am ET open bar) with no offset
// marker — NOT UTC. Do not run it through new Date(...).toISOString(); on a
// UTC server that silently mis-shifts it by 4-5 hours. Pass it through as-is
// and format for display client-side via simple string slicing (AlmaLog.jsx).
async function fetchTodaysBars(tradierKey, nyDateStr) {
  const data = await tradier(
    `/markets/timesales?symbol=SPX&interval=15min&start=${nyDateStr}%2000:00&end=${nyDateStr}%2023:59&session_filter=all`,
    tradierKey)
  const bars = data?.series?.data ?? []
  return Array.isArray(bars) ? bars : [bars]
}

// Walk bars chronologically; return the (naive NY-time) timestamp of the
// first bar whose range overlaps level's +/-0.1% tolerance band, else null.
function firstTouchTime(level, bars) {
  if (level == null) return null
  const adj = level * TOL
  for (const b of bars) {
    if (b.low <= level + adj && b.high >= level - adj) return b.time
  }
  return null
}

// Rules v2 (see "Alma backtest rules/alma_rules.json"). Two independent axes:
//   reliability_tier  — does the stat replicate out-of-sample
//   placebo_status    — does the level's PLACEMENT carry information
// A rule is predictive signal ONLY if placebo_status === 'PASSED' (exactly one
// does: dont_fade_rule). Everything else is descriptive context — the numbers
// are real but explained by proximity/geometry, not by Alma's placement.
// The DB enforces actionable_as_signal === (placebo_status === 'PASSED').
//
// Returns null when a rule's condition can't be evaluated from pre-market data
// (e.g. it needs a session outcome), so it's simply omitted rather than guessed.
function evaluateRule(rule, ctx) {
  const { intraday, weekly, market } = ctx
  const spxOpen = market?.spx_open ?? null
  const centroid = intraday?.centroid ?? null
  const upPivot = intraday?.upside_pivot ?? null
  const downPivot = intraday?.downside_pivot ?? null
  const vixGap = market?.vix_gap_pct ?? null
  const vixOpen = market?.vix_open ?? null
  const gapFromCentroidPct = (spxOpen != null && centroid != null && centroid !== 0)
    ? ((spxOpen - centroid) / centroid) * 100
    : null
  const openInsidePivots = (spxOpen != null && upPivot != null && downPivot != null)
    ? spxOpen < upPivot && spxOpen > downPivot
    : null

  switch (rule.id) {
    // ── rank 1 — the only actionable rule ────────────────────────────────
    case 'dont_fade_rule':
      if (gapFromCentroidPct == null || vixGap == null) return null
      return gapFromCentroidPct > 0.3 && vixGap < 0

    // ── unconditional descriptive stats: "active" whenever the level exists
    case 'sigma_bands_are_not_containment':
      return intraday?.SPX_s1_upper != null && intraday?.SPX_s1_lower != null

    case 'intraday_centroid_touch':
      return centroid != null

    case 'weekly_pivot_touch':
      return weekly?.weekly_upside_pivot != null && weekly?.weekly_downside_pivot != null

    case 'weekly_centroid_touch':
      return weekly?.weekly_centroid != null

    case 'risk_level_construct':
      return intraday?.SPX_risk_upper != null && intraday?.SPX_risk_lower != null

    // ── conditional descriptive stats ────────────────────────────────────
    case 'intraday_pivot_touch':
      return openInsidePivots

    case 'directional_tell':
      if (openInsidePivots == null || centroid == null || spxOpen == null) return null
      return openInsidePivots && spxOpen !== centroid

    case 'pattern_type_conditioning':
      return ['IC', 'long_fly', 'short_fly', 'risk_reversal'].includes(intraday?.pattern_type)

    case 'vix_regime_breach_skew':
      return vixOpen != null

    case 'weekly_reversion_model':
      if (weekly?.reversion_prob == null) return null
      return weekly.reversion_prob >= 97

    // ── outcome-conditional: needs the session to have played out ────────
    case 'targets_are_soft_walls':
      // condition is `pivot_broken == true` — unknowable pre-market
      return null

    default:
      return null
  }
}

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Supabase env vars not configured' })

  const supabase = createClient(url, key)

  try {
    const [intradayQ, weeklyQ, rulesQ] = await Promise.all([
      supabase.from('intraday_posts').select('*').order('date', { ascending: false }).limit(1),
      supabase.from('weekly_posts').select('*').order('date', { ascending: false }).limit(1),
      supabase.from('rules').select('*').order('rank', { ascending: true }),
    ])
    for (const q of [intradayQ, weeklyQ, rulesQ]) {
      if (q.error) throw new Error(q.error.message)
    }
    const intraday = intradayQ.data[0] ?? null
    const weekly = weeklyQ.data[0] ?? null
    const rules = rulesQ.data ?? []

    const marketQ = await supabase.from('market_data').select('*').order('date', { ascending: false }).limit(1)
    if (marketQ.error) throw new Error(marketQ.error.message)
    const storedMarket = marketQ.data[0] ?? null

    // ── Live layer: real-time SPX/VIX quote + (if today's post exists)
    // today's 15-min bars, so rules and touches don't have to wait for the
    // once-daily close-snapshot cron. Best-effort — any failure here degrades
    // to the stored end-of-day market_data row, never breaks the response.
    let live = null
    let touchTimestamps = {}
    let effectiveMarket = storedMarket
    const tradierKey = process.env.TRADIER_KEY
    if (tradierKey) {
      try {
        const quotes = await fetchLiveQuote(tradierKey)
        const spxQ = quotes.SPX, vixQ = quotes.VIX
        const nowMs = Date.now()
        const todayNy = nyDateFromEpochMs(nowMs)
        const quoteNy = spxQ?.trade_date ? nyDateFromEpochMs(spxQ.trade_date) : null
        const isToday = quoteNy === todayNy

        if (spxQ?.last != null) {
          const gapFromCentroidPct = (spxQ.open != null && intraday?.centroid)
            ? ((spxQ.open - intraday.centroid) / intraday.centroid) * 100
            : null
          const vixGapPct = (vixQ?.open != null && vixQ?.prevclose)
            ? ((vixQ.open - vixQ.prevclose) / vixQ.prevclose) * 100
            : null
          live = {
            isToday,
            updatedAt: new Date(nowMs).toISOString(),
            spx: { last: spxQ.last, open: spxQ.open, high: spxQ.high, low: spxQ.low, prevclose: spxQ.prevclose },
            vix: { last: vixQ?.last ?? null, open: vixQ?.open ?? null, prevclose: vixQ?.prevclose ?? null },
            gapFromCentroidPct, vixGapPct,
          }

          // Only trust the live open/gap for rule evaluation & only fetch
          // intraday bars when the quote is genuinely from today's session
          // AND today's Alma post exists (nothing to check touches against
          // otherwise).
          if (isToday) {
            effectiveMarket = {
              ...storedMarket,
              date: todayNy,
              spx_open: spxQ.open, spx_high: spxQ.high, spx_low: spxQ.low,
              vix_open: vixQ?.open ?? null,
              vix_gap_pct: vixGapPct,
            }

            if (intraday?.date === todayNy) {
              const bars = await fetchTodaysBars(tradierKey, todayNy)
              for (const field of DAILY_LEVEL_FIELDS) {
                touchTimestamps[field] = firstTouchTime(intraday[field], bars)
              }
            }
          }
        }
      } catch (liveErr) {
        // Live layer is a bonus, not a requirement — swallow and fall back.
        live = null
      }
    }

    const ctx = { intraday, weekly, market: effectiveMarket }
    // Already ordered by rank (strongest evidence first) from the query.
    const activeRules = rules
      .filter(r => evaluateRule(r, ctx) === true)
      .map(r => ({
        id: r.id,
        name: r.name,
        horizon: r.horizon,
        rank: r.rank,
        reliability_tier: r.reliability_tier,
        placebo_status: r.placebo_status,
        actionable_as_signal: r.actionable_as_signal,
        finding: r.finding,
        interpretation: r.interpretation,
        stats: r.stats,
      }))

    // s-maxage well under the 15-min client poll interval so a poll never
    // serves stale-by-design data.
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json({
      intraday, weekly, market: storedMarket, activeRules,
      live, touchTimestamps,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
