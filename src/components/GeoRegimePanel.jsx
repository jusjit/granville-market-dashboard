import { useState, useEffect, useCallback, Component } from 'react'
import { ChevronDown } from 'lucide-react'

class GeoErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-3 text-sm text-red-400">
          <p className="font-semibold mb-1">Geo Regime render error</p>
          <p className="text-xs text-red-400/70 font-mono break-all">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} className="text-xs text-slate-400 mt-2 hover:text-slate-200">
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/* ── Glossary tooltips ── */

const GLOSSARY = {
  ucdp: 'Uppsala Conflict Data Program — tracks armed conflicts worldwide',
  cii: 'Country Instability Index — composite fragility score per country',
  crossSource: 'Cross-source convergence — same signal detected by multiple independent feeds',
  posture: 'Theater military posture — naval/air force deployments near chokepoints',
  shipping: 'Shipping stress — transit delays, diversions, and insurance cost spikes',
  chokepoint: 'Maritime chokepoint — narrow passage where shipping can be disrupted',
  chokepoints: 'Maritime chokepoints — narrow passages where shipping can be disrupted',
  flowRatio: 'Flow ratio — current vs. normal vessel transit volume through a corridor',
  warRiskTier: "Lloyd's Joint War Committee risk tier — determines insurance premiums",
  'full-scan': 'Complete dataset re-evaluation — all sources queried, full LLM analysis',
  'gated-triggered': 'Delta scan — only changed categories sent to LLM (cost-saving)',
  'gated-skip': 'No material change detected — LLM not called, zero tokens used',
  oil_shock_risk: 'Probability of a supply-driven oil price spike from disruption',
  carry_unwind: 'Risk of leveraged FX carry trades unwinding (JPY strength signal)',
  equity_drawdown_severity: 'Expected equity market drawdown from geo escalation',
  safe_haven_bid: 'Flight-to-safety demand for USD, treasuries, gold, CHF',
  freight_cost_shock: 'Risk of sharp rise in shipping/freight costs',
  em_fx_stress: 'Emerging market currency stress from risk-off flows',
}

function Tip({ term, children }) {
  const tip = GLOSSARY[term]
  if (!tip) return children ?? <span>{term}</span>
  return (
    <span className="relative group/tip cursor-help border-b border-dotted border-slate-600">
      {children ?? term}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-[10px] text-slate-200 bg-slate-800 border border-slate-700 whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity z-50 max-w-[250px] whitespace-normal text-center">
        {tip}
      </span>
    </span>
  )
}

const RUN_TYPE_STYLE = {
  'full-scan': 'bg-indigo-950/50 border-indigo-800/40 text-indigo-300',
  'gated-triggered': 'bg-amber-950/50 border-amber-800/40 text-amber-300',
  'gated-skip': 'bg-slate-800/50 border-slate-700/40 text-slate-400',
}

const IMPLICATION_LABELS = {
  oil_shock_risk: 'Oil Shock',
  carry_unwind: 'Carry Unwind',
  equity_drawdown_severity: 'Equity Drawdown',
  safe_haven_bid: 'Safe Haven',
  freight_cost_shock: 'Freight Shock',
  em_fx_stress: 'EM FX Stress',
}

const CATEGORY_LABELS = {
  chokepoint: 'Chokepoint',
  conflict: 'Conflict',
  supply_chain: 'Supply Chain',
  policy: 'Policy',
}

const STATE_STYLE = {
  escalating: 'text-red-400',
  stable: 'text-slate-400',
  de_escalating: 'text-emerald-400',
}

function severityColor(sev) {
  if (sev >= 60) return 'text-red-400'
  if (sev >= 30) return 'text-amber-400'
  return 'text-slate-400'
}

function severityBg(sev) {
  if (sev >= 60) return 'bg-red-950/40 border-red-900/40'
  if (sev >= 30) return 'bg-amber-950/30 border-amber-900/30'
  return 'bg-slate-800/40 border-slate-700/40'
}

