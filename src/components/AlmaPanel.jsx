import { useState } from 'react'
import AlmaLiveCard from './AlmaLiveCard'

// Reliability = does the stat replicate. Deliberately NOT green — a VALIDATED
// tier says nothing about whether the rule is tradeable (v1 conflated the two;
// e.g. weekly_pivot_touch is 86.5% and rock-stable, yet information-free).
const TIER_COLORS = {
  VALIDATED: 'text-slate-300 bg-slate-800/60 border-slate-700/50',
  EMERGING: 'text-slate-400 bg-slate-800/40 border-slate-700/40',
  EXPLORATORY: 'text-slate-500 bg-slate-800/30 border-slate-700/30',
}

// Green is reserved for the one thing that earns it: a passed placebo.
const SIGNAL_BADGE = 'text-green-400 bg-green-950/30 border-green-900/40'
const CONTEXT_BADGE = 'text-slate-500 bg-slate-900/40 border-slate-800'

const SIGMA_SYMBOLS = ['SPX', 'ES', 'SPY', 'VIX', 'IWM', 'QQQ']

// Empirical touch rates by level type and sigma distance from band center.
// 319 trading days (Feb 2025–Jun 2026), n=500 beyond-center observations.
// Buckets: [0–0.5σ, 0.5–1σ, 1–1.5σ, 1.5–2σ, 2–3σ, 3σ+]
const TOUCH_RATES = {
  centroid:        [80, 70, 71, 62, 59, 31],
  upside_pivot:    [85, 67, 62, 48, 48, 17],
  downside_pivot:  [57, 57, 41, 33, 35, 11],
  upside_target:   [25, 25, 25, 18, 20,  0],
  downside_target: [18, 18, 18,  8, 22,  0],
}

function touchPct(sigma, levelType = 'centroid') {
  const rates = TOUCH_RATES[levelType] ?? TOUCH_RATES.centroid
  if (sigma <= 0.5) return rates[0]
  if (sigma <= 1.0) return rates[1]
  if (sigma <= 1.5) return rates[2]
  if (sigma <= 2.0) return rates[3]
  if (sigma <= 3.0) return rates[4]
  return rates[5]
}

function touchColor(pct) {
  if (pct >= 60) return 'text-green-400'
  if (pct >= 30) return 'text-amber-400'
  return 'text-red-400'
}

function Level({ label, value, accent, sigma, levelType, digits = 2 }) {
  const pct = sigma != null ? touchPct(sigma, levelType) : null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-600 uppercase tracking-widest">{label}</span>
      <span className={`font-mono text-sm font-bold ${accent ?? 'text-slate-200'}`}>
        {value != null ? value.toFixed(digits) : '—'}
      </span>
      {sigma != null && (
        <span className="flex items-center gap-1.5 mt-0.5">
          <span className="font-mono text-[10px] text-violet-400">{sigma.toFixed(2)}σ</span>
          <span className={`font-mono text-[10px] font-bold ${touchColor(pct)}`}>~{pct}%</span>
        </span>
      )}
    </div>
  )
}

function SigmaLabel({ n, side }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-violet-400 font-bold text-sm">{n}σ</span>
      <span className="text-[10px] text-slate-600 uppercase tracking-widest">{side}</span>
    </span>
  )
}

function SigmaCell({ n, side, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <SigmaLabel n={n} side={side} />
      <span className="font-mono text-sm font-bold text-slate-200">
        {value != null ? value.toFixed(2) : '—'}
      </span>
    </div>
  )
}

