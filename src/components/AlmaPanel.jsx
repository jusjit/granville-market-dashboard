import { useState } from 'react'

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

  return (
    <div className="space-y-4">
      {/* ── Daily levels card ─────────────────────────────── */}
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <Level label="Upside Pivot" value={d.upside_pivot} accent="text-green-400" />
          <Level label="Downside Pivot" value={d.downside_pivot} accent="text-red-400" />
          <Level label="Upside Target" value={d.upside_target} accent="text-green-500/70" />
          <Level label="Downside Target" value={d.downside_target} accent="text-red-500/70" />
        </div>

        {/* Sigma bands with symbol tabs */}
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

      {/* ── Weekly levels card (distinct styling) ─────────── */}
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

      {/* ── Active rules — ordered strongest evidence first (rank) ────── */}
      {data.activeRules?.length > 0 && (
        <div>
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <p className="text-[10px] text-slate-600 uppercase tracking-widest">
              Active Rules ({data.activeRules.length})
            </p>
            <p className="text-[10px] text-slate-600">
              Strongest evidence first · <span className="text-green-500">Signal</span> = placement carries
              information; Context = reliable stat explained by proximity, not an edge
            </p>
          </div>
          <div className="space-y-3">
            {data.activeRules.map(rule => {
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
      )}
    </div>
  )
}