function RunTypeBadge({ type }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${RUN_TYPE_STYLE[type] ?? RUN_TYPE_STYLE['gated-skip']}`}>
      {type}
    </span>
  )
}

function fmtAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN VIEW — World Briefing + Trajectory + Market Pricing + Headlines
   ═══════════════════════════════════════════════════════════════════════ */

/* ── World Briefing (Minto pyramid: bottom line → theme detail) ── */

function WorldBriefing({ latestRun }) {
  const briefing = latestRun?.verdict?.briefing
  if (!briefing) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">World Briefing</p>
        <p className="text-[11px] text-slate-600 italic">Briefing unavailable for this run — will appear after the next LLM assessment.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-indigo-900/30 bg-indigo-950/10 px-4 py-3">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">World Briefing</p>
      <p className="text-[13px] text-slate-200 font-semibold leading-snug mb-3">{briefing.bottom_line}</p>
      {briefing.themes?.length > 0 && (
        <div className="space-y-2">
          {briefing.themes.map((t, i) => (
            <div key={i} className="rounded-lg border border-slate-800/60 bg-slate-900/30 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-300 mb-0.5">{t.region}</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">{t.situation}</p>
              {t.sources_confirmed?.length > 0 && (
                <div className="flex items-center gap-1 mt-1.5">
                  <span className="text-[9px] text-slate-600">Sources:</span>
                  {t.sources_confirmed.map((s, j) => (
                    <Tip key={j} term={s}>
                      <span className="px-1 py-0.5 rounded text-[9px] bg-slate-800/60 border border-slate-700/40 text-slate-500">
                        {s}
                      </span>
                    </Tip>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {latestRun && (
        <p className="text-[9px] text-slate-600 mt-2">
          Based on {latestRun.run_type} · {fmtAgo(latestRun.evaluated_at)}
        </p>
      )}
    </div>
  )
}

/* ── Trajectory Layer (7/14/30-day trend per theme) ── */

const THEME_BUCKETS = [
  { key: 'oil_energy', label: 'Oil / Energy', pattern: /oil|energy|hormuz|tanker|lng/i },
  { key: 'carry_unwind', label: 'Carry Unwind', pattern: /carry|yen|boj|jpy/i },
  { key: 'equity_drawdown', label: 'Equity Drawdown', pattern: /equity|drawdown|taiwan|conflict/i },
  { key: 'safe_haven', label: 'Safe Haven', pattern: /haven|gold|flight.to.quality/i },
  { key: 'freight_shock', label: 'Freight / Shipping', pattern: /freight|shipping|chokepoint|suez|red sea|mandeb/i },
]

function bucketTheme(riskCategory) {
  if (!riskCategory) return 'other'
  for (const b of THEME_BUCKETS) {
    if (b.pattern.test(riskCategory)) return b.key
  }
  return 'other'
}

function MiniSparkline({ points, color = 'text-slate-400', flagged = false }) {
  if (!points || points.length < 2) {
    return <span className="text-[9px] text-slate-700">—</span>
  }
  const w = 48, h = 18
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const range = max - min || 1
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 2) - 1
    return `${x},${y}`
  }).join(' ')

  const strokeClass = flagged ? 'stroke-red-400' : 'stroke-slate-400'

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block">
      <polyline points={coords} fill="none" className={strokeClass} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function trendArrow(points) {
  if (!points || points.length < 2) return { symbol: '—', color: 'text-slate-600' }
  const first = points.slice(0, Math.ceil(points.length / 2))
  const second = points.slice(Math.ceil(points.length / 2))
  const avgFirst = first.reduce((a, b) => a + b, 0) / first.length
  const avgSecond = second.reduce((a, b) => a + b, 0) / second.length
  const diff = avgSecond - avgFirst
  if (diff > 5) return { symbol: '↑', color: 'text-red-400' }
  if (diff < -5) return { symbol: '↓', color: 'text-emerald-400' }
  return { symbol: '→', color: 'text-slate-500' }
}

function TrajectoryLayer({ trajectory, headlineVolume }) {
  const [windowDays, setWindowDays] = useState(7)

  if (!trajectory || trajectory.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Trajectory</p>
        <p className="text-[11px] text-slate-600 italic">Trajectory data will appear once enough runs have accumulated.</p>
      </div>
    )
  }

  const cutoff = Date.now() - windowDays * 86400000
  const windowRuns = trajectory.filter(r => new Date(r.evaluated_at).getTime() >= cutoff)

  const themeData = {}
  for (const b of THEME_BUCKETS) themeData[b.key] = []

  for (const run of windowRuns) {
    if (!run.flagged) continue
    const theme = bucketTheme(run.risk_category)
    if (themeData[theme]) {
      themeData[theme].push({ t: new Date(run.evaluated_at).getTime(), confidence: run.confidence ?? 0 })
    }
  }

  const allConfidencePoints = windowRuns
    .filter(r => r.confidence != null && r.run_type !== 'gated-skip')
    .sort((a, b) => new Date(a.evaluated_at) - new Date(b.evaluated_at))
    .map(r => r.confidence)

  const flaggedCount = windowRuns.filter(r => r.flagged).length
  const totalAssessed = windowRuns.filter(r => r.run_type !== 'gated-skip').length

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Trajectory</p>
        <div className="flex gap-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                windowDays === d
                  ? 'text-violet-300 bg-violet-950/40 border-violet-800/60'
                  : 'text-slate-500 bg-slate-900/40 border-slate-800 hover:text-slate-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Overall confidence sparkline */}
      <div className="flex items-center gap-2 mb-2 py-1 border-b border-slate-800/40">
        <span className="text-[10px] text-slate-500 w-28 shrink-0">Overall confidence</span>
        <MiniSparkline points={allConfidencePoints} flagged={flaggedCount > 0} />
        {(() => { const t = trendArrow(allConfidencePoints); return <span className={`text-[11px] ${t.color}`}>{t.symbol}</span> })()}
        <span className="text-[9px] text-slate-600 ml-auto">
          {flaggedCount}/{totalAssessed} flagged
        </span>
      </div>

      {/* Per-theme rows */}
      <div className="space-y-1">
        {THEME_BUCKETS.map(b => {
          const points = themeData[b.key]
            .sort((a, c) => a.t - c.t)
            .map(p => p.confidence)
          const hasFlagged = points.length > 0
          const trend = trendArrow(points)
          return (
            <div key={b.key} className="flex items-center gap-2 py-0.5">
              <span className="text-[10px] text-slate-500 w-28 shrink-0 truncate">{b.label}</span>
              {hasFlagged ? (
                <>
                  <MiniSparkline points={points} flagged />
                  <span className={`text-[11px] ${trend.color}`}>{trend.symbol}</span>
                  <span className="text-[9px] text-slate-600 ml-auto">{points.length} flag{points.length !== 1 ? 's' : ''}</span>
                </>
              ) : (
                <span className="text-[9px] text-slate-700">quiet</span>
              )}
            </div>
          )
        })}
      </div>

      {/* GDELT headline volume */}
      {headlineVolume?.length > 0 && (
        <div className="flex items-center gap-2 pt-1.5 mt-1.5 border-t border-slate-800/40">
          <span className="text-[10px] text-slate-500 w-28 shrink-0">Headline volume</span>
          <MiniSparkline points={headlineVolume.slice(-24).map(p => p.value)} />
          {(() => { const t = trendArrow(headlineVolume.slice(-24).map(p => p.value)); return <span className={`text-[11px] ${t.color}`}>{t.symbol}</span> })()}
          <span className="text-[9px] text-slate-600 ml-auto">GDELT</span>
        </div>
      )}

      <p className="text-[9px] text-slate-600 mt-2">
        {windowRuns.length} runs in {windowDays}d window · sparklines show LLM confidence over time
      </p>
    </div>
  )
}

/* ── Market Pricing (unchanged) ── */

function MarketPricing({ marketPricing }) {
  if (!marketPricing) return null
  const items = [
    { key: 'wti', ...marketPricing.wti },
    { key: 'vix', ...marketPricing.vix },
    { key: 'hyOas', ...marketPricing.hyOas },
    { key: 'yen', ...marketPricing.yen },
  ].filter(i => i.value != null)

  if (items.length === 0) return null

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
        Market Pricing <span className="normal-case font-normal text-slate-600">(independent — not used in geo scoring)</span>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map(i => (
          <div key={i.key} className="rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5">
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">{i.label}</p>
            <p className="text-sm font-semibold tabular-nums text-slate-300">
              {typeof i.value === 'number' ? i.value.toFixed(2) : i.value}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-600 mt-1.5">
        Compare against geo severity — these values do not influence the risk assessment.
      </p>
    </div>
  )
}

/* ── Headlines (GDELT, broadened language) ── */

const GDELT_QUERY = '(hormuz OR "bab el-mandeb" OR houthi OR "red sea" OR "taiwan strait" OR "south china sea")'
const GDELT_URL = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_QUERY)}&mode=artlist&maxrecords=8&format=json&sort=datedesc`
const GDELT_VOL_URL = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_QUERY)}&mode=timelinevol&format=json`
const HEADLINE_REFRESH_MS = 20 * 60 * 1000

function shortDomain(domain) {
  return (domain ?? '').replace(/^www\./, '').split('.').slice(0, -1).join('.') || domain
}

function useHeadlines() {
  const [headlines, setHeadlines] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt))
        const r = await fetch(GDELT_URL)
        if (r.status === 429) { continue }
        if (!r.ok) throw new Error(`GDELT ${r.status}`)
        const data = await r.json()
        setHeadlines(data.articles ?? [])
        setError(null)
        setStale(false)
        setLoading(false)
        return
      } catch (e) {
        if (attempt === 2) {
          setError(e.message)
          setStale(prev => prev || headlines.length > 0)
        }
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, HEADLINE_REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  return { headlines, loading, error, stale }
}

function useHeadlineVolume() {
  const [volume, setVolume] = useState([])

  useEffect(() => {
    const fetchVol = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt))
          const r = await fetch(GDELT_VOL_URL)
          if (r.status === 429) { continue }
          if (!r.ok) return
          const data = await r.json()
          const timeline = data.timeline?.[0]?.data ?? []
          setVolume(timeline.map(d => ({ date: d.date, value: d.value })))
          return
        } catch { /* retry */ }
      }
    }
    const delay = setTimeout(fetchVol, 10000)
    const id = setInterval(fetchVol, HEADLINE_REFRESH_MS)
    return () => { clearTimeout(delay); clearInterval(id) }
  }, [])

  return volume
}

function gdeltTime(seendate) {
  if (!seendate) return ''
  const d = new Date(seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))
  const ms = Date.now() - d.getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function Headlines() {
  const { headlines, loading, error, stale } = useHeadlines()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? headlines.slice(0, 8) : headlines.slice(0, 3)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
        Breaking Headlines <span className="normal-case font-normal text-slate-600">(GDELT · refreshes every 20m · not used in scoring)</span>
        {stale && <span className="text-amber-600 ml-1">(stale — refresh failed)</span>}
      </p>
      {loading && headlines.length === 0 && (
        <p className="text-[10px] text-slate-600 animate-pulse">Loading headlines…</p>
      )}
      {error && headlines.length === 0 && (
        <p className="text-[10px] text-red-400/70">Headlines unavailable — retried 3×, GDELT may be rate-limiting</p>
      )}
      {visible.length > 0 && (
        <div className="space-y-0.5">
          {visible.map((a, i) => (
            <div key={i} className="flex items-baseline gap-1.5 text-[11px] leading-tight py-0.5">
              <span className="text-slate-600 shrink-0 tabular-nums w-6 text-right">{gdeltTime(a.seendate)}</span>
              <span className="text-slate-500 shrink-0 truncate max-w-[80px]">{shortDomain(a.domain)}</span>
              <a href={a.url} target="_blank" rel="noopener noreferrer"
                 className="text-slate-300 hover:text-slate-100 truncate transition-colors">
                {a.title}
              </a>
            </div>
          ))}
        </div>
      )}
      {headlines.length > 3 && (
        <button onClick={() => setExpanded(v => !v)}
                className="text-[10px] text-slate-600 hover:text-slate-400 mt-1 transition-colors">
          {expanded ? 'show fewer' : `+${headlines.length - 3} more`}
        </button>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   DIAGNOSTICS VIEW — all former default content, collapsed
   ═══════════════════════════════════════════════════════════════════════ */

function deriveRegime(signals) {
  const buckets = {}
  let escalating = 0
  for (const s of signals) {
    if (s.implication && s.implication !== 'none') {
      const key = s.implication
      buckets[key] = Math.max(buckets[key] ?? 0, s.severity ?? 0)
    }
    if (s.state === 'escalating') escalating++
  }
  return { buckets, escalating }
}

function RegimeSummary({ allSignals, latestRun }) {
  if (!allSignals?.length) return null
  const { buckets, escalating } = deriveRegime(allSignals)
  const implications = [
    { key: 'oil_shock_risk', label: 'Oil Shock' },
    { key: 'carry_unwind', label: 'Carry Unwind' },
    { key: 'equity_drawdown_severity', label: 'Equity Drawdown' },
    { key: 'safe_haven_bid', label: 'Safe Haven' },
    { key: 'freight_cost_shock', label: 'Freight Shock' },
  ].map(i => ({ ...i, value: buckets[i.key] ?? 0 })).filter(i => i.value > 0)

  const maxSeverity = Math.max(...implications.map(i => i.value ?? 0), 0)
  const summaryColor = maxSeverity >= 60 ? 'border-red-900/40 bg-red-950/15'
    : maxSeverity >= 30 ? 'border-amber-900/30 bg-amber-950/10'
    : 'border-slate-800 bg-slate-900/30'

  return (
    <div className={`rounded-xl border ${summaryColor} px-4 py-3`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Regime Summary</p>
        {escalating > 0 && (
          <span className="text-[10px] text-red-400">{escalating} escalating</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {implications.map(i => (
          <div key={i.key} className={`rounded-lg border px-2.5 py-1.5 ${severityBg(i.value)}`}>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">{i.label}</p>
            <p className={`text-lg font-semibold tabular-nums ${severityColor(i.value)}`}>{i.value}</p>
          </div>
        ))}
      </div>
      {latestRun && (
        <p className="text-[9px] text-slate-600 mt-2">
          Last assessed {fmtAgo(latestRun.evaluated_at)} · {latestRun.run_type}
          {latestRun.flagged && ` · flagged: ${latestRun.risk_category}`}
        </p>
      )}
    </div>
  )
}

const STALENESS_THRESHOLD_DAYS = 14
const CHOKEPOINT_NAMES = {
  hormuz_strait: 'Hormuz',
  bab_el_mandeb: 'Bab el-Mandeb',
  suez: 'Suez',
  taiwan_strait: 'Taiwan Strait',
}
const TIER_SHORT = {
  WAR_RISK_TIER_WAR_ZONE: 'War Zone',
  WAR_RISK_TIER_CRITICAL: 'Critical',
  WAR_RISK_TIER_HIGH: 'High',
  WAR_RISK_TIER_ELEVATED: 'Elevated',
  WAR_RISK_TIER_NORMAL: 'Normal',
}

function TierStaleness({ tierTracking }) {
  if (!tierTracking) return null
  const now = Date.now()
  const stale = Object.entries(tierTracking)
    .map(([id, t]) => ({
      id,
      name: CHOKEPOINT_NAMES[id] ?? id,
      tier: TIER_SHORT[t.tier] ?? t.tier,
      daysStale: Math.floor((now - new Date(t.last_changed_at).getTime()) / 86400000),
    }))
    .filter(t => t.daysStale >= STALENESS_THRESHOLD_DAYS)
    .sort((a, b) => b.daysStale - a.daysStale)

  if (stale.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-900/40 bg-amber-950/15 px-3 py-2">
      <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider mb-1.5">
        Stale Risk Tiers
      </p>
      <div className="space-y-1">
        {stale.map(s => (
          <div key={s.id} className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300">{s.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">{s.tier}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/50 border border-amber-800/30 text-amber-400">
                {s.daysStale}d unchanged
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-amber-700 mt-1.5">
        Upstream warRiskTier is manually configured — verify these still reflect current conditions.
      </p>
    </div>
  )
}

function StandingSignals({ signals }) {
  if (!signals?.length) return null
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Monitored Signals</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {signals.map(s => (
          <div key={s.slug} className={`rounded-lg border px-3 py-2 ${severityBg(s.severity)}`}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] font-semibold text-slate-200 truncate">{s.name}</span>
              <span className={`text-sm font-semibold tabular-nums ml-2 ${severityColor(s.severity)}`}>
                {s.severity}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px]">
              <span className="px-1 py-0.5 rounded bg-slate-800/60 border border-slate-700/40 text-slate-400">
                {CATEGORY_LABELS[s.category] ?? s.category}
              </span>
              <span className={STATE_STYLE[s.state] ?? 'text-slate-400'}>
                {s.state?.replace('_', '-')}
              </span>
              {s.implication && s.implication !== 'none' && (
                <span className="text-slate-500">→ {IMPLICATION_LABELS[s.implication] ?? s.implication.replace(/_/g, ' ')}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RunCard({ run, expanded, onToggle }) {
  const verdict = run.verdict ?? {}
  const dismissed = run.categories_dismissed_reason ?? {}
  const considered = run.categories_considered ?? []
  const dismissedKeys = Object.keys(dismissed)
  const diff = run.diff ?? {}
  const diffKeys = Object.keys(diff)
  const [showDetail, setShowDetail] = useState(false)

  const isSkip = run.run_type === 'gated-skip'

  return (
    <div className={`rounded-lg border ${run.flagged ? 'border-red-900/40 bg-red-950/10' : 'border-slate-800 bg-slate-950/40'}`}>
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-800/30 transition-colors rounded-lg"
      >
        <ChevronDown
          size={12}
          className="text-slate-600 shrink-0"
          style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
        />
        <span className="text-[11px] text-slate-500 font-mono shrink-0">{fmtTime(run.evaluated_at)}</span>

        {run.flagged ? (
          <span className="text-[11px] text-red-300 truncate">
            <span className="font-semibold">{run.risk_category ?? 'flagged'}</span>
            {run.confidence > 0 && <span className="text-red-400/70"> · {run.confidence}%</span>}
          </span>
        ) : isSkip ? (
          <span className="text-[11px] text-slate-500">No change</span>
        ) : (
          <span className="text-[11px] text-emerald-500">Clear</span>
        )}

        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <RunTypeBadge type={run.run_type} />
          <span className="text-[10px] text-slate-600">{fmtAgo(run.evaluated_at)}</span>
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-800/60">
          {!isSkip && verdict.reasoning && (
            <div className="mt-2 mb-2">
              <p className="text-[11px] text-slate-300 leading-relaxed">{verdict.reasoning}</p>
              {verdict.transmission_chain && (
                <p className="text-[10px] text-slate-500 mt-1">
                  <span className="font-medium text-slate-400">Transmission:</span> {verdict.transmission_chain}
                </p>
              )}
            </div>
          )}

          {isSkip && (
            <p className="mt-2 mb-2 text-[11px] text-slate-500 italic">No material change since last snapshot — LLM not called.</p>
          )}

          {diffKeys.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <span className="text-[10px] text-slate-500 shrink-0">Changed:</span>
              {diffKeys.map(k => (
                <Tip key={k} term={k}>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/40 border border-amber-800/30 text-amber-300">
                    {k}
                  </span>
                </Tip>
              ))}
            </div>
          )}

          {(considered.length > 0 || dismissedKeys.length > 0) && (
            <div>
              <button
                onClick={() => setShowDetail(v => !v)}
                className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1"
              >
                <ChevronDown
                  size={10}
                  style={{ transform: showDetail ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
                />
                {considered.length} included · {dismissedKeys.length} excluded
              </button>

              {showDetail && (
                <div className="mt-1.5 space-y-2 pl-3 border-l border-slate-800/60">
                  {considered.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-500 shrink-0">Included:</span>
                      {considered.map(c => (
                        <Tip key={c} term={c}>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/60 border border-slate-700/40 text-slate-300">
                            {c}
                          </span>
                        </Tip>
                      ))}
                    </div>
                  )}

                  {dismissedKeys.length > 0 && (
                    <div>
                      <span className="text-[10px] text-slate-500">Excluded:</span>
                      <div className="mt-0.5 space-y-0.5">
                        {dismissedKeys.map(k => {
                          const val = dismissed[k]
                          const text = typeof val === 'string' ? val
                            : typeof val === 'object' && val !== null ? Object.entries(val).map(([subK, subV]) => `${subK}: ${subV}`).join('; ')
                            : String(val)
                          return (
                            <div key={k} className="flex gap-1.5 text-[10px]">
                              <Tip term={k}><span className="text-slate-400 shrink-0">{k}</span></Tip>
                              <span className="text-slate-600">— {text}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {run.token_usage && (
                    <p className="text-[9px] text-slate-700">
                      {run.token_usage.inputToken?.toLocaleString()} in / {run.token_usage.totalToken?.toLocaleString()} total tokens
                      {run.token_usage.credit != null && ` · ${run.token_usage.credit} credits`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {run.source_errors?.length > 0 && (
            <p className="text-[10px] text-red-400/70 mt-1.5">
              Source errors: {run.source_errors.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Main Panel — tab-switched between Main and Diagnostics
   ═══════════════════════════════════════════════════════════════════════ */

export default function GeoRegimePanel({ data, loading, error }) {
  const [collapsed, setCollapsed] = useState(true)
  const [view, setView] = useState('main')
  const [expandedRun, setExpandedRun] = useState(null)

  const headlineVolume = useHeadlineVolume()

  const runs = data?.runs ?? []
  const allSignals = data?.signals ?? []
  const trajectory = data?.trajectory ?? []
  const latestRun = runs[0]

  const standingSignals = allSignals.filter(s => !s.slug?.startsWith('llm-'))
  const aiSignalCount = allSignals.length - standingSignals.length

  const handleToggle = () => {
    setCollapsed(v => {
      if (v && expandedRun === null && latestRun) setExpandedRun(latestRun.id)
      return !v
    })
  }

  return (
    <div>
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-widest hover:text-slate-400 transition-colors"
      >
        <ChevronDown
          size={14}
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        />
        Geo Regime
        {!collapsed && latestRun && (
          <span className="normal-case tracking-normal font-normal text-slate-600 text-[10px] ml-1">
            last run {fmtAgo(latestRun.evaluated_at)}
          </span>
        )}
      </button>

      {!collapsed && (
        <GeoErrorBoundary>
          <div className="space-y-4">
            {loading && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-6 text-center text-sm text-slate-600 animate-pulse">
                Loading geo regime…
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-3 text-sm text-red-400">
                Geo regime unavailable — {error}
              </div>
            )}

            {!loading && !error && (
              <>
                {/* Tab switcher */}
                <div className="flex gap-1">
                  {[
                    { key: 'main', label: 'Main' },
                    { key: 'diagnostics', label: 'Diagnostics' },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setView(tab.key)}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                        view === tab.key
                          ? 'text-violet-300 bg-violet-950/40 border-violet-800/60'
                          : 'text-slate-500 bg-slate-900/40 border-slate-800 hover:text-slate-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {view === 'main' && (
                  <>
                    <WorldBriefing latestRun={latestRun} />
                    <TrajectoryLayer trajectory={trajectory} headlineVolume={headlineVolume} />
                    <MarketPricing marketPricing={data?.marketPricing} />
                    <Headlines />
                  </>
                )}

                {view === 'diagnostics' && (
                  <>
                    <RegimeSummary allSignals={allSignals} latestRun={latestRun} />
                    <TierStaleness tierTracking={data?.tierTracking} />
                    <StandingSignals signals={standingSignals} />

                    {aiSignalCount > 0 && (
                      <p className="text-[9px] text-slate-600">
                        + {aiSignalCount} LLM-generated flag{aiSignalCount !== 1 ? 's' : ''} in signal history
                      </p>
                    )}

                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        Recent Runs ({runs.length})
                      </p>
                      <div className="space-y-1">
                        {runs.map(run => (
                          <RunCard
                            key={run.id}
                            run={run}
                            expanded={expandedRun === run.id}
                            onToggle={() => setExpandedRun(prev => prev === run.id ? null : run.id)}
                          />
                        ))}
                      </div>
                      {runs.length === 0 && (
                        <p className="text-[11px] text-slate-600">No runs recorded yet — the 4-hourly cron populates this.</p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </GeoErrorBoundary>
      )}
    </div>
  )
}
