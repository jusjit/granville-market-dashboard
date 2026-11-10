import { useState } from 'react'

// Kink & event scorecard — descriptive tracking. Rules and definitions: lib/kinkScorecard.mjs.
// Primary view: VIX1D/VIX9D with the original 15% rule. The event-adjusted rule and VIX1D/VIX
// are kept as background only.

const fmt = (v, d = 2) => v == null ? '—' : v.toFixed(d)
const sgn = (v, d = 1) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`
const md = s => s ? s.slice(5).replace('-', '/') : ''
const weekday = s => s ? new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) : ''

function NextSession({ n, baseline }) {
  if (!n) return null
  const flagged = n.orig
  const f = baseline?.original?.flagged, o = baseline?.original?.other
  return (
    <div className={`rounded-lg border px-4 py-3 ${flagged ? 'border-amber-800/60 bg-amber-950/20' : 'border-slate-700/60 bg-slate-900/60'}`}>
      <p className="text-[10px] text-slate-500 uppercase tracking-widest">
        Next session · {weekday(n.session)} {md(n.session)}{n.types.length ? ` · ${n.types.join(', ')}` : ''}
      </p>
      <div className="flex items-baseline gap-3 flex-wrap mt-1">
        <span className={`text-2xl font-bold ${flagged ? 'text-amber-300' : 'text-slate-200'}`}>
          {flagged ? 'Flagged' : 'Not flagged'}
        </span>
        <span className="text-sm text-slate-300">
          one-day vol <span className="font-mono font-semibold">{sgn(n.premiumPct)}%</span> vs usual
          <span className="text-slate-500"> (flag at +15%)</span>
        </span>
      </div>
      {f?.n > 0 && (
        <p className="text-[11px] text-slate-400 mt-2">
          Flagged days so far: SPX next day <span className="font-mono text-slate-200">{sgn(f.retBp)} bp</span> vs{' '}
          <span className="font-mono">{sgn(o.retBp)}</span> on other days, up {f.upPct}% · move ÷ priced{' '}
          <span className="font-mono">{fmt(f.z)}</span> vs <span className="font-mono">{fmt(o.z)}</span>
          <span className="text-slate-600"> (baseline, {f.n} days)</span>
        </p>
      )}
      {n.types.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-1">
          {n.types.join(', ')} days usually carry extra one-day vol; after that usual premium this one is{' '}
          <span className="font-mono">{sgn(n.vsUsualPct)}%</span>.
        </p>
      )}
    </div>
  )
}

// Label | baseline | forward, three narrow columns that fit a phone.
function StatRows({ title, forwardLabel, rows }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{title}</p>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-[11px]">
        <span />
        <span className="text-right text-[10px] text-slate-600 uppercase tracking-widest">Baseline</span>
        <span className="text-right text-[10px] text-slate-400 uppercase tracking-widest">{forwardLabel}</span>
        {rows.map(([label, base, fwd]) => (
          <div key={label} className="contents">
            <span className="py-1 border-t border-slate-800/50 text-slate-400">{label}</span>
            <span className="py-1 border-t border-slate-800/50 text-right font-mono text-slate-500">{base}</span>
            <span className="py-1 border-t border-slate-800/50 text-right font-mono text-slate-200">{fwd}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const pair = (a, b, d) => (a == null && b == null) ? '—' : `${d === 'bp' ? sgn(a) : fmt(a)} / ${d === 'bp' ? sgn(b) : fmt(b)}`

function Background({ data }) {
  const [open, setOpen] = useState(false)
  const line = (label, g) => g && (
    <li key={label}>
      {label}: {g.flagged.n} flagged, next day {sgn(g.flagged.retBp)} vs {sgn(g.other.retBp)} bp, up {g.flagged.upPct ?? '—'}%, move ÷ priced {fmt(g.flagged.z)} vs {fmt(g.other.z)}
    </li>
  )
  const s = data.surface
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="text-[10px] text-slate-600 hover:text-slate-400 uppercase tracking-widest">
        {open ? '▾' : '▸'} Background: other versions
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-[11px] text-slate-500 leading-relaxed">
          {line('VIX1D/VIX9D, event-adjusted rule (baseline)', data.oneDay.vix9d?.baseline?.new)}
          {line('VIX1D/VIX9D, event-adjusted rule (forward)', data.oneDay.vix9d?.forward?.new)}
          {line('VIX1D/VIX, 15% rule (baseline)', data.oneDay.vix?.baseline?.original)}
          {line('VIX1D/VIX, event-adjusted rule (baseline)', data.oneDay.vix?.baseline?.new)}
          {data.oneDay.vix?.next && (
            <li>VIX1D/VIX next session: {sgn(data.oneDay.vix.next.premiumPct)}% vs usual ({data.oneDay.vix.next.orig ? 'flagged' : 'not flagged'})</li>
          )}
          <li>
            Surface kinks, event-adjusted rule (baseline): {s.baseline.new.finished} finished, realized ÷ implied {fmt(s.baseline.new.realizedOverImplied)},
            up {s.baseline.new.upPct ?? '—'}%, {sgn(s.baseline.new.bpPerDay)} bp/day
          </li>
          <li>
            Windows with a macro event (baseline): {s.baseline.event.finished} finished, realized ÷ implied {fmt(s.baseline.event.realizedOverImplied)}
          </li>
        </ul>
      )}
    </div>
  )
}

export default function KinkScorecard() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const toggle = () => {
    setOpen(o => !o)
    if (!data && !loading) {
      setLoading(true)
      fetch('/api/vol-history?type=scorecard')
        .then(r => r.json().then(j => { if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j }))
        .then(j => { setData(j); setError(null) })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false))
    }
  }

  const v9 = data?.oneDay?.vix9d
  const s = data?.surface
  const minD = data?.thresholds?.forwardMinDays, minW = data?.thresholds?.forwardMinWindows
  const kinks = s?.flagged?.filter(w => w.rules.includes('original')) ?? []

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 mt-3">
      <button onClick={toggle} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          {open ? '▾' : '▸'} Kink &amp; event scorecard
        </span>
        <span className="text-[10px] text-slate-600 border border-slate-800 rounded px-1.5 py-0.5">descriptive · since 11/09</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-5">
          {loading && <p className="text-xs text-slate-600 animate-pulse">Computing scorecard…</p>}
          {error && <p className="text-xs text-red-400">Scorecard unavailable — {error}</p>}
          {data && v9 && (
            <>
              <NextSession n={v9.next} baseline={v9.baseline} />

              <StatRows
                title={`One-day vol flags · VIX1D/VIX9D · through ${md(data.oneDayDataThrough)}`}
                forwardLabel={`Forward ${v9.forward.original.flagged.n}/${minD}`}
                rows={[
                  ['Flagged days', v9.baseline.original.flagged.n, v9.forward.original.flagged.n],
                  ['Next day bp, flagged / other', pair(v9.baseline.original.flagged.retBp, v9.baseline.original.other.retBp, 'bp'), pair(v9.forward.original.flagged.retBp, v9.forward.original.other.retBp, 'bp')],
                  ['Up %, flagged', v9.baseline.original.flagged.upPct == null ? '—' : `${v9.baseline.original.flagged.upPct}%`, v9.forward.original.flagged.upPct == null ? '—' : `${v9.forward.original.flagged.upPct}%`],
                  ['Move ÷ priced, flagged / other', pair(v9.baseline.original.flagged.z, v9.baseline.original.other.z), pair(v9.forward.original.flagged.z, v9.forward.original.other.z)],
                ]}
              />

              <StatRows
                title={`Surface kinks · through ${md(s.dataThrough)}`}
                forwardLabel={`Forward ${s.forward.original.finished}/${minW}`}
                rows={[
                  ['Kinked windows finished', s.baseline.original.finished, `${s.forward.original.finished}${s.forward.original.pending ? ` (+${s.forward.original.pending})` : ''}`],
                  ['Realized ÷ implied, kinks / ordinary', pair(s.baseline.original.realizedOverImplied, s.baseline.ordinary.realizedOverImplied), pair(s.forward.original.realizedOverImplied, s.forward.ordinary.realizedOverImplied)],
                  ['SPX up %, kinks', s.baseline.original.upPct == null ? '—' : `${s.baseline.original.upPct}%`, s.forward.original.upPct == null ? '—' : `${s.forward.original.upPct}%`],
                  ['SPX bp/day, kinks / ordinary', pair(s.baseline.original.bpPerDay, s.baseline.ordinary.bpPerDay, 'bp'), pair(s.forward.original.bpPerDay, s.forward.ordinary.bpPerDay, 'bp')],
                ]}
              />

              {kinks.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Recent kinks</p>
                  <ul className="text-[11px] font-mono">
                    {kinks.slice(0, 8).map(w => (
                      <li key={w.near + w.far} className="flex flex-wrap items-baseline gap-x-3 py-1 border-t border-slate-800/50 text-slate-300">
                        <span>{md(w.near)}→{md(w.far)}</span>
                        <span className="text-slate-500">fwd {fmt(w.forwardVolPct, 1)}%</span>
                        {w.finished
                          ? <><span>{fmt(w.realizedOverImplied)}× priced</span><span className={w.retBp >= 0 ? 'text-emerald-400' : 'text-red-400'}>{sgn(w.retBp, 0)} bp</span></>
                          : <span className="text-slate-600">pending</span>}
                        {w.events?.length > 0 && <span className="text-slate-500 font-sans">{w.events.join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Background data={data} />

              <p className="text-[10px] text-slate-600 leading-relaxed">
                Flag: one-day vol 15% above its usual level vs VIX9D (or a surface date 15% above its neighbours). Only forward
                numbers count; the baseline is where these patterns were found and will look better than what follows.
                Descriptive until {minD} forward flagged days and {minW} finished kinks. Not trade signals.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
