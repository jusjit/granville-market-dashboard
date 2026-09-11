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

// Empirical touch rates from sigma_touch_decay rule (n=541, all buckets p<0.001)
function touchPct(sigma) {
  if (sigma <= 0.5) return 95
  if (sigma <= 1.0) return 66
  if (sigma <= 1.5) return 37
  if (sigma <= 2.0) return 29
  if (sigma <= 3.0) return 14
  return 2
}

function touchColor(pct) {
  if (pct >= 60) return 'text-green-400'
  if (pct >= 30) return 'text-amber-400'
  return 'text-red-400'
}

function Level({ label, value, accent, digits = 2 }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-600 uppercase tracking-widest">{label}</span>
      <span className={`font-mono text-sm font-bold ${accent ?? 'text-slate-200'}`}>
        {value != null ? value.toFixed(digits) : '—'}
      </span>
    </div>
  )
}

// ── Sigma Scale: horizontal number line with levels plotted against sigma zones
function SigmaScale({ d, spxLast, sigmaSymbol, onSymbolChange }) {
  const s1u = d[`${sigmaSymbol}_s1_upper`]
  const s1l = d[`${sigmaSymbol}_s1_lower`]
  const s2u = d[`${sigmaSymbol}_s2_upper`]
  const s2l = d[`${sigmaSymbol}_s2_lower`]
  const s3u = d[`${sigmaSymbol}_s3_upper`]
  const s3l = d[`${sigmaSymbol}_s3_lower`]
  const centroid = d.centroid

  if (s1u == null || s1l == null || centroid == null) return null

  const sigmaWidth = s1u - centroid
  if (sigmaWidth <= 0) return null

  const toSigma = (price) => (price - centroid) / sigmaWidth

  // Levels to plot on the scale
  const levels = []
  if (d.upside_target != null) levels.push({ label: 'Up Target', price: d.upside_target, color: 'rgb(34,197,94)', shortLabel: 'UT' })
  if (d.upside_pivot != null) levels.push({ label: 'Up Pivot', price: d.upside_pivot, color: 'rgb(74,222,128)', shortLabel: 'UP' })
  levels.push({ label: 'Centroid', price: centroid, color: 'rgb(167,139,250)', shortLabel: 'C', isCentroid: true })
  if (d.downside_pivot != null) levels.push({ label: 'Dn Pivot', price: d.downside_pivot, color: 'rgb(248,113,113)', shortLabel: 'DP' })
  if (d.downside_target != null) levels.push({ label: 'Dn Target', price: d.downside_target, color: 'rgb(239,68,68)', shortLabel: 'DT' })

  // Sort by price descending (top to bottom in the table)
  levels.sort((a, b) => b.price - a.price)

  // SPX marker
  const spxSigma = spxLast != null ? toSigma(spxLast) : null

  // Scale range: show at least ±3σ, expand if any level is beyond
  let minSigma = -3.2, maxSigma = 3.2
  for (const lv of levels) {
    const s = toSigma(lv.price)
    if (s < minSigma) minSigma = s - 0.3
    if (s > maxSigma) maxSigma = s + 0.3
  }
  if (spxSigma != null) {
    if (spxSigma < minSigma) minSigma = spxSigma - 0.3
    if (spxSigma > maxSigma) maxSigma = spxSigma + 0.3
  }

  const range = maxSigma - minSigma
  const toPct = (sigma) => ((sigma - minSigma) / range) * 100

  // Sigma zone boundaries for the bar
  const zones = [
    { from: -3, to: -2, label: '3σ', opacity: 'bg-red-900/20' },
    { from: -2, to: -1, label: '2σ', opacity: 'bg-red-900/30' },
    { from: -1, to: 0, label: '1σ', opacity: 'bg-violet-900/30' },
    { from: 0, to: 1, label: '1σ', opacity: 'bg-violet-900/30' },
    { from: 1, to: 2, label: '2σ', opacity: 'bg-green-900/30' },
    { from: 2, to: 3, label: '3σ', opacity: 'bg-green-900/20' },
  ]

  return (
    <div className="border-t border-slate-800/60 pt-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest">
          Level Map <span className="text-violet-400 font-bold text-xs normal-case">σ</span>
          <span className="text-slate-700 ml-2 normal-case">sigma distance → touch probability</span>
        </p>
        <div className="flex gap-1">
          {SIGMA_SYMBOLS.map(sym => (
            <button
              key={sym}
              onClick={() => onSymbolChange(sym)}
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

      {/* ── Visual scale bar ─────────────────────────────────────────────── */}
      <div className="relative h-8 rounded-md overflow-hidden mb-1">
        {/* Sigma zone fills */}
        {zones.map((z, i) => {
          const left = Math.max(0, toPct(z.from))
          const right = Math.min(100, toPct(z.to))
          if (right <= left) return null
          return (
            <div key={i} className={`absolute top-0 bottom-0 ${z.opacity}`}
              style={{ left: `${left}%`, width: `${right - left}%` }} />
          )
        })}

        {/* Sigma boundary lines */}
        {[-3, -2, -1, 0, 1, 2, 3].map(s => {
          const pct = toPct(s)
          if (pct < 0 || pct > 100) return null
          return (
            <div key={s} className="absolute top-0 bottom-0 w-px"
              style={{
                left: `${pct}%`,
                backgroundColor: s === 0 ? 'rgba(167,139,250,0.5)' : 'rgba(100,116,139,0.2)',
              }} />
          )
        })}

        {/* Sigma labels on the bar */}
        {[-3, -2, -1, 1, 2, 3].map(s => {
          const pct = toPct(s)
          if (pct < 2 || pct > 98) return null
          return (
            <span key={s} className="absolute top-0.5 text-[9px] text-slate-600 -translate-x-1/2"
              style={{ left: `${pct}%` }}>
              {s > 0 ? '+' : ''}{s}σ
            </span>
          )
        })}

        {/* Level markers on the bar */}
        {levels.map(lv => {
          const sigma = toSigma(lv.price)
          const pct = toPct(sigma)
          if (pct < 0 || pct > 100) return null
          return (
            <div key={lv.shortLabel} className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${pct}%` }}>
              <span className="text-[9px] font-bold" style={{ color: lv.color }}>{lv.shortLabel}</span>
              <div className="w-0.5 h-2 rounded-full" style={{ backgroundColor: lv.color }} />
            </div>
          )
        })}

        {/* SPX price marker */}
        {spxSigma != null && (
          <div className="absolute top-0 bottom-0 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${toPct(spxSigma)}%` }}>
            <div className="w-0.5 h-full bg-slate-300/60" />
            <span className="absolute top-0.5 text-[9px] font-bold text-slate-300 whitespace-nowrap"
              style={{ transform: 'translateX(calc(-50% + 4px))' }}>
              SPX
            </span>
          </div>
        )}
      </div>

      {/* ── Level table with sigma distance + touch probability ──────── */}
      <div className="mt-3 space-y-0">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 items-center text-[11px]">
          <span className="text-[10px] text-slate-600 uppercase tracking-widest">Level</span>
          <span className="text-[10px] text-slate-600 uppercase tracking-widest text-right">Price</span>
          <span className="text-[10px] text-slate-600 uppercase tracking-widest text-right">σ dist</span>
          <span className="text-[10px] text-slate-600 uppercase tracking-widest text-right">Touch %</span>

          {levels.map(lv => {
            const sigma = Math.abs(toSigma(lv.price))
            const pct = lv.isCentroid ? touchPct(spxSigma != null ? Math.abs(spxSigma) : 0.7) : touchPct(sigma)
            const pctStr = lv.isCentroid && spxSigma == null
              ? `~${pct}%`
              : `~${pct}%`
            return [
              <span key={`${lv.shortLabel}-name`} className="font-semibold" style={{ color: lv.color }}>
                {lv.label}
              </span>,
              <span key={`${lv.shortLabel}-price`} className="font-mono text-slate-300 text-right">
                {lv.price.toFixed(2)}
              </span>,
              <span key={`${lv.shortLabel}-sigma`} className="font-mono text-violet-400 text-right">
                {lv.isCentroid
                  ? (spxSigma != null ? `${Math.abs(spxSigma).toFixed(2)}σ` : '—')
                  : `${sigma.toFixed(2)}σ`
                }
              </span>,
              <span key={`${lv.shortLabel}-pct`} className={`font-mono text-right font-bold ${touchColor(pct)}`}>
                {pctStr}
              </span>,
            ]
          })}
        </div>
      </div>

      {/* ── Raw sigma band values (collapsed) ────────────────────────── */}
      <details className="mt-3">
        <summary className="text-[10px] text-slate-600 cursor-pointer hover:text-slate-400 transition-colors">
          Raw {sigmaSymbol} sigma band values
        </summary>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-2">
          {[1, 2, 3].map(n => [
            <div key={`${n}u`} className="flex flex-col gap-0.5">
              <span className="flex items-baseline gap-1">
                <span className="text-violet-400 font-bold text-sm">{n}σ</span>
                <span className="text-[10px] text-slate-600 uppercase tracking-widest">upper</span>
              </span>
              <span className="font-mono text-sm font-bold text-slate-200">
                {d[`${sigmaSymbol}_s${n}_upper`]?.toFixed(2) ?? '—'}
              </span>
            </div>,
            <div key={`${n}l`} className="flex flex-col gap-0.5">
              <span className="flex items-baseline gap-1">
                <span className="text-violet-400 font-bold text-sm">{n}σ</span>
                <span className="text-[10px] text-slate-600 uppercase tracking-widest">lower</span>
              </span>
              <span className="font-mono text-sm font-bold text-slate-200">
                {d[`${sigmaSymbol}_s${n}_lower`]?.toFixed(2) ?? '—'}
              </span>
            </div>,
          ])}
        </div>
      </details>
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
  const spxLast = data.live?.spx?.last ?? null
  const biasColor =
    d.directional_bias?.toLowerCase().includes('bull') ? 'text-green-400' :
    d.directional_bias?.toLowerCase().includes('bear') ? 'text-red-400' : 'text-slate-300'

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

        {/* ── Sigma scale visualization ── */}
        <SigmaScale d={d} spxLast={spxLast} sigmaSymbol={sigmaSymbol}
          onSymbolChange={setSigmaSymbol} />
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

export function AlmaActiveRules({ rules }) {
  if (!rules?.length) return null
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest">
          Active Rules ({rules.length})
        </p>
        <p className="text-[10px] text-slate-600">
          Strongest evidence first · <span className="text-green-500">Signal</span> = placement carries
          information; Context = reliable stat explained by proximity, not an edge
        </p>
      </div>
      <div className="space-y-3">
        {rules.map(rule => {
          const signal = rule.actionable_as_signal
          const s = rule.stats ?? {}
          return (
            <div
              key={rule.id}
              className={`rounded-lg border p-3 flex flex-col gap-2 ${
                signal
                  ? 'border-green-900/40 bg-green-950/10'
                  : 'border-slate-800 bg-slate-900/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] text-slate-600">#{rule.rank}</span>
                    <p className="text-xs font-semibold text-slate-200">{rule.name}</p>
                    <span className="text-[10px] text-slate-600 uppercase">{rule.horizon}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-snug mt-1">{rule.finding}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${signal ? SIGNAL_BADGE : CONTEXT_BADGE}`}>
                    {signal ? 'Signal' : 'Context'}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${TIER_COLORS[rule.reliability_tier] ?? TIER_COLORS.EXPLORATORY}`}>
                    {rule.reliability_tier}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {s.estimate != null && (
                  <span className="font-mono text-[11px] text-slate-400">
                    {s.estimate}%{s.n != null ? ` · n=${s.n}` : ''}
                  </span>
                )}
                <span className="text-[10px] text-slate-600">
                  placebo {rule.placebo_status?.toLowerCase()}
                </span>
                {!signal && s.naive_benchmark && (
                  <span className="text-[10px] text-slate-600 truncate" title={s.naive_benchmark}>
                    vs naive: {s.naive_benchmark}
                  </span>
                )}
              </div>

              {rule.interpretation && (
                <p className="text-[11px] text-slate-500 leading-relaxed">{rule.interpretation}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
