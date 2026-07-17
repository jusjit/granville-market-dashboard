import { createClient } from '@supabase/supabase-js'

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
    const market = marketQ.data[0] ?? null

    const ctx = { intraday, weekly, market }
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

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    return res.status(200).json({ intraday, weekly, market, activeRules })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
