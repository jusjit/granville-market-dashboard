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
  const pct = signal.pctChange ?? 0
  const pctSign = pct >= 0 ? '+' : ''
  const pctColor = pct > 0 ? 'text-green-400' : pct < 0 ? 'text-red-400' : 'text-slate-500'
  const trend = pct > 0.01 ? 'up' : pct < -0.01 ? 'down' : 'flat'

  const ratioDisplay = signal.ratioNow != null
    ? signal.denominator
      ? signal.ratioNow.toFixed(4)
      : `$${signal.ratioNow.toFixed(2)}`
    : '—'

  const scoreMax = signal.doubleWeight ? 40 : 20
  const scoreDisplay = signal.doubleWeight ? signal.score / 2 : signal.score

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-3 ${styles.wrap}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
            {signal.denominator ? `${signal.numerator} / ${signal.denominator}` : signal.numerator}
          </p>
          <h3 className="text-sm font-semibold text-white mt-0.5 leading-tight">{signal.label}</h3>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${styles.badge}`}>
            {signal.reading}
          </span>
          {signal.doubleWeight && (
            <span className="text-[10px] text-slate-500">2× weight</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="font-mono text-lg font-bold text-white">{ratioDisplay}</span>
        <span className={`flex items-center gap-1 font-mono text-xs ${pctColor}`}>
          <TrendIcon trend={trend} className={pctColor} />
          {signal.pctChange != null ? `${pctSign}${pct.toFixed(2)}%` : '—'}
        </span>
        <span className={`ml-auto text-xs font-bold ${styles.accent}`}>
          {scoreDisplay}/20
        </span>
      </div>

      {signal.denominator && signal.numPrice != null && (
        <div className="flex gap-3 text-[11px] text-slate-500 font-mono">
          <span>{signal.numerator}: ${signal.numPrice.toFixed(2)}</span>
          <span>{signal.denominator}: ${signal.denPrice.toFixed(2)}</span>
        </div>
      )}

      <p className="text-xs text-slate-400 leading-relaxed">{signal.description}</p>

      {signal.error && (
        <p className="text-[11px] text-red-400 mt-1">⚠ Data unavailable</p>
      )}
    </div>
  )
}
