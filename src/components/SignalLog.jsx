const ICONS = { Bullish: '▲', Neutral: '●', Bearish: '▼' }
const COLORS = { Bullish: 'text-green-400', Neutral: 'text-yellow-400', Bearish: 'text-red-400' }

function sentence(signal) {
  const dir = signal.pctChange != null
    ? `${signal.pctChange >= 0 ? 'up' : 'down'} ${Math.abs(signal.pctChange).toFixed(2)}% WoW`
    : 'unchanged'

  if (signal.denominator) {
    return `${signal.numerator}/${signal.denominator} ratio ${dir} at ${signal.ratioNow?.toFixed(4) ?? '—'} — ${signal.reading}.`
  }
  return `${signal.numerator} ${dir} at $${signal.ratioNow?.toFixed(2) ?? '—'} — ${signal.reading}.`
}

export default function SignalLog({ signals }) {
  if (!signals?.length) return null

  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-5">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
        Signal Log
      </h2>
      <ul className="space-y-2">
        {signals.map((s) => (
          <li key={s.id} className="flex items-start gap-3 text-sm">
            <span className={`font-bold mt-px shrink-0 ${COLORS[s.reading] ?? 'text-slate-400'}`}>
              {ICONS[s.reading] ?? '●'}
            </span>
            <span className="text-slate-300">
              <span className="font-medium text-white">{s.label}: </span>
              {sentence(s)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
