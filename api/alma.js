import { createClient } from '@supabase/supabase-js'

// Evaluate each rule against current data with explicit logic per rule_id.
// Returns null if the rule's condition can't be evaluated pre-market (e.g. needs session outcome).
function evaluateRule(rule, ctx) {
  const { intraday, weekly, market } = ctx
  const spxOpen = market?.spx_open ?? null
  const centroid = intraday?.centroid ?? null
  const upPivot = intraday?.upside_pivot ?? null
  const downPivot = intraday?.downside_pivot ?? null
  const vixGap = market?.vix_gap_pct ?? null
  const gapFromCentroidPct = (spxOpen != null && centroid != null && centroid !== 0)
    ? ((spxOpen - centroid) / centroid) * 100
    : null

  switch (rule.rule_id) {
    case 'intraday_centroid_near_open':
      if (spxOpen == null || centroid == null) return null
      return Math.abs(spxOpen - centroid) / centroid <= 0.003

    case 'intraday_dont_fade_vol_crush':
      if (gapFromCentroidPct == null || vixGap == null) return null
      return gapFromCentroidPct > 0.3 && vixGap < 0

    case 'intraday_gap_up_vix_up':
      if (gapFromCentroidPct == null || vixGap == null) return null
      return gapFromCentroidPct > 0.3 && vixGap >= 0

    case 'intraday_pivot_inside_range':
      if (spxOpen == null || upPivot == null || downPivot == null) return null
      return downPivot <= spxOpen && spxOpen <= upPivot

    case 'intraday_directional_above_centroid':
      if (spxOpen == null || upPivot == null || downPivot == null || centroid == null) return null
      return downPivot <= spxOpen && spxOpen <= upPivot && spxOpen > centroid

    case 'intraday_directional_below_centroid':
      if (spxOpen == null || upPivot == null || downPivot == null || centroid == null) return null
      return downPivot <= spxOpen && spxOpen <= upPivot && spxOpen < centroid

    case 'intraday_pattern_long_fly':
      return intraday?.pattern_type === 'long_fly'

    case 'intraday_pattern_ic':
      return intraday?.pattern_type === 'IC'

    case 'intraday_sigma_band_not_containment':
      // Informational: active whenever sigma data is present for today
      return intraday?.SPX_s1_upper != null && intraday?.SPX_s1_lower != null

    case 'intraday_miss_asymmetry':
      // Outcome-conditional (centroid_touched = false) — not evaluable pre-market
      return null

    case 'weekly_pivot_inside_range':
      if (spxOpen == null || weekly?.weekly_upside_pivot == null || weekly?.weekly_downside_pivot == null) return null
      return weekly.weekly_downside_pivot <= spxOpen && spxOpen <= weekly.weekly_upside_pivot

    case 'weekly_range_directional_not_containment':
      // Informational: active whenever the weekly vol range is present
      return weekly?.SPX_weekly_upper != null && weekly?.SPX_weekly_lower != null

    case 'weekly_centroid_touch':
      return weekly?.weekly_centroid != null

    case 'weekly_reversion_signals_large_move_not_direction':
      if (weekly?.reversion_prob == null) return null
      return weekly.reversion_prob >= 97

    case 'weekly_fly_pattern_inconclusive':
      return weekly?.fly_pattern === 'long_fly' || weekly?.fly_pattern === 'short_fly'

    case 'weekly_sentiment_regime_inconclusive':
      return weekly?.sentiment_regime != null

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
      supabase.from('rules').select('*'),
    ])
    for (const q of [intradayQ, weeklyQ, rulesQ]) {
      if (q.error) throw new Error(q.error.message)
    }
    const intraday = intradayQ.data[0] ?? null
    const weekly = weeklyQ.data[0] ?? null
    const rules = rulesQ.data ?? []

    // Today's market_data row (falls back to most recent)
    const marketQ = await supabase.from('market_data').select('*').order('date', { ascending: false }).limit(1)
    if (marketQ.error) throw new Error(marketQ.error.message)
    const market = marketQ.data[0] ?? null

    const ctx = { intraday, weekly, market }
    const activeRules = rules
      .filter(r => evaluateRule(r, ctx) === true)
      .map(r => ({
        rule_id: r.rule_id,
        scope: r.scope,
        statement: r.statement,
        historical_rate: r.historical_rate,
        confidence_tier: r.confidence_tier,
        action_guidance: r.action_guidance,
      }))

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    return res.status(200).json({ intraday, weekly, market, activeRules })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
