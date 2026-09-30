// Overnight Context (descriptive) — no signals, no scores. Data from
// /api/reference?type=overnight (Yahoo, delayed). All times America/Chicago.

const FLAG_TEXT = {
  es_stale: 'ES feed stale',
  es_missing: 'ES feed missing',
  es_overnight_missing: 'No overnight bars',
  vix_missing: 'VIX missing — no σ',
  n225_missing: 'Nikkei missing', n225_stale: 'Nikkei stale',
  hsi_missing: 'Hang Seng missing', hsi_stale: 'Hang Seng stale',
  dax_missing: 'DAX missing', dax_stale: 'DAX stale',
  sx5e_missing: 'Euro Stoxx missing', sx5e_stale: 'Euro Stoxx stale',
}

const SEGMENTS = [
  ['postclose', 'Post-close'],
  ['asia', 'Asia'],
  ['europe', 'Europe'],
  ['preopen', 'Pre-open'],
]

const POSITION = {
  inside: 'Inside prior RTH range',
  above: 'Above prior RTH high',
  below: 'Below prior RTH low',
  outside: 'Outside (both sides)',
}

function fmtCt(epochSec, withDate = false) {
  if (epochSec == null) return '—'
  return new Date(epochSec * 1000).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric', minute: '2-digit',
  }) + ' CT'
}

