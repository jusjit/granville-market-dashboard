import { useState } from 'react'

// Kink & event scorecard — descriptive tracking. Rules and definitions: lib/kinkScorecard.mjs.

const fmt = (v, d = 2) => v == null ? '—' : v.toFixed(d)
const sgn = (v, d = 1) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`
const md = s => s ? s.slice(5).replace('-', '/') : ''

function Th({ children, title, right = true }) {
  return <th title={title} className={`py-1 pr-3 font-medium whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}

function NextSession({ label, n }) {
  if (!n) return null
  const flag = n.neu ? 'flagged (new rule)' : n.orig ? 'flagged (original rule only)' : 'not flagged'
  return (
    <p className="text-[11px] text-slate-400">
      <span className="text-slate-500">{label}:</span> {md(n.session)}{n.types.length ? ` (${n.types.join(', ')})` : ''} — one-day vol{' '}
      <span className="font-mono text-slate-200">{sgn(n.premiumPct)}%</span> vs usual,{' '}
      <span className="font-mono text-slate-200">{sgn(n.vsUsualPct)}%</span> after the usual event premium →{' '}
      <span className={n.neu ? 'text-amber-300' : n.orig ? 'text-slate-300' : 'text-slate-500'}>{flag}</span>
    </p>
  )
}

function OneDayTable({ data, minDays }) {
  const rows = []
  for (const [ratio, label] of [['vix9d', 'VIX1D/VIX9D'], ['vix', 'VIX1D/VIX']]) {
    for (const [rule, rLabel] of [['new', 'new'], ['original', 'original']]) {
      for (const period of ['baseline', 'forward']) {
        const g = data[ratio]?.[period]?.[rule]
        if (g) rows.push({ key: `${ratio}-${rule}-${period}`, label: `${label} · ${rLabel}`, period, g })
      }
    }
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-[10px] text-slate-600 uppercase tracking-widest">
            <Th right={false}>Ratio · rule</Th>
            <Th right={false}>Period</Th>
            <Th>Flagged days</Th>
            <Th title="Absolute SPX move ÷ VIX1D-implied 1σ. About 0.80 means priced fairly; lower means options were rich.">Move ÷ priced (flag / other)</Th>
            <Th title="Close-to-close SPX on the flagged day, bp">Next day bp (flag / other)</Th>
            <Th>Up % flagged</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, period, g }) => (
            <tr key={key} className={`border-t border-slate-800/40 ${period === 'forward' ? 'text-slate-200' : 'text-slate-500'}`}>
              <td className="py-1 pr-3 whitespace-nowrap">{label}</td>
              <td className="py-1 pr-3">{period === 'forward' ? `forward (${g.flagged.n}/${minDays})` : 'baseline'}</td>
              <td className="py-1 pr-3 text-right">{g.flagged.n}</td>
              <td className="py-1 pr-3 text-right">{fmt(g.flagged.z)} / {fmt(g.other.z)}</td>
              <td className="py-1 pr-3 text-right">{sgn(g.flagged.retBp)} / {sgn(g.other.retBp)}</td>
              <td className="py-1 text-right">{g.flagged.upPct == null ? '—' : `${g.flagged.upPct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SurfaceTable({ surface, minWindows }) {
  const groups = [['original', 'Kinks, original rule'], ['new', 'Kinks, new rule'], ['event', 'Windows with a macro event'], ['ordinary', 'Ordinary windows']]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-[10px] text-slate-600 uppercase tracking-widest">
            <Th right={false}>Group</Th>
            <Th right={false}>Period</Th>
            <Th>Finished (pending)</Th>
            <Th title="Realized vol over the window ÷ its forward vol. 1.0 = priced fairly.">Realized ÷ implied</Th>
            <Th>SPX up %</Th>
            <Th>SPX bp/day</Th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap(([k, label]) => ['baseline', 'forward'].map(period => {
            const g = surface[period][k]
            const kinked = k === 'original' || k === 'new'
            return (
              <tr key={k + period} className={`border-t border-slate-800/40 ${period === 'forward' ? 'text-slate-200' : 'text-slate-500'}`}>
                <td className="py-1 pr-3 whitespace-nowrap">{label}</td>
                <td className="py-1 pr-3">{period === 'forward' ? (kinked ? `forward (${g.finished}/${minWindows})` : 'forward') : 'baseline'}</td>
                <td className="py-1 pr-3 text-right">{g.finished} ({g.pending})</td>
                <td className="py-1 pr-3 text-right">{fmt(g.realizedOverImplied)}</td>
                <td className="py-1 pr-3 text-right">{g.upPct == null ? '—' : `${g.upPct}%`}</td>
                <td className="py-1 text-right">{sgn(g.bpPerDay)}</td>
              </tr>
            )
          }))}
        </tbody>
      </table>
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

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 mt-3">
      <button onClick={toggle} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          {open ? '▾' : '▸'} Kink &amp; event scorecard
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-slate-600 border border-slate-800 rounded px-1.5 py-0.5">descriptive · tracking since 11/09</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          {loading && <p className="text-xs text-slate-600 animate-pulse">Computing scorecard…</p>}
          {error && <p className="text-xs text-red-400">Scorecard unavailable — {error}</p>}
          {data && (
            <>
              <div className="space-y-1">
                <NextSession label="VIX1D/VIX9D" n={data.oneDay.vix9d?.next} />
                <NextSession label="VIX1D/VIX" n={data.oneDay.vix?.next} />
              </div>

              <div>
                <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">One-day premium · data through {md(data.oneDayDataThrough)}</p>
                <OneDayTable data={data.oneDay} minDays={data.thresholds.forwardMinDays} />
              </div>

              <div>
                <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">Surface kinks · data through {md(data.surface.dataThrough)}</p>
                <SurfaceTable surface={data.surface} minWindows={data.thresholds.forwardMinWindows} />
              </div>

              {data.surface.flagged.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">Flagged windows (latest first)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] font-mono">
                      <thead>
                        <tr className="text-[10px] text-slate-600 uppercase tracking-widest">
                          <Th right={false}>Window</Th><Th right={false}>Rule</Th><Th right={false}>Events</Th><Th>Fwd vol</Th><Th>Realized ÷ implied</Th><Th>SPX bp</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.surface.flagged.map(w => (
                          <tr key={w.near + w.far} className="border-t border-slate-800/40 text-slate-300">
                            <td className="py-1 pr-3 whitespace-nowrap">{md(w.near)}→{md(w.far)}</td>
                            <td className="py-1 pr-3">{w.rules.join(' + ')}</td>
                            <td className="py-1 pr-3 text-slate-500">{w.events?.length ? w.events.join(', ') : '—'}</td>
                            <td className="py-1 pr-3 text-right">{fmt(w.forwardVolPct, 1)}%</td>
                            <td className="py-1 pr-3 text-right">{w.finished ? fmt(w.realizedOverImplied) : <span className="text-slate-600">pending</span>}</td>
                            <td className="py-1 text-right">{w.finished ? sgn(w.retBp, 0) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-slate-600 leading-relaxed">
                Rules fixed 11/09; only the forward rows count as evidence. The baseline is where the rules and the direction
                pattern were found, so it will look better than what follows. Descriptive until the forward sample reaches{' '}
                {data.thresholds.forwardMinDays} flagged days and {data.thresholds.forwardMinWindows} finished kinked windows.
                Original rule = 15% above the usual level / neighbours; new rule = the same after removing the usual macro-event premium.
                Not trade signals.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
