import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const STYLES = {
  Bullish: {
    wrap: 'border-green-800/50 bg-green-950/40',
    badge: 'bg-green-900/80 text-green-300',
    accent: 'text-green-400',
  },
  Neutral: {
    wrap: 'border-yellow-800/40 bg-yellow-950/30',
    badge: 'bg-yellow-900/60 text-yellow-300',
    accent: 'text-yellow-400',
  },
  Bearish: {
    wrap: 'border-red-800/50 bg-red-950/40',
    badge: 'bg-red-900/80 text-red-300',
    accent: 'text-red-400',
  },
}

function TrendIcon({ trend, className }) {
  if (trend === 'up') return <TrendingUp size={13} className={className} />
  if (trend === 'down') return <TrendingDown size={13} className={className} />
  return <Minus size={13} className="text-slate-500" />
}

export default function SignalCard({ signal }) {
  const styles = STYLES[signal.reading] ?? STYLES.Neutral
  const pctSign = (signal.pctChange ?? 0) >= 0 ? '+' : ''
  const pctColor = (signal.pctChange ?? 0) > 0 ? 'text-green-400' : (signal.pctChange ?? 0) < 0 ? 'text-red-400' : 'text-slate-500'

  const ratioDisplay = signal.ratioNow != null
    ? signal.denominator
      ? signal.ratioNow.toFixed(4)
      : `$${signal.ratioNow.toFixed(2)}`
    : '—'

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-3 ${styles.wrap}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
            {signal.denominator ? `${signal.numerator} / ${signal.denominator}` : signal.numerator}
          </p>
          <h3 className="text-sm font-semibold text-white mt-0.5 leading-tight">{signal.label}</h3>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold ${styles.badge}`}>
          {signal.reading}
        </span>
      </div>

      {/* Ratio + change */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg font-bold text-white">{ratioDisplay}</span>
        <span className={`flex items-center gap-1 font-mono text-xs ${pctColor}`}>
          <TrendIcon trend={signal.trend} className={pctColor} />
          {signal.pctChange != null ? `${pctSign}${signal.pctChange.toFixed(2)}%` : '—'}
        </span>
        <span className={`ml-auto text-xs font-bold ${styles.accent}`}>
          {signal.score}/20
        </span>
      </div>

      {/* Individual prices (ratio signals only) */}
      {signal.denominator && signal.numPrice != null && (
        <div className="flex gap-3 text-[11px] text-slate-500 font-mono">
          <span>{signal.numerator}: ${signal.numPrice.toFixed(2)}</span>
          <span>{signal.denominator}: ${signal.denPrice.toFixed(2)}</span>
        </div>
      )}

      {/* Description */}
      <p className="text-xs text-slate-400 leading-relaxed">{signal.description}</p>

      {signal.error && (
        <p className="text-[11px] text-red-400 mt-1">⚠ {signal.error}</p>
      )}
    </div>
  )
}
