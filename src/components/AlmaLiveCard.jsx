// Live SPX/VIX reference — the actual real-time inputs the rules below are
// evaluated against (today's open, current gap-from-centroid, VIX gap).
// Polled every 15 min by App.jsx, independent of the manual Refresh button.

function fmtUpdatedAt(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit',
  }) + ' ET'
}

function Stat({ label, value, accent }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-600 uppercase tracking-widest">{label}</span>
      <span className={`font-mono text-sm font-bold ${accent ?? 'text-slate-200'}`}>{value}</span>
    </div>
  )
}

export default function AlmaLiveCard({ live, loading, error }) {
  if (loading && !live) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-6 text-center text-sm text-slate-600 animate-pulse">
        Loading live SPX reference…
      </div>
    )
  }
  if (error && !live) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-4 text-sm text-red-400">
        Live SPX reference unavailable — {error}
      </div>
    )
  }
  if (!live?.spx) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4 text-sm text-slate-500">
        Live SPX reference unavailable right now — rules below are shown against the last stored session.
      </div>
    )
  }

  const { spx, vix } = live
  const gap = live.gapFromCentroidPct
  const vixGap = live.vixGapPct
  const gapColor = gap == null ? '' : gap >= 0 ? 'text-green-400' : 'text-red-400'
  const vixGapColor = vixGap == null ? '' : vixGap >= 0 ? 'text-red-400' : 'text-green-400'
  const dontFadeActive = gap != null && vixGap != null && gap > 0.3 && vixGap < 0

  return (
    <div className={`rounded-xl border p-4 ${dontFadeActive ? 'border-amber-800/50 bg-amber-950/10' : 'border-slate-800 bg-slate-900/50'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
          Live SPX Reference {!live.isToday && <span className="text-slate-600 normal-case">(last session — market closed)</span>}
        </p>
        <p className="text-[10px] text-slate-600">
          Updated {fmtUpdatedAt(live.updatedAt)} · auto-refreshes every 15 min
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="SPX Last" value={spx.last?.toFixed(2) ?? '—'} />
        <Stat label="SPX Open" value={spx.open?.toFixed(2) ?? '—'} />
        <Stat label="Gap from Centroid" value={gap != null ? `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%` : '—'} accent={gapColor} />
        <Stat label="VIX Gap" value={vixGap != null ? `${vixGap >= 0 ? '+' : ''}${vixGap.toFixed(2)}%` : '—'} accent={vixGapColor} />
      </div>

      {dontFadeActive && (
        <p className="text-[11px] text-amber-400 mt-3 pt-3 border-t border-amber-900/30">
          ⚠ Don't-fade condition is active (gap &gt;0.3%, VIX gapped down) — see Active Rules below.
        </p>
      )}
    </div>
  )
}
