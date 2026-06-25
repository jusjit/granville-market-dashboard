export default function SynthesisPanel({ text, loading, error }) {
  return (
    <section className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest">AI Synthesis</span>
        <span className="text-[10px] text-slate-600">· claude-sonnet-4-6 via 1min.ai · updates on refresh</span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 animate-pulse">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
          Generating synthesis across all signals…
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-slate-500 italic">Synthesis unavailable — {error}</p>
      )}

      {!loading && !error && text && (
        <p className="text-sm text-slate-200 leading-relaxed">{text}</p>
      )}

      {!loading && !error && !text && (
        <p className="text-sm text-slate-600 italic">No synthesis yet — click Refresh to generate.</p>
      )}
    </section>
  )
}