export default function AlmaPanel({ data, loading, error }) {
  const [sigmaSymbol, setSigmaSymbol] = useState('SPX')

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-8 text-center text-sm text-slate-600 animate-pulse">
        Loading Alma levels…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-4 text-sm text-red-400">
        Alma data unavailable — {error}
      </div>
    )
  }
  if (!data?.intraday) return null

  const d = data.intraday
  const w = data.weekly
  const biasColor =
    d.directional_bias?.toLowerCase().includes('bull') ? 'text-green-400' :
    d.directional_bias?.toLowerCase().includes('bear') ? 'text-red-400' : 'text-slate-300'

  // Sigma distance measured from the band center (≈ prev close) using
  // directional widths so the number aligns with the visible sigma bands.
  // A level below the 2σ lower band correctly shows >2σ.
  const centroid = d.centroid
  const s1u = d.SPX_s1_upper
  const s1l = d.SPX_s1_lower
  const bandCenter = (s1u != null && s1l != null) ? (s1u + s1l) / 2 : null
  const sigmaUp = (s1u != null && bandCenter != null) ? s1u - bandCenter : null
  const sigmaDn = (s1l != null && bandCenter != null) ? bandCenter - s1l : null

  const toSigma = (price) => {
    if (price == null || bandCenter == null) return null
    if (price >= bandCenter) {
      if (sigmaUp == null || sigmaUp <= 0) return null
      return (price - bandCenter) / sigmaUp
    }
    if (sigmaDn == null || sigmaDn <= 0) return null
    return (bandCenter - price) / sigmaDn
  }
  const centroidSigma = toSigma(centroid)
  const upPivotSigma = toSigma(d.upside_pivot)
  const dnPivotSigma = toSigma(d.downside_pivot)
  const upTargetSigma = toSigma(d.upside_target)
  const dnTargetSigma = toSigma(d.downside_target)

  return (
    <div className="space-y-4">
      {/* ── Daily levels card (centroid first) ─────────────────────────────── */}
      <div className="rounded-xl border border-violet-900/40 bg-violet-950/10 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-widest">
              Daily · SPX · {d.date} · updates every trading day
            </p>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="font-mono text-3xl font-bold text-slate-100">
                {d.centroid != null ? d.centroid.toFixed(2) : '—'}
              </span>
              <span className="text-xs text-slate-500">daily centroid</span>
              {centroidSigma != null && (() => {
                const cPct = touchPct(centroidSigma, 'centroid')
                return (
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-violet-400">{centroidSigma.toFixed(2)}σ</span>
                    <span className={`font-mono text-[11px] font-bold ${touchColor(cPct)}`}>
                      ~{cPct}% touch
                    </span>
                  </span>
                )
              })()}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {d.pattern_type && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border text-violet-300 bg-violet-950/30 border-violet-900/40">
                {d.pattern_type}
              </span>
            )}
            {d.directional_bias && (
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-700/50 bg-slate-900/50 ${biasColor}`}>
                {d.directional_bias}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <Level label="Upside Pivot" value={d.upside_pivot} accent="text-green-400" sigma={upPivotSigma} levelType="upside_pivot" />
          <Level label="Downside Pivot" value={d.downside_pivot} accent="text-red-400" sigma={dnPivotSigma} levelType="downside_pivot" />
          <Level label="Upside Target" value={d.upside_target} accent="text-green-500/70" sigma={upTargetSigma} levelType="upside_target" />
          <Level label="Downside Target" value={d.downside_target} accent="text-red-500/70" sigma={dnTargetSigma} levelType="downside_target" />
        </div>

        {/* Sigma bands */}
        <div className="border-t border-slate-800/60 pt-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-[10px] text-slate-600 uppercase tracking-widest">
              Sigma Bands <span className="text-violet-400 font-bold text-xs normal-case">σ</span>
            </p>
            <div className="flex gap-1">
              {SIGMA_SYMBOLS.map(sym => (
                <button
                  key={sym}
                  onClick={() => setSigmaSymbol(sym)}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                    sigmaSymbol === sym
                      ? 'text-violet-300 bg-violet-950/40 border-violet-800/60'
                      : 'text-slate-500 bg-slate-900/40 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <SigmaCell n={1} side="upper" value={d[`${sigmaSymbol}_s1_upper`]} />
            <SigmaCell n={1} side="lower" value={d[`${sigmaSymbol}_s1_lower`]} />
            <SigmaCell n={2} side="upper" value={d[`${sigmaSymbol}_s2_upper`]} />
            <SigmaCell n={2} side="lower" value={d[`${sigmaSymbol}_s2_lower`]} />
            <SigmaCell n={3} side="upper" value={d[`${sigmaSymbol}_s3_upper`]} />
            <SigmaCell n={3} side="lower" value={d[`${sigmaSymbol}_s3_lower`]} />
          </div>
        </div>
      </div>

      {/* ── Live SPX reference — the actual inputs rules are evaluated against */}
      <AlmaLiveCard live={data.live} loading={false} error={null} />

      {/* ── Weekly levels card ─────────── */}
      {w && (
        <div className="rounded-xl border border-sky-900/40 bg-sky-950/10 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <p className="text-[10px] font-semibold text-sky-500 uppercase tracking-widest">
                Weekly · SPX · {w.date} · updates with each weekly post
              </p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="font-mono text-3xl font-bold text-slate-100">
                  {w.weekly_centroid != null ? w.weekly_centroid.toFixed(2) : '—'}
                </span>
                <span className="text-xs text-slate-500">weekly centroid</span>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {w.fly_pattern && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border text-sky-300 bg-sky-950/30 border-sky-900/40">
                  {w.fly_pattern}
                </span>
              )}
              {w.sentiment_regime && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-700/50 bg-slate-900/50 text-slate-300">
                  {w.sentiment_regime}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Level label="Weekly Up Pivot" value={w.weekly_upside_pivot} accent="text-green-400" />
            <Level label="Weekly Down Pivot" value={w.weekly_downside_pivot} accent="text-red-400" />
            <Level label="Weekly Up Target" value={w.weekly_upside_target} accent="text-green-500/70" />
            <Level label="Weekly Down Target" value={w.weekly_downside_target} accent="text-red-500/70" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-slate-800/60 pt-4">
            <Level label="SPX Weekly Upper" value={w.SPX_weekly_upper} />
            <Level label="SPX Weekly Lower" value={w.SPX_weekly_lower} />
            <Level label="Reversion Prob" value={w.reversion_prob} digits={1} accent="text-sky-300" />
            <Level label="VIX Pin" value={w.vix_pin} />
          </div>
        </div>
      )}
    </div>
  )
}

// One-line takeaways for the rule list. The rules table stores full backtest write-ups
// (finding/interpretation), which stay available in each row's expandable detail.
// Unknown rule ids fall back to the first sentence of the finding.
const RULE_TAKEAWAYS = {
  dont_fade_rule: 'Gap up on falling VIX: don’t fade it — centroid fill odds drop to ~33% (vs ~70% normally).',
  sigma_bands_are_not_containment: 'Bands are targets, not a range — SPX stays inside its 1σ band only ~13% of days.',
  sigma_touch_decay: 'Touch odds fall with σ distance, yet far levels still hit far more often than a normal distribution implies.',
  intraday_pivot_touch: 'Opened inside the pivots: one gets hit ~86% of days — upside faster (median 30m) than downside (53m).',
  intraday_centroid_touch: 'Centroid hit ~70% of days, mostly in the first hour; still untouched by 11:30 → ~1 in 4.',
  weekly_pivot_touch: 'A weekly pivot gets hit ~87% of weeks — geometry, not edge.',
  targets_are_soft_walls: 'After a pivot breaks, its target is reached only ~38% of the time.',
  target_conditional_timing: 'A target is only live if its pivot breaks by 10:00 and it sits within ~1.25σ beyond (47% vs 16%).',
  weekly_centroid_touch: 'Weekly centroid hit ~56% of weeks — worse than the prior-week close.',
  directional_tell: 'Open above/below the centroid “tell” is a geometry artifact — not tradeable.',
  pattern_type_conditioning: 'Fly/condor pattern type doesn’t shift centroid odds beyond noise.',
  vix_regime_breach_skew: '1σ breaches skew to the upside, except VIX 22–28 where downside dominates.',
  risk_level_construct: 'Risk level sits correctly between 1σ and 2σ; no behavioral effect found yet.',
  weekly_reversion_model: 'High reversion flag describes the prior move, not the next — unusable.',
}

function takeaway(rule) {
  return RULE_TAKEAWAYS[rule.id] ?? (rule.finding ?? '').split(/(?<=\.)\s/)[0]
}

function RuleLine({ rule }) {
  const [open, setOpen] = useState(false)
  const signal = rule.actionable_as_signal
  const s = rule.stats ?? {}
  return (
    <li className="border-t border-slate-800/50 first:border-t-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-2 py-1.5 text-left hover:bg-slate-800/20 rounded"
      >
        <span className="text-slate-600 text-[10px] mt-0.5 w-3 shrink-0">{open ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1">
          <span className={`text-xs font-semibold ${signal ? 'text-green-300' : 'text-slate-200'}`}>{rule.name}</span>
          <span className="text-xs text-slate-400"> — {takeaway(rule)}</span>
        </span>
        {s.n != null && <span className="font-mono text-[10px] text-slate-600 shrink-0 mt-0.5">n={s.n}</span>}
      </button>
      {open && (
        <div className="pl-5 pb-3 pr-2 space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${signal ? SIGNAL_BADGE : CONTEXT_BADGE}`}>
              {signal ? 'Signal' : 'Context'}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${TIER_COLORS[rule.reliability_tier] ?? TIER_COLORS.EXPLORATORY}`}>
              {rule.reliability_tier}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] border border-slate-800 text-slate-500">
              placebo {rule.placebo_status?.toLowerCase()}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] border border-slate-800 text-slate-500">
              #{rule.rank} · {rule.horizon}
            </span>
          </div>
          {rule.finding && <p className="text-[11px] text-slate-400 leading-relaxed">{rule.finding}</p>}
          {rule.interpretation && <p className="text-[11px] text-slate-500 leading-relaxed">{rule.interpretation}</p>}
          {s.naive_benchmark && (
            <p className="text-[11px] text-slate-600 leading-relaxed">vs naive benchmark: {s.naive_benchmark}</p>
          )}
        </div>
      )}
    </li>
  )
}

// Minto layout: governing line (is the one predictive rule active?) → today's reliable
// context as one-liners → lower-confidence rules collapsed. Full write-ups on expand.
export function AlmaActiveRules({ rules }) {
  const [showLow, setShowLow] = useState(false)
  if (!rules?.length) return null

  const signals = rules.filter(r => r.actionable_as_signal)
  const context = rules.filter(r => !r.actionable_as_signal && r.reliability_tier === 'VALIDATED')
  const lowConf = rules.filter(r => !r.actionable_as_signal && r.reliability_tier !== 'VALIDATED')

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest">Active Rules ({rules.length})</p>
        <p className="text-[10px] text-slate-600">Click a rule for the full backtest detail</p>
      </div>

      {signals.length ? (
        <div className="rounded-lg border border-green-900/40 bg-green-950/10 px-3 py-2">
          <p className="text-sm text-green-300 font-semibold">
            Signal active: {signals.map(r => r.name).join(', ')}
          </p>
          <ul className="mt-1">{signals.map(r => <RuleLine key={r.id} rule={r} />)}</ul>
        </div>
      ) : (
        <p className="text-sm text-slate-300">
          <span className="font-semibold">No signal today.</span>{' '}
          <span className="text-slate-400">Every active rule is descriptive context — useful for expectations, not an edge.</span>
        </p>
      )}

      {context.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">What to expect today · validated</p>
          <ul>{context.map(r => <RuleLine key={r.id} rule={r} />)}</ul>
        </div>
      )}

      {lowConf.length > 0 && (
        <div>
          <button
            onClick={() => setShowLow(v => !v)}
            className="text-[10px] text-slate-600 hover:text-slate-400 uppercase tracking-widest"
          >
            {showLow ? '▾' : '▸'} Lower confidence ({lowConf.length}) · exploratory or debunked
          </button>
          {showLow && <ul className="mt-1">{lowConf.map(r => <RuleLine key={r.id} rule={r} />)}</ul>}
        </div>
      )}
    </div>
  )
}