const num = (v, d = 2) => v == null ? '—' : v.toFixed(d)
const signed = (v, d = 2) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`
const moveColor = v => v == null || v === 0 ? 'text-slate-300' : v > 0 ? 'text-green-400' : 'text-red-400'

function Stat({ label, value, sub, valueClass }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-600 uppercase tracking-widest">{label}</span>
      <span className={`font-mono text-sm font-bold ${valueClass ?? 'text-slate-200'}`}>{value}</span>
      {sub && <span className="font-mono text-[10px] text-slate-500">{sub}</span>}
    </div>
  )
}

function Chip({ children, tone = 'amber' }) {
  const cls = tone === 'red'
    ? 'text-red-300 bg-red-950/30 border-red-900/50'
    : tone === 'slate'
      ? 'text-slate-400 bg-slate-900/50 border-slate-700/50'
      : 'text-amber-300 bg-amber-950/30 border-amber-900/50'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>{children}</span>
}

function foreignStatus(f) {
  if (f.status === 'closed') return <span className="text-slate-500">closed</span>
  if (f.status === 'not_open') return <span className="text-slate-500">not open yet</span>
  if (f.status === 'missing') return <span className="text-red-400">missing</span>
  return (
    <span className={f.stale ? 'text-amber-400' : 'text-slate-500'}>
      {f.status === 'intraday' ? 'intraday · ' : 'close · '}{fmtCt(f.asOf)}{f.stale ? ' · stale' : ''}
    </span>
  )
}

export default function OvernightContextPanel({ data, loading, error }) {
  if (loading && !data) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-8 text-center text-sm text-slate-600 animate-pulse">
        Loading overnight context…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-4 text-sm text-red-400">
        Overnight context unavailable — {error}
      </div>
    )
  }
  if (!data) return null
  if (data.error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-4 text-sm text-red-400">
        {data.error}
      </div>
    )
  }

  const on = data.overnight
  const g = data.gap
  const partial = on && !on.complete
  const esFlat = g.label === 'flat' || g.pts == null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-5">
      {/* Header: session, timestamps, feed flags */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
            Session {data.sessionDate} · overnight 5:00pm–8:30am CT
          </p>
          <p className="text-[10px] text-slate-600 mt-1">
            ES=F last bar {fmtCt(data.esDataAsOf, true)} · computed {fmtCt(Date.parse(data.computedAt) / 1000)} · Yahoo, ~10–15 min delayed
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {partial && <Chip>Overnight in progress</Chip>}
          {data.rollWeek && <Chip>ES roll week — ratios distorted</Chip>}
          {data.priorRth?.halfDay && <Chip tone="slate">Prior day half session</Chip>}
          {data.feedFlags.map(f => (
            <Chip key={f} tone={f.endsWith('missing') ? 'red' : 'amber'}>{FLAG_TEXT[f] ?? f}</Chip>
          ))}
        </div>
      </div>

      <p className="text-sm text-slate-300 leading-relaxed">{data.summary}</p>

      {/* 1–3: ES overnight, gap, position */}
      {on ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="ON Open" value={num(on.open)} />
          <Stat label="ON High" value={num(on.high)} />
          <Stat label="ON Low" value={num(on.low)} />
          <Stat label={partial ? 'ON Last' : 'ES @ 8:30'} value={num(partial ? on.last : g.es830)} />
          <Stat
            label="ON Range"
            value={`${num(on.range)} pts`}
            sub={on.rangeRatio != null ? `${num(on.rangeRatio)}× 20d avg (${num(on.rangeAvg20)})${partial ? ' · partial' : ''}` : null}
          />
          <Stat
            label="ON Volume"
            value={on.volume.toLocaleString()}
            sub={on.volumeRatio != null ? `${num(on.volumeRatio)}× 20d avg${partial ? ' · partial' : ''}` : null}
          />
          <Stat
            label={`Gap${g.provisional ? ' (so far)' : ''}`}
            value={`${signed(g.pts)} pts`}
            valueClass={moveColor(g.pts)}
            sub={g.sigma != null ? `${signed(g.sigma)}σ · ${g.label} · σ=${num(g.sigmaPts)} pts (VIX ${num(g.vix)})` : 'σ unavailable'}
          />
          <Stat
            label="Range Position"
            value={POSITION[data.rangePosition] ?? '—'}
            sub={data.priorRth ? `prior RTH ${data.priorRth.date}: H ${num(data.priorRth.high)} · L ${num(data.priorRth.low)} · C ${num(data.priorRth.close)}` : null}
          />
        </div>
      ) : (
        <p className="text-sm text-slate-500">No overnight ES bars for this session yet.</p>
      )}

      {/* 4: timing split */}
      {data.timing && (
        <div className="border-t border-slate-800/60 pt-4">
          <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-2">
            Timing split of the move · segments sum to the gap
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-[10px] text-slate-600 uppercase tracking-widest text-left">
                  <th className="font-normal py-1 pr-4">Segment</th>
                  <th className="font-normal py-1 pr-4">Window (CT)</th>
                  <th className="font-normal py-1 pr-4 text-right">Pts</th>
                  <th className="font-normal py-1 text-right">% of gap</th>
                </tr>
              </thead>
              <tbody>
                {SEGMENTS.map(([k, label]) => {
                  const s = data.timing[k]
                  const pending = s.bars === 0
                  return (
                    <tr key={k} className="border-t border-slate-800/40">
                      <td className="py-1 pr-4 text-slate-300">{label}</td>
                      <td className="py-1 pr-4 text-slate-500">{s.window}</td>
                      <td className={`py-1 pr-4 text-right ${pending ? 'text-slate-600' : moveColor(s.pts)}`}>
                        {pending ? 'no bars' : signed(s.pts)}
                      </td>
                      <td className="py-1 text-right text-slate-400">{pending || s.pct == null ? '—' : `${num(s.pct, 0)}%`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5: spillover */}
      <div className="border-t border-slate-800/60 pt-4">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-2">
          Spillover · return vs prior close, z vs own 60-day stdev · flag |z| &gt; 1.5
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-[10px] text-slate-600 uppercase tracking-widest text-left">
                <th className="font-normal py-1 pr-4">Index</th>
                <th className="font-normal py-1 pr-4">Status</th>
                <th className="font-normal py-1 pr-4 text-right">Return</th>
                <th className="font-normal py-1 pr-4 text-right">z</th>
                <th className="font-normal py-1 text-right">vs ES</th>
              </tr>
            </thead>
            <tbody>
              {data.foreign.map(f => {
                const live = f.status === 'ok' || f.status === 'intraday'
                return (
                  <tr key={f.key} className="border-t border-slate-800/40">
                    <td className="py-1 pr-4 text-slate-300">{f.label}</td>
                    <td className="py-1 pr-4">{foreignStatus(f)}</td>
                    <td className={`py-1 pr-4 text-right ${live ? moveColor(f.retPct) : 'text-slate-600'}`}>
                      {live ? `${signed(f.retPct)}%` : '—'}
                    </td>
                    <td className={`py-1 pr-4 text-right ${f.flag ? 'text-amber-300 font-bold' : 'text-slate-400'}`}>
                      {live ? `${signed(f.z)}${f.flag ? ' ⚑' : ''}` : '—'}
                    </td>
                    <td className="py-1 text-right text-slate-400">
                      {!live ? '—' : esFlat ? 'ES flat' : f.agrees ? 'agrees' : 'disagrees'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">
          Europe is mid-session at 8:30am CT, so DAX / Euro Stoxx returns are intraday and compared to a full-day stdev.
        </p>
      </div>
    </div>
  )
}
