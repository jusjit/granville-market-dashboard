import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const RUN_TYPE_STYLE = {
  'full-scan': 'bg-indigo-950/50 border-indigo-800/40 text-indigo-300',
  'gated-triggered': 'bg-amber-950/50 border-amber-800/40 text-amber-300',
  'gated-skip': 'bg-slate-800/50 border-slate-700/40 text-slate-400',
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
          {/* Synthesis / verdict */}
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

          {/* What changed (diff) */}
          {diffKeys.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">What changed</p>
              <div className="flex flex-wrap gap-1">
                {diffKeys.map(k => (
                  <span key={k} className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/40 border border-amber-800/30 text-amber-300">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Considered categories */}
          {considered.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Considered ({considered.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {considered.map(c => (
                  <span key={c} className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/60 border border-slate-700/40 text-slate-300">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dismissed categories with reasons */}
          {dismissedKeys.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Excluded ({dismissedKeys.length})
              </p>
              <div className="space-y-1">
                {dismissedKeys.map(k => (
                  <div key={k} className="flex gap-2 text-[10px]">
                    <span className="text-slate-400 shrink-0">{k}:</span>
                    <span className="text-slate-500">{dismissed[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Token usage */}
          {run.token_usage && (
            <p className="text-[10px] text-slate-600">
              {run.token_usage.inputToken?.toLocaleString()} in / {run.token_usage.totalToken?.toLocaleString()} total tokens
              {run.token_usage.credit != null && ` · ${run.token_usage.credit} credits`}
            </p>
          )}

          {/* Source errors */}
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

function ActiveSignals({ signals }) {
  if (!signals?.length) return null
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">Active signals</p>
      {signals.map(s => (
        <div key={s.slug} className="rounded-lg border border-red-900/30 bg-red-950/15 px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold text-red-300">{s.name}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-950/50 border border-red-800/40 text-red-300">
              {s.severity}/100
            </span>
            {s.implication && s.implication !== 'none' && (
              <span className="text-[10px] text-red-400/70">{s.implication.replace(/_/g, ' ')}</span>
            )}
          </div>
          {s.notes && (
            <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-3">{s.notes}</p>
          )}
        </div>
      ))}
    </div>
  )
}

export default function GeoRegimePanel({ data, loading, error }) {
  const [collapsed, setCollapsed] = useState(true)
  const [expandedRun, setExpandedRun] = useState(null)

  const runs = data?.runs ?? []
  const signals = data?.signals ?? []
  const latestRun = runs[0]

  // Auto-expand the most recent run on first open
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
        <div className="space-y-3">
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
              <ActiveSignals signals={signals} />

              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Recent runs ({runs.length})
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
