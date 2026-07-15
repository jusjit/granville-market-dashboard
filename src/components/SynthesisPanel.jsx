// Parse the Minto-structured synthesis into lead / drivers / lean. Degrades
// gracefully: if the model returns unstructured prose, it renders as one block.
function Synthesis({ text }) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const bottom = lines.find(l => /^bottom line:/i.test(l))?.replace(/^bottom line:\s*/i, '')
  const lean = lines.find(l => /^session lean:/i.test(l))?.replace(/^session lean:\s*/i, '')
  const drivers = lines
    .filter(l => /^[-–•]/.test(l))
    .map(l => l.replace(/^[-–•]\s*/, ''))

  if (!bottom && drivers.length === 0) {
    return <p className="text-sm text-slate-200 leading-relaxed">{text}</p>
  }

  return (
    <div className="space-y-3">
      {bottom && (
        <p className="text-sm font-semibold text-slate-100 leading-snug">{bottom}</p>
      )}
      {drivers.length > 0 && (
        <ul className="space-y-1.5">
          {drivers.map((d, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-300 leading-relaxed">
              <span className="text-indigo-500 shrink-0">–</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}
      {lean && (
        <p className="text-sm text-slate-300 leading-relaxed border-t border-indigo-900/40 pt-2.5">
          <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest mr-2">Session lean</span>
          {lean}
        </p>
      )}
    </div>
  )
}

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

      {!loading && !error && text && <Synthesis text={text} />}

      {!loading && !error && !text && (
        <p className="text-sm text-slate-600 italic">No synthesis yet — click Refresh to generate.</p>
      )}
    </section>
  )
}
