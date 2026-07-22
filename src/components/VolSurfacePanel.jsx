import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { annotateEvents, fetchVolHistory } from '../lib/volsurface'

const C = {
  spot: '#3987e5',
  forward: '#199e70',
  kink: '#fab219',
  confirmed: '#d03b3b',
  lowConf: '#898781',
  grid: '#2c2c2a',
  ink: '#898781',
  event: '#6366f1',
}

function SpotDot({ cx, cy, payload, onDotClick }) {
  if (cx == null || cy == null) return null
  const handleClick = (e) => {
    e.stopPropagation()
    onDotClick?.(payload.expiration)
  }
  if (payload.lowConfidence) {
    return (
      <g onClick={handleClick} style={{ cursor: 'pointer' }}>
        <circle cx={cx} cy={cy} r={10} fill="transparent" />
        <circle cx={cx} cy={cy} r={4} fill="none" stroke={C.lowConf} strokeWidth={1.5} strokeDasharray="2 1.5" />
        {payload.events?.length > 0 && (
          <circle cx={cx} cy={cy - 8} r={2} fill={C.event} />
        )}
      </g>
    )
  }
  if (!payload.kink) {
    return (
      <g onClick={handleClick} style={{ cursor: 'pointer' }}>
        <circle cx={cx} cy={cy} r={10} fill="transparent" />
        <circle cx={cx} cy={cy} r={3} fill={C.spot} />
        {payload.events?.length > 0 && (
          <circle cx={cx} cy={cy - 8} r={2} fill={C.event} />
        )}
      </g>
    )
  }
  const color = payload.confirmed ? C.confirmed : C.kink
  return (
    <g onClick={handleClick} style={{ cursor: 'pointer' }}>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={6} fill={color} stroke="#1a1a19" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={9} fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
      {payload.events?.length > 0 && (
        <circle cx={cx} cy={cy - 12} r={2} fill={C.event} />
      )}
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
    tick: p.expiration.slice(5),
  }))
}

function EventTick({ x, y, payload, data }) {
  const point = data?.find(p => p.tick === payload?.value)
  const hasEvents = point?.events?.length > 0
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="end" fill={C.ink} fontSize={10} transform="rotate(-35)">
        {payload?.value}
      </text>
      {hasEvents && (
        <circle cx={0} cy={22} r={2.5} fill={C.event} opacity={0.8} />
      )}
    </g>
  )
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function VolSurfacePanel({ data, loading, error, onRefresh }) {
  const [historyMode, setHistoryMode] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [selIdx, setSelIdx] = useState(0)
  const [histError, setHistError] = useState(null)
  const [selectedExp, setSelectedExp] = useState(null)

  const ordered = [...snapshots].reverse()

  useEffect(() => {
    if (historyMode && snapshots.length === 0) {
      fetchVolHistory()
        .then(rows => {
          setSnapshots(rows)
          setSelIdx(Math.max(0, rows.length - 1))
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
  const withEvents = points.filter(p => p.events?.length > 0)

  const handleDotClick = (expiration) => {
    setSelectedExp(prev => prev === expiration ? null : expiration)
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <p className="text-xs text-slate-500">
          SPX ATM implied vol term structure · spot {data.spot?.toFixed(2)} · Tradier/ORATS · SPXW
        </p>
        <div className="flex items-center gap-1.5">
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
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="text-[10px] px-2 py-0.5 rounded border border-slate-800 bg-slate-900/40 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
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
              tick={<EventTick data={points} />}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
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
              dot={props => <SpotDot {...props} onDotClick={handleDotClick} />}
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

      {withEvents.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {withEvents.map(p => (
            <button
              key={p.expiration}
              onClick={() => handleDotClick(p.expiration)}
              className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                selectedExp === p.expiration
                  ? 'bg-indigo-950/50 border-indigo-700/60 text-indigo-200'
                  : 'bg-slate-900/40 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-600'
              }`}
            >
              {p.tick} ({p.events.length})
            </button>
          ))}
        </div>
      )}

      {selectedExp && (() => {
        const sp = points.find(p => p.expiration === selectedExp)
        if (!sp?.events?.length) return (
          <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 flex items-center justify-between">
            <p className="text-[11px] text-slate-500">{selectedExp} — no events in this window</p>
            <button onClick={() => setSelectedExp(null)} className="text-[10px] text-slate-600 hover:text-slate-400 ml-3">dismiss</button>
          </div>
        )
        return (
          <div className="mt-1.5 rounded-lg border border-indigo-900/50 bg-indigo-950/20 px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold text-indigo-300">Events before {sp.tick} expiry</p>
              <button onClick={() => setSelectedExp(null)} className="text-[10px] text-slate-600 hover:text-slate-400">dismiss</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sp.events.map(ev => (
                <span key={ev} className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-950/60 border border-indigo-800/40 text-indigo-200">
                  {ev}
                </span>
              ))}
            </div>
          </div>
        )
      })()}

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
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C.event }} />
          Tap dot or date to see events
        </span>
      </div>
    </div>
  )
}
