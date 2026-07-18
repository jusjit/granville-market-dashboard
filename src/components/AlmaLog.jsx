// End-of-day Alma level log: checks which daily/weekly levels were touched
// by the session range. Prefers the LIVE intraday high/low (updates
// continuously through the trading day) over the once-daily market_data
// snapshot (only written by the close-time cron), so today's hits show up
// in real time rather than waiting until tomorrow.

// 0.1% touch tolerance — matches the original backtest (alma_pipeline_final.py
// TOL=0.001): a level counts as touched if its ±0.1% band overlaps the session
// high/low, not only on an exact intersection.
const TOL = 0.001

// Daily fields that have exact intraday touch timestamps available (from
// Tradier 15-min bars, computed server-side in api/alma.js). Weekly levels
// only ever have date-level granularity (checked against the week's range),
// so they never get a timestamp — shown as "hit (time unknown)" instead.
const DAILY_FIELD_MAP = {
  'Daily Centroid': 'centroid',
  'Daily Upside Pivot': 'upside_pivot',
  'Daily Downside Pivot': 'downside_pivot',
  'Daily Upside Target': 'upside_target',
  'Daily Downside Target': 'downside_target',
}

function touched(level, low, high) {
  if (level == null || low == null || high == null) return null
  const adj = level * TOL
  return low <= level + adj && high >= level - adj
}

// Tradier bar times are already America/New_York wall-clock (no offset
// marker) — treat as-is, do NOT parse with new Date() (would silently
// mis-shift on a UTC server).
function fmtEtTime(naiveIso) {
  if (!naiveIso) return null
  const m = naiveIso.match(/T(\d{2}):(\d{2})/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${period} ET`
}

export default function AlmaLog({ data }) {
  const d = data?.intraday
  const w = data?.weekly
  const m = data?.market
  const live = data?.live
  const touchTimestamps = data?.touchTimestamps ?? {}
  if (!d) return null

  const usingLive = live?.isToday && live?.spx?.high != null && live?.spx?.low != null
  const low = usingLive ? live.spx.low : m?.spx_low
  const high = usingLive ? live.spx.high : m?.spx_high
  const sessionDate = usingLive ? (live.updatedAt ? new Date(live.updatedAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : d.date) : m?.date
  if (low == null || high == null) return null

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

  const entries = levels.map(l => {
    const hit = touched(l.value, low, high)
    const field = DAILY_FIELD_MAP[l.label]
    const touchedAt = hit && field ? fmtEtTime(touchTimestamps[field]) : null
    return { ...l, hit, touchedAt }
  })
  const hits = entries.filter(e => e.hit === true).length

  return (
    <section>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          Alma Signal Log
        </h2>
        <span className="text-[10px] text-slate-700 border border-slate-800 rounded px-1.5 py-0.5">
          Session {sessionDate} · range {low?.toFixed(2)}–{high?.toFixed(2)}
          {usingLive ? ' · live, updates every 15 min' : ' · from last close snapshot'}
        </span>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <p className="text-xs text-slate-500 mb-3">
          {hits} of {entries.length} tracked levels touched this session
          <span className="text-slate-600"> · ±0.1% tolerance (matches backtest)</span>
        </p>
        <ul className="space-y-2">
          {entries.map(e => (
            <li key={e.label} className="flex items-center gap-3 text-xs flex-wrap">
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
              {e.hit && (
                <span className="text-[10px] font-mono text-amber-400/80">
                  {e.touchedAt ?? (e.scope === 'daily' ? 'time unavailable' : 'time unknown (weekly)')}
                </span>
              )}
              <span className="font-mono text-slate-400 ml-auto">{e.value.toFixed(2)}</span>
              <span className="font-mono text-[10px] text-slate-600 shrink-0" title={`±0.1% tolerance band: ${(e.value * (1 - TOL)).toFixed(2)}–${(e.value * (1 + TOL)).toFixed(2)}`}>
                ±{(e.value * TOL).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        {(!usingLive && d.date !== m?.date) && (
          <p className="text-[10px] text-slate-600 mt-3 italic">
            Note: levels are from the {d.date} post, evaluated against the {m?.date} session.
          </p>
        )}
      </div>
    </section>
  )
}
