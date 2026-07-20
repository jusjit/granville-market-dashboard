import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { annotateEvents, fetchVolHistory } from '../lib/volsurface'

// Series colors validated for dark surfaces (dataviz palette slots 1–2);
// kink status colors from the fixed status palette.
const C = {
  spot: '#3987e5',      // blue — spot IV
  forward: '#199e70',   // aqua — forward IV
  kink: '#fab219',      // warning — kink detected
  confirmed: '#d03b3b', // critical — kink confirmed by spot-into-forward
  lowConf: '#898781',   // muted — low-confidence reading
  grid: '#2c2c2a',
  ink: '#898781',
}

function SpotDot({ cx, cy, payload }) {
  if (cx == null || cy == null) return null
  // Low-confidence readings render as a hollow grey dot regardless of kink state.
  if (payload.lowConfidence) {
    return <circle cx={cx} cy={cy} r={4} fill="none" stroke={C.lowConf} strokeWidth={1.5} strokeDasharray="2 1.5" />
  }
  if (!payload.kink) return <circle cx={cx} cy={cy} r={3} fill={C.spot} />
  const color = payload.confirmed ? C.confirmed : C.kink
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={color} stroke="#1a1a19" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={9} fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
    </g>
  )
}

function VolTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-xl max-w-xs">
      <p className="font-semibold text-slate-200 mb-1">{label}{p.root ? ` · ${p.root}` : ''}</p>
      {p.spotIV != null && (
        <p style={{ color: C.spot }}>Spot IV: {(p.spotIV * 100).toFixed(2)}%</p>
      )}
      {p.forwardIV != null && (
        <p style={{ color: C.forward }}>Forward IV: {(p.forwardIV * 100).toFixed(2)}%</p>
      )}
      {p.histSpotIV != null && (
        <p style={{ color: C.lowConf }}>
          Spot IV (snapshot): {(p.histSpotIV * 100).toFixed(2)}%
          {p.spotIV != null && ` · Δ ${((p.spotIV - p.histSpotIV) * 100 >= 0 ? '+' : '')}${((p.spotIV - p.histSpotIV) * 100).toFixed(2)} pts`}
        </p>
      )}
      {p.events?.length > 0 && (
        <p className="text-slate-400 mt-1">Events: {p.events.join(', ')}</p>
      )}
      {p.kink && (
        <p className="mt-1 font-semibold" style={{ color: p.confirmed ? C.confirmed : C.kink }}>
          {p.confirmed ? '⚠ Confirmed kink — real hedging flow' : 'Kink — elevated vs neighbors'}
        </p>
      )}
      {p.lowConfidence && p.flags?.length > 0 && (
        <p className="mt-1.5 pt-1.5 border-t border-slate-800 text-[11px]" style={{ color: C.lowConf }}>
          ⚠ Low confidence: {p.flags.join('; ')}
        </p>
      )}
    </div>
  )
}

