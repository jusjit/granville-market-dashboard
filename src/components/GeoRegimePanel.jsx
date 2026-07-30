import { useState, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'

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

/* ── Section 1: Regime Summary (from current_regime view) ── */

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

/* ── Section 2: Tier Staleness Warnings ── */

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

/* ── Section 3: Market Pricing (independent comparison layer) ── */

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
        Compare against geo severity above — these values do not influence the risk assessment.
      </p>
    </div>
  )
}

/* ── Section 4: Breaking Headlines (client-side GDELT, no LLM) ── */

const GDELT_QUERY = '(hormuz OR "bab el-mandeb" OR houthi OR "red sea" OR "taiwan strait" OR "south china sea") sourcelang:english'
const GDELT_URL = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_QUERY)}&mode=artlist&maxrecords=8&format=json&sort=datedesc`
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

/* ── Section 5: Standing Signals (seed signals, not LLM-generated) ── */

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

/* ── Section 4: Recent Runs (expandable cards) ── */

function RunCard({ run, expanded, onToggle }) {
  const verdict = run.verdict ?? {}
  const dismissed = run.categories_dismissed_reason ?? {}
  const considered = run.categories_considered ?? []
  const dismissedKeys = Object.keys(dismissed)
  const diff = run.diff ?? {}
  const diffKeys = Object.keys(diff)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-800/30 transition-colors rounded-lg"
      >
        <ChevronDown
          size={12}
          className="text-slate-600 shrink-0"
          style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
        />
        <span className="text-[11px] text-slate-400 font-mono">{fmtTime(run.evaluated_at)}</span>
        <RunTypeBadge type={run.run_type} />
        {run.flagged && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-950/50 border border-red-800/40 text-red-300">
            flagged
          </span>
        )}
        {run.flagged && run.risk_category && (
          <span className="text-[10px] text-red-400 truncate">{run.risk_category}</span>
        )}
        {!run.flagged && run.run_type !== 'gated-skip' && (
          <span className="text-[10px] text-emerald-500">clear</span>
        )}
        <span className="ml-auto text-[10px] text-slate-600">{fmtAgo(run.evaluated_at)}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-slate-800/60">
          {run.run_type !== 'gated-skip' && verdict.reasoning && (
            <div className="mt-2">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Synthesis</p>
              <p className="text-[11px] text-slate-300 leading-relaxed">{verdict.reasoning}</p>
              {verdict.transmission_chain && (
                <p className="text-[11px] text-slate-400 mt-1">
                  <span className="text-slate-500">Chain:</span> {verdict.transmission_chain}
                </p>
              )}
              {run.confidence > 0 && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  <span className="text-slate-500">Confidence:</span> {run.confidence}%
                </p>
              )}
            </div>
          )}

          {run.run_type === 'gated-skip' && (
            <p className="mt-2 text-[11px] text-slate-500 italic">No LLM call — material state unchanged since last snapshot.</p>
          )}

          {diffKeys.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">What changed</p>
              <div className="flex flex-wrap gap-1">
                {diffKeys.map(k => (
                  <Tip key={k} term={k}>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/40 border border-amber-800/30 text-amber-300">
                      {k}
                    </span>
                  </Tip>
                ))}
              </div>
            </div>
          )}

          {considered.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Considered ({considered.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {considered.map(c => (
                  <Tip key={c} term={c}>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/60 border border-slate-700/40 text-slate-300">
                      {c}
                    </span>
                  </Tip>
                ))}
              </div>
            </div>
          )}

          {dismissedKeys.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Excluded ({dismissedKeys.length})
              </p>
              <div className="space-y-1">
                {dismissedKeys.map(k => {
                  const val = dismissed[k]
                  const text = typeof val === 'string' ? val
                    : typeof val === 'object' && val !== null ? Object.entries(val).map(([subK, subV]) => `${subK}: ${subV}`).join('; ')
                    : String(val)
                  return (
                    <div key={k} className="flex gap-2 text-[10px]">
                      <Tip term={k}><span className="text-slate-400 shrink-0">{k}</span></Tip>
                      <span className="text-slate-500">{text}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {run.token_usage && (
            <p className="text-[10px] text-slate-600">
              {run.token_usage.inputToken?.toLocaleString()} in / {run.token_usage.totalToken?.toLocaleString()} total tokens
              {run.token_usage.credit != null && ` · ${run.token_usage.credit} credits`}
            </p>
          )}

          {run.source_errors?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-0.5">Source errors</p>
              {run.source_errors.map((e, i) => (
                <p key={i} className="text-[10px] text-red-400/70">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main Panel ── */

export default function GeoRegimePanel({ data, loading, error }) {
  const [collapsed, setCollapsed] = useState(true)
  const [expandedRun, setExpandedRun] = useState(null)

  const runs = data?.runs ?? []
  const allSignals = data?.signals ?? []
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
              <RegimeSummary allSignals={allSignals} latestRun={latestRun} />

              <TierStaleness tierTracking={data?.tierTracking} />

              <MarketPricing marketPricing={data?.marketPricing} />

              <Headlines />

              <StandingSignals signals={standingSignals} />

              {aiSignalCount > 0 && (
                <p className="text-[9px] text-slate-600 -mt-2">
                  + {aiSignalCount} LLM-generated flag{aiSignalCount !== 1 ? 's' : ''} in signal history (severity drives regime summary above)
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
        </div>
      )}
    </div>
  )
}
