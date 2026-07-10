import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { annotateEvents } from '../lib/volsurface'

// Series colors validated for dark surfaces (dataviz palette slots 1–2);
// kink status colors from the fixed status palette.
const C = {
  spot: '#3987e5',      // blue — spot IV
  forward: '#199e70',   // aqua — forward IV
  kink: '#fab219',      // warning — kink detected
  confirmed: '#d03b3b', // critical — kink confirmed by spot-into-forward
  grid: '#2c2c2a',
  ink: '#898781',
}

function KinkDot({ cx, cy, payload }) {
  if (!payload.kink) {
    return <circle cx={cx} cy={cy} r={3} fill={C.spot} />
  }
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
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-slate-200 mb-1">{label}</p>
      <p style={{ color: C.spot }}>Spot IV: {(p.spotIV * 100).toFixed(2)}%</p>
      {p.forwardIV != null && (
        <p style={{ color: C.forward }}>Forward IV: {(p.forwardIV * 100).toFixed(2)}%</p>
      )}
      {p.events?.length > 0 && (
        <p className="text-slate-400 mt-1">Events: {p.events.join(', ')}</p>
      )}
      {p.kink && (
        <p className="mt-1 font-semibold" style={{ color: p.confirmed ? C.confirmed : C.kink }}>
          {p.confirmed ? '⚠ Confirmed kink — real hedging flow' : 'Kink — elevated vs neighbors'}
        </p>
      )}
    </div>
  )
}

export default function VolSurfacePanel({ data, loading, error }) {
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

  const points = annotateEvents(data.points).map(p => ({
    ...p,
    // recharts-friendly short label with event tag
    tick: p.expiration.slice(5) + (p.events.length ? ` ${p.events.join('/')}` : ''),
  }))
  const kinks = points.filter(p => p.kink)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <p className="text-xs text-slate-500">
          SPX ATM implied vol term structure · spot {data.spot?.toFixed(2)} · Tradier/ORATS
        </p>
        <p className="text-[10px] text-slate-600">
          {kinks.length === 0
            ? 'No kinks detected — smooth term structure'
            : `${kinks.length} kink${kinks.length > 1 ? 's' : ''}: ${kinks.map(k => k.expiration + (k.confirmed ? ' (confirmed)' : '')).join(', ')}`}
        </p>
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
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#c3c2b7' }}
              iconType="plainline"
            />
            <Line
              name="Spot IV"
              dataKey="spotIV"
              stroke={C.spot}
              strokeWidth={2}
              dot={<KinkDot />}
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
          Confirmed — spot IV ≥ 90% of forward IV (real put buying)
        </span>
        <span className="ml-auto">Events hardcoded 2026: FOMC · NFP · CPI</span>
      </div>
    </div>
  )
}
