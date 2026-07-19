import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { ChevronDown } from 'lucide-react'
import { fetchReferenceHistory } from '../lib/referencedata'

const C = {
  vix: '#ef5350',      // red — VIX
  fedWatch: '#42a5f5', // blue — Fed rates
  grid: '#2c2c2a',
  ink: '#898781',
}

function VixTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-slate-200 mb-1">{p.contract}</p>
      <p style={{ color: C.vix }}>Price: {p.price?.toFixed(2)}</p>
      {p.histPrice != null && (
        <p style={{ color: '#898781' }}>
          Snapshot: {p.histPrice.toFixed(2)}
          {p.price != null && ` · Δ ${(p.price - p.histPrice >= 0 ? '+' : '')}${(p.price - p.histPrice).toFixed(2)}`}
        </p>
      )}
    </div>
  )
}

function FedWatchTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-slate-200 mb-1">{p.rate}</p>
      <p style={{ color: C.fedWatch }}>Probability: {p.prob?.toFixed(2)}%</p>
      {p.histProb != null && (
        <p style={{ color: '#898781' }}>
          Snapshot: {p.histProb.toFixed(2)}%
          {p.prob != null && ` · Δ ${(p.prob - p.histProb >= 0 ? '+' : '')}${(p.prob - p.histProb).toFixed(2)}%`}
        </p>
      )}
    </div>
  )
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function ReferenceDataPanel({ data, loading, error }) {
  const [collapsed, setCollapsed] = useState(true)
  const [historyMode, setHistoryMode] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [selIdx, setSelIdx] = useState(0)
  const [histError, setHistError] = useState(null)
  const [histLoading, setHistLoading] = useState(false)

  // Snapshots ordered newest-first from API; reverse for slider (left=oldest)
  const ordered = [...snapshots].reverse()

  useEffect(() => {
    if (historyMode && snapshots.length === 0) {
      setHistLoading(true)
      fetchReferenceHistory()
        .then(rows => {
          setSnapshots(rows)
          setSelIdx(Math.max(0, rows.length - 1))
          setHistError(null)
        })
        .catch(err => setHistError(err.message))
        .finally(() => setHistLoading(false))
    }
  }, [historyMode, snapshots.length])

  if (!data && !loading && !error) return null

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-8 text-center text-sm text-slate-600 animate-pulse">
        Loading reference data…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-4 text-sm text-red-400">
        Reference data unavailable — {error}
      </div>
    )
  }

  if (!data || (!data.vix && !data.fed)) return null

  const viewingHistory = historyMode && ordered.length > 0
  const selected = viewingHistory ? ordered[Math.min(selIdx, ordered.length - 1)] : null

  // Prepare VIX chart data
  const vixChartData = []
  if (data.vix?.contracts) {
    for (const [contract, price] of Object.entries(data.vix.contracts)) {
      vixChartData.push({ contract, price })
    }
  }

  // Overlay historical VIX if comparing
  if (viewingHistory && selected?.vix?.contracts) {
    const byContract = new Map()
    for (const row of vixChartData) byContract.set(row.contract, { ...row })
    for (const [contract, histPrice] of Object.entries(selected.vix.contracts)) {
      const cur = byContract.get(contract) ?? { contract }
      cur.histPrice = histPrice
      byContract.set(contract, cur)
    }
    vixChartData.length = 0
    vixChartData.push(...Array.from(byContract.values()))
  }

  // Prepare Fed Watch chart data
  const fedChartData = []
  if (data.fed?.rates) {
    for (const [rate, prob] of Object.entries(data.fed.rates)) {
      fedChartData.push({ rate, prob })
    }
  }

  // Overlay historical Fed Watch if comparing
  if (viewingHistory && selected?.fed?.rates) {
    const byRate = new Map()
    for (const row of fedChartData) byRate.set(row.rate, { ...row })
    for (const [rate, histProb] of Object.entries(selected.fed.rates)) {
      const cur = byRate.get(rate) ?? { rate }
      cur.histProb = histProb
      byRate.set(rate, cur)
    }
    fedChartData.length = 0
    fedChartData.push(...Array.from(byRate.values()))
  }

  return (
    <section>
      <button
        onClick={() => setCollapsed(v => !v)}
        className="flex items-center gap-2 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-widest hover:text-slate-400 transition-colors"
      >
        <ChevronDown size={14} style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
        Reference Data
      </button>

      {!collapsed && (
        <div className="space-y-4">
          {/* Snapshot comparison controls */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
              <p className="text-xs text-slate-500">
                VX monthly futures (vixcentral / CBOE delayed) · CME Fed rate expectations · FRED
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
                {histLoading ? (
                  <p className="text-[11px] text-slate-600 animate-pulse">Loading snapshots…</p>
                ) : histError ? (
                  <p className="text-[11px] text-red-400">History unavailable — {histError}</p>
                ) : ordered.length === 0 ? (
                  <p className="text-[11px] text-slate-600">No snapshots stored yet — the 4-hourly cron populates this during market hours.</p>
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
                      <span className="flex-1 text-[11px] text-slate-600">Only one snapshot stored so far — more accumulate every 4h.</span>
                    )}
                    {selected && (
                      <span className="text-[11px] whitespace-nowrap text-slate-400">
                        comparing <span className="font-mono">{fmtTime(selected.captured_at)}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Charts grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* VIX Futures Chart */}
              {vixChartData.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-600 mb-2">VX Futures Term Structure (CBOE delayed)</p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={vixChartData} margin={{ top: 12, right: 16, bottom: 20, left: 0 }}>
                        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="contract"
                          tick={{ fill: C.ink, fontSize: 10 }}
                          tickLine={false}
                          axisLine={{ stroke: C.grid }}
                        />
                        <YAxis
                          tick={{ fill: C.ink, fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          width={40}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip content={<VixTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#c3c2b7' }} iconType="plainline" />
                        <Line
                          name="VIX Price"
                          dataKey="price"
                          stroke={C.vix}
                          strokeWidth={2}
                          dot={{ r: 3, fill: C.vix }}
                          activeDot={{ r: 5 }}
                          connectNulls
                          isAnimationActive={false}
                        />
                        {viewingHistory && (
                          <Line
                            name={`VIX @ ${fmtTime(selected.captured_at)}`}
                            dataKey="histPrice"
                            stroke="#898781"
                            strokeWidth={1.5}
                            strokeDasharray="2 2"
                            dot={{ r: 2, fill: '#898781' }}
                            activeDot={{ r: 4 }}
                            connectNulls
                            isAnimationActive={false}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* CME FedWatch Chart */}
              {fedChartData.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-600 mb-2">Fed Funds Rate Expectations</p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={fedChartData} margin={{ top: 12, right: 16, bottom: 20, left: 0 }}>
                        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="rate"
                          tick={{ fill: C.ink, fontSize: 9 }}
                          tickLine={false}
                          axisLine={{ stroke: C.grid }}
                          angle={-45}
                          textAnchor="end"
                          height={60}
                        />
                        <YAxis
                          tickFormatter={v => `${v.toFixed(0)}%`}
                          tick={{ fill: C.ink, fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          width={40}
                          domain={[0, 100]}
                        />
                        <Tooltip content={<FedWatchTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#c3c2b7' }} />
                        <Bar name="Probability" dataKey="prob" fill={C.fedWatch} opacity={0.8} isAnimationActive={false} />
                        {viewingHistory && (
                          <Bar
                            name={`Prob @ ${fmtTime(selected.captured_at)}`}
                            dataKey="histProb"
                            fill="#898781"
                            opacity={0.4}
                            isAnimationActive={false}
                          />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