function toRows(surface) {
  return annotateEvents(surface.points, surface.events ?? []).map(p => ({
    ...p,
    tick: p.expiration.slice(5) + (p.events.length ? ` ${p.events.join('/')}` : ''),
  }))
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function VolSurfacePanel({ data, loading, error }) {
  const [historyMode, setHistoryMode] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [selIdx, setSelIdx] = useState(0)
  const [histError, setHistError] = useState(null)

  // Snapshots are ordered newest-first from the API; reverse for the slider so
  // left = oldest, right = newest.
  const ordered = [...snapshots].reverse()

  useEffect(() => {
    if (historyMode && snapshots.length === 0) {
      fetchVolHistory()
        .then(rows => {
          setSnapshots(rows)
          setSelIdx(Math.max(0, rows.length - 1)) // default to most recent
        })
        .catch(err => setHistError(err.message))
    }
  }, [historyMode, snapshots.length])

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-8 text-center text-sm text-slate-600 animate-pulse">
        Loading vol surface…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-4 text-sm text-red-400">
        Vol surface unavailable — {error}
      </div>
    )
  }
  if (!data?.points?.length) return null

  const viewingHistory = historyMode && ordered.length > 0
  const selected = viewingHistory ? ordered[Math.min(selIdx, ordered.length - 1)] : null

  // Base curve is always LIVE. In history mode we OVERLAY the selected past
  // snapshot's spot IV as a ghost line, merged by expiration so both render on
  // the same axis (expiries that rolled off show only on one series).
  const liveRows = toRows(data)
  let points = liveRows
  if (viewingHistory && selected) {
    const byExp = new Map()
    for (const r of liveRows) byExp.set(r.expiration, { ...r })
    for (const h of toRows(selected)) {
      const cur = byExp.get(h.expiration) ?? { expiration: h.expiration, tick: h.tick, events: h.events }
      cur.histSpotIV = h.spotIV
      byExp.set(h.expiration, cur)
    }
    points = [...byExp.values()].sort((a, b) => (a.expiration < b.expiration ? -1 : 1))
  }
  const kinks = points.filter(p => p.kink)
  const lowConf = points.filter(p => p.lowConfidence)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <p className="text-xs text-slate-500">
          SPX ATM implied vol term structure · spot {data.spot?.toFixed(2)} · Tradier/ORATS · SPXW
        </p>
        <button
          onClick={() => setHistoryMode(v => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
            historyMode
              ? 'text-indigo-300 bg-indigo-950/40 border-indigo-800/60'
              : 'text-slate-500 bg-slate-900/40 border-slate-800 hover:text-slate-300'
          }`}
        >
          {historyMode ? '● Comparing snapshot' : 'Compare snapshot'}
        </button>
      </div>

      {historyMode && (
        <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
          {histError ? (
            <p className="text-[11px] text-red-400">History unavailable — {histError}</p>
          ) : ordered.length === 0 ? (
            <p className="text-[11px] text-slate-600">No snapshots stored yet — the 2-hourly cron populates this during market hours.</p>
          ) : (
            <div className="flex items-center gap-3">
              {ordered.length > 1 ? (
                <input
                  type="range"
                  min={0}
                  max={ordered.length - 1}
                  value={Math.min(selIdx, ordered.length - 1)}
                  onChange={e => setSelIdx(parseInt(e.target.value, 10))}
                  className="flex-1 accent-indigo-500"
                />
              ) : (
                <span className="flex-1 text-[11px] text-slate-600">Only one snapshot stored so far — more accumulate every 2h.</span>
              )}
              <span className="text-[11px] whitespace-nowrap" style={{ color: C.lowConf }}>
                overlaying <span className="font-mono text-slate-400">{fmtTime(selected.captured_at)}</span>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <p className="text-[10px] text-slate-600">
          {kinks.length === 0
            ? 'No kinks detected — smooth term structure'
            : `${kinks.length} kink${kinks.length > 1 ? 's' : ''}: ${kinks.map(k => k.expiration + (k.confirmed ? ' (confirmed)' : '')).join(', ')}`}
        </p>
        {lowConf.length > 0 && (
          <p className="text-[10px]" style={{ color: C.lowConf }}>
            {lowConf.length} low-confidence reading{lowConf.length > 1 ? 's' : ''}
          </p>
        )}
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="tick"
              tick={{ fill: C.ink, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
              angle={-35}
              textAnchor="end"
              height={52}
              interval={0}
            />
            <YAxis
              tickFormatter={v => `${(v * 100).toFixed(0)}%`}
              tick={{ fill: C.ink, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<VolTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#c3c2b7' }} iconType="plainline" />
            <Line
              name="Spot IV"
              dataKey="spotIV"
              stroke={C.spot}
              strokeWidth={2}
              dot={<SpotDot />}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            <Line
              name="Forward IV"
              dataKey="forwardIV"
              stroke={C.forward}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={{ r: 3, fill: C.forward }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
            {viewingHistory && (
              <Line
                name={`Spot IV @ ${fmtTime(selected.captured_at)}`}
                dataKey="histSpotIV"
                stroke={C.lowConf}
                strokeWidth={1.5}
                strokeDasharray="2 2"
                dot={{ r: 2, fill: C.lowConf }}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.kink }} />
          Kink — IV &gt;15% above neighbor line
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.confirmed }} />
          Confirmed — spot IV ≥ 90% of forward IV
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block border border-dashed" style={{ borderColor: C.lowConf }} />
          Low confidence — stale/wide/jumped
        </span>
        <span className="ml-auto">Events: FOMC · NFP · CPI · PCE · JOLTS · ISM · UMich · Retail · Homes · earnings</span>
      </div>
    </div>
  )
}
