// End-of-day Alma level log: checks which daily/weekly levels were touched
// by the session range (market_data high/low). Updates once market_data has
// a row for the trading day.

function touched(level, low, high) {
  if (level == null || low == null || high == null) return null
  return low <= level && level <= high
}

export default function AlmaLog({ data }) {
  const d = data?.intraday
  const w = data?.weekly
  const m = data?.market
  if (!d || !m) return null

  const { spx_low: low, spx_high: high } = m

  const levels = [
    { label: 'Daily Centroid', value: d.centroid, scope: 'daily' },
    { label: 'Daily Upside Pivot', value: d.upside_pivot, scope: 'daily' },
    { label: 'Daily Downside Pivot', value: d.downside_pivot, scope: 'daily' },
    { label: 'Daily Upside Target', value: d.upside_target, scope: 'daily' },
    { label: 'Daily Downside Target', value: d.downside_target, scope: 'daily' },
    { label: 'Weekly Centroid', value: w?.weekly_centroid, scope: 'weekly' },
    { label: 'Weekly Upside Pivot', value: w?.weekly_upside_pivot, scope: 'weekly' },
    { label: 'Weekly Downside Pivot', value: w?.weekly_downside_pivot, scope: 'weekly' },
    { label: 'Weekly Upside Target', value: w?.weekly_upside_target, scope: 'weekly' },
    { label: 'Weekly Downside Target', value: w?.weekly_downside_target, scope: 'weekly' },
  ].filter(l => l.value != null)

  const entries = levels.map(l => ({ ...l, hit: touched(l.value, low, high) }))
  const hits = entries.filter(e => e.hit === true).length

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          Alma Signal Log
        </h2>
        <span className="text-[10px] text-slate-700 border border-slate-800 rounded px-1.5 py-0.5">
          Session {m.date} · range {low?.toFixed(2)}–{high?.toFixed(2)} · updates end of trading day
        </span>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <p className="text-xs text-slate-500 mb-3">
          {hits} of {entries.length} tracked levels touched this session
        </p>
        <ul className="space-y-2">
          {entries.map(e => (
            <li key={e.label} className="flex items-center gap-3 text-xs">
              <span className={`shrink-0 w-14 text-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                e.hit
                  ? 'text-green-400 bg-green-950/30 border-green-900/40'
                  : 'text-slate-500 bg-slate-800/40 border-slate-700/40'
              }`}>
                {e.hit ? 'HIT' : 'NOT HIT'}
              </span>
              <span className={`shrink-0 text-[10px] uppercase tracking-widest ${e.scope === 'daily' ? 'text-violet-500' : 'text-sky-500'}`}>
                {e.scope}
              </span>
              <span className="text-slate-300">{e.label}</span>
              <span className="font-mono text-slate-400 ml-auto">{e.value.toFixed(2)}</span>
            </li>
          ))}
        </ul>
        {(d.date !== m.date) && (
          <p className="text-[10px] text-slate-600 mt-3 italic">
            Note: levels are from the {d.date} post, evaluated against the {m.date} session.
          </p>
        )}
      </div>
    </section>
  )
}
