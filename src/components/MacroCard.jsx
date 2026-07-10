const STATE_COLORS = {
  Complacent: 'text-green-400 bg-green-950/30 border-green-900/40',
  Calm: 'text-green-400 bg-green-950/30 border-green-900/40',
  Elevated: 'text-amber-400 bg-amber-950/30 border-amber-900/40',
  Fear: 'text-red-400 bg-red-950/30 border-red-900/40',
  Backwardation: 'text-red-400 bg-red-950/30 border-red-900/40',
  Contango: 'text-green-400 bg-green-950/30 border-green-900/40',
  'Steep Contango': 'text-green-400 bg-green-950/30 border-green-900/40',
  'Yen Strengthening': 'text-red-400 bg-red-950/30 border-red-900/40',
  'Yen Weakening': 'text-green-400 bg-green-950/30 border-green-900/40',
  Neutral: 'text-slate-400 bg-slate-800/40 border-slate-700/40',
  'Front-loaded Fear': 'text-red-400 bg-red-950/30 border-red-900/40',
  'Back-loaded': 'text-amber-400 bg-amber-950/30 border-amber-900/40',
  Balanced: 'text-green-400 bg-green-950/30 border-green-900/40',
  'Manual Check': 'text-slate-400 bg-slate-800/40 border-slate-700/40',
  Widening: 'text-red-400 bg-red-950/30 border-red-900/40',
  Tightening: 'text-green-400 bg-green-950/30 border-green-900/40',
  Stable: 'text-slate-400 bg-slate-800/40 border-slate-700/40',
  Rising: 'text-red-400 bg-red-950/30 border-red-900/40',
  Falling: 'text-green-400 bg-green-950/30 border-green-900/40',
  Strengthening: 'text-red-400 bg-red-950/30 border-red-900/40',
  Weakening: 'text-green-400 bg-green-950/30 border-green-900/40',
  Outperforming: 'text-green-400 bg-green-950/30 border-green-900/40',
  Inline: 'text-slate-400 bg-slate-800/40 border-slate-700/40',
  Underperforming: 'text-red-400 bg-red-950/30 border-red-900/40',
}

export default function MacroCard({ signal }) {
  if (signal.error) {
    return (
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4 flex flex-col gap-2">
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">{signal.ticker ?? '—'}</p>
        <h3 className="text-sm font-semibold text-slate-500">{signal.label}</h3>
        <p className="text-[11px] text-slate-600 italic mt-auto">Data unavailable</p>
      </div>
    )
  }

  const stateClass = STATE_COLORS[signal.state] ?? 'text-slate-400 bg-slate-800/40 border-slate-700/40'
  const pct = signal.pctChange
  const pctColor = pct == null ? '' : pct > 0 ? 'text-green-400' : pct < 0 ? 'text-red-400' : 'text-slate-500'

  return (
    <div className={`rounded-xl border border-slate-700/50 p-4 flex flex-col gap-3 ${signal.staticTile ? 'bg-slate-900/30 border-dashed' : 'bg-slate-900/50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">{signal.ticker}</p>
          <h3 className="text-sm font-semibold text-slate-200 mt-0.5 leading-tight">{signal.label}</h3>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${stateClass}`}>
          {signal.state}
        </span>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="font-mono text-lg font-bold text-slate-100">{signal.formatted}</span>
        {pct != null && (
          <span className={`font-mono text-xs ${pctColor}`}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-600 font-medium">{signal.source}</span>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">{signal.meaning}</p>
    </div>
  )
}
