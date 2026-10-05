import { useState, useEffect } from 'react'
import { fetchTreasurySynthesis } from '../lib/synthesis'
import { saveWiYield } from '../lib/treasury'
import { METRICS, assess, summaryPayload, wiKey, BASELINE_N } from '../lib/treasuryMetrics'

const M = Object.fromEntries(METRICS.map(m => [m.key, m]))

// Column definitions shown as header tooltips. Indirect is deliberately NOT called foreign.
const DEFS = {
  dispersionBp: 'High yield − median yield. High yield is the stop-out (worst accepted bid), so this is ≥ 0 by construction. It measures how spread out accepted bids were, not auction weakness.',
  tailBp: 'High yield − when-issued (WI) yield at the 1pm bid deadline. Positive = priced cheaper than the market expected (weak); negative = stop-through (strong). Treasury does not publish WI yields: "—" means no WI value has been entered. Never estimated.',
  bidToCover: 'Total tendered ÷ total accepted. Judged only against the same tenor’s baseline — the 3Y structurally runs higher than the 5Y/7Y.',
  directPct: 'Direct bidders’ share of competitive accepted (denominator = competitive accepted; direct + indirect + dealer = 100%). Domestic accounts bidding for their own book.',
  indirectPct: 'Indirect bidders’ share of competitive accepted. Bids placed through a dealer: asset managers, funds and foreign official accounts alike — NOT a measure of foreign demand.',
  dealerPct: 'Primary dealers’ share of competitive accepted — the residual dealers had to take. Meaningful only versus the same tenor’s baseline.',
  endUserPct: 'Direct + indirect share of competitive accepted. A shift between the two buckets is not lost end-demand; this column shows the combined take.',
}

const READ_CLASS = {
  better: 'text-emerald-400',
  worse: 'text-amber-400',
  inline: 'text-slate-500',
  neutral: 'text-slate-400',
}

function fmtDate(iso) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${m}/${d}`
}

function fmtAmt(amt) {
  if (amt == null) return '—'
  if (amt >= 1e9) return `$${(amt / 1e9).toFixed(0)}B`
  return `$${(amt / 1e6).toFixed(0)}M`
}

const FMT = {
  bidToCover: { v: x => `${x.toFixed(2)}x`, d: x => x.toFixed(2) },
  dispersionBp: { v: x => `${x.toFixed(1)}bp`, d: x => x.toFixed(1) },
  tailBp: { v: x => `${x > 0 ? '+' : ''}${x.toFixed(1)}bp`, d: x => x.toFixed(1) },
  pct: { v: x => `${x.toFixed(1)}%`, d: x => x.toFixed(1) },
}
const fmtFor = key => FMT[key] ?? FMT.pct

function MetricCell({ row, mkey }) {
  const metric = M[mkey]
  const value = row[mkey]
  const b = row.baseline[mkey]
  const delta = row.deltas[mkey]
  const read = assess(metric, delta)
  const f = fmtFor(mkey)
  if (value == null) return <span className="text-slate-600">—</span>
  const tip = b.n
    ? `${metric.label}: ${f.v(value)} vs ${row.tenorLabel} avg ${f.v(b.avg)} over the prior ${b.n} clean auction${b.n === 1 ? '' : 's'} (max ${BASELINE_N}). Δ ${delta > 0 ? '+' : ''}${f.d(delta)}`
    : `${metric.label}: no prior clean ${row.tenorLabel} auctions for a baseline`
  return (
    <span title={tip} className="inline-flex flex-col items-end leading-tight">
      <span className="text-slate-200">{f.v(value)}</span>
      <span className={`text-[9px] ${read ? READ_CLASS[read] : 'text-slate-600'}`}>
        {b.n ? `${delta > 0 ? '+' : ''}${f.d(delta)} · n${b.n}` : 'no base'}
      </span>
    </span>
  )
}

function TailCell({ row, editable, editing, onEdit, onSave, onCancel, draft, setDraft, saving, error }) {
  if (editing) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
            placeholder="WI %"
            className="w-16 rounded bg-slate-950 border border-slate-700 px-1 py-0.5 text-right text-[11px] text-slate-200"
          />
          <button onClick={onSave} disabled={saving} className="text-[10px] text-sky-400 hover:text-sky-300">save</button>
          <button onClick={onCancel} className="text-[10px] text-slate-500 hover:text-slate-300">×</button>
        </span>
        {error && <span className="text-[9px] text-red-400 max-w-[11rem] text-right">{error}</span>}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {row.tailBp != null
        ? <span title={`WI ${row.wiYield.toFixed(3)}% (${row.wiSource}) at 1pm`}><MetricCell row={row} mkey="tailBp" /></span>
        : <span className="text-slate-600" title="No WI yield entered — tail unavailable">—</span>}
      {editable && (
        <button onClick={onEdit} className="text-[9px] text-sky-500 hover:text-sky-300" title="Enter the WI yield at the 1pm bid deadline">
          {row.tailBp != null ? 'edit' : '+WI'}
        </button>
      )}
    </span>
  )
}

function Th({ children, def, right = true }) {
  return (
    <th className={`pb-1 pr-2 font-medium ${right ? 'text-right' : ''}`}>
      {def ? <span title={def} className="cursor-help border-b border-dotted border-slate-600">{children}</span> : children}
    </th>
  )
}

function ExcludedTable({ rows }) {
  const [open, setOpen] = useState(false)
  if (!rows.length) return null
  return (
    <div className="mt-4">
      <button onClick={() => setOpen(o => !o)} className="text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-widest">
        {open ? '▾' : '▸'} TIPS & floating-rate notes ({rows.length}) — excluded from the coupon table and baselines
      </button>
      {open && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-slate-600 text-left">
                <Th right={false}>Date</Th><Th right={false}>Type</Th><Th right={false}>Term</Th><Th>Size</Th>
                <Th def="TIPS: real (inflation-adjusted) yield. FRN: high discount margin over the 13-week bill rate.">High yield / DM</Th>
                <Th>Bid/Cover</Th><Th def={DEFS.directPct}>Direct</Th><Th def={DEFS.indirectPct}>Indirect</Th><Th def={DEFS.dealerPct}>Dealer</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={wiKey(r.cusip, r.auctionDate)} className="border-t border-slate-800/40 text-slate-400">
                  <td className="py-1 pr-2">{fmtDate(r.auctionDate)}</td>
                  <td className="py-1 pr-2">{r.kind === 'tips' ? 'TIPS' : 'FRN'}</td>
                  <td className="py-1 pr-2">{r.securityTerm}</td>
                  <td className="py-1 pr-2 text-right">{fmtAmt(r.offeringAmt)}</td>
                  <td className="py-1 pr-2 text-right">
                    {r.kind === 'frn' ? (r.highDiscountMargin != null ? `${r.highDiscountMargin.toFixed(3)}% DM` : '—') : (r.highYield != null ? `${r.highYield.toFixed(3)}% real` : '—')}
                  </td>
                  <td className="py-1 pr-2 text-right">{r.bidToCover != null ? `${r.bidToCover.toFixed(2)}x` : '—'}</td>
                  <td className="py-1 pr-2 text-right">{r.directPct != null ? `${r.directPct.toFixed(1)}%` : '—'}</td>
                  <td className="py-1 pr-2 text-right">{r.indirectPct != null ? `${r.indirectPct.toFixed(1)}%` : '—'}</td>
                  <td className="py-1 text-right">{r.dealerPct != null ? `${r.dealerPct.toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function TreasuryAuctionPanel({ data, loading, error, onReload }) {
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [editingKey, setEditingKey] = useState(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState(null)

  useEffect(() => {
    if (!data?.allCoupons?.length) return
    setSummaryLoading(true)
    fetchTreasurySynthesis(summaryPayload(data))
      .then(text => { setSummary(text); setSummaryLoading(false) })
      .catch(() => setSummaryLoading(false))
  }, [data])

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-6 text-center text-sm text-slate-600 animate-pulse">
        Loading treasury auctions…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-3 text-sm text-red-400">
        Treasury auctions unavailable — {error}
      </div>
    )
  }
  if (!data?.coupons?.length) return null

  const startEdit = r => {
    setEditingKey(wiKey(r.cusip, r.auctionDate))
    setDraft(r.wiYield != null ? String(r.wiYield) : '')
    setEditError(null)
  }
  const save = async r => {
    const trimmed = draft.trim()
    const wi = trimmed === '' ? null : Number(trimmed)
    if (wi !== null && (!Number.isFinite(wi) || wi <= 0 || wi >= 20)) return setEditError('Enter a yield in percent, e.g. 4.812 (blank clears)')
    if (wi !== null && Math.abs(wi - r.highYield) > 0.25) return setEditError(`WI is ${(Math.abs(wi - r.highYield) * 100).toFixed(0)}bp from the high yield — check the value`)
    setSaving(true)
    try {
      await saveWiYield(r.cusip, r.auctionDate, wi)
      setEditingKey(null)
      onReload?.()
    } catch (err) {
      setEditError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const next = data.next
  const flaggedCount = data.coupons.filter(r => r.flags.length).length

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      {summaryLoading && <p className="text-[11px] text-slate-600 italic mb-3 animate-pulse">Generating AI summary…</p>}
      {summary && (
        <p className="text-[11px] text-slate-300 leading-relaxed mb-3 border-l-2 border-slate-700 pl-3 whitespace-pre-line">{summary}</p>
      )}
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <p className="text-xs text-slate-500">
          Nominal coupon auctions · 2Y 3Y 5Y 7Y 10Y 20Y 30Y (incl. reopenings) · Fiscal Data / TreasuryDirect
        </p>
        <p className="text-[11px] text-slate-400">
          {next
            ? <>Next: <span className="font-mono text-slate-200">{fmtDate(next.auctionDate)} {next.tenorLabel}{next.reopening ? ' reopening' : ''} {fmtAmt(next.offeringAmt)}</span></>
            : 'Next coupon auction not yet announced'}
        </p>
      </div>
      {(data.wiError || flaggedCount > 0) && (
        <div className="flex gap-2 flex-wrap mb-2">
          {flaggedCount > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border text-amber-300 bg-amber-950/30 border-amber-900/50">{flaggedCount} row{flaggedCount > 1 ? 's' : ''} failed data checks — excluded from baselines</span>}
          {data.wiError && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border text-slate-400 bg-slate-900/50 border-slate-700/50">WI yields unavailable: {data.wiError}</span>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="text-slate-600 text-left">
              <Th right={false}>Date</Th>
              <Th right={false}>Tenor</Th>
              <Th>Size</Th>
              <Th>High Yield</Th>
              <Th def={DEFS.dispersionBp}>Dispersion (high − median)</Th>
              <Th def={DEFS.tailBp}>Tail vs WI</Th>
              <Th def={DEFS.bidToCover}>Bid/Cover</Th>
              <Th def={DEFS.directPct}>Direct</Th>
              <Th def={DEFS.indirectPct}>Indirect</Th>
              <Th def={DEFS.dealerPct}>Dealer</Th>
              <Th def={DEFS.endUserPct}>Dir + Ind</Th>
              <th className="pb-1 font-medium text-right">Data</th>
            </tr>
          </thead>
          <tbody>
            {data.coupons.map(r => {
              const k = wiKey(r.cusip, r.auctionDate)
              const flagged = r.flags.length > 0
              return (
                <tr key={k} className={`border-t border-slate-800/40 hover:bg-slate-800/20 align-top ${flagged ? 'opacity-60' : ''}`}>
                  <td className="py-1 pr-2 text-slate-400">{fmtDate(r.auctionDate)}</td>
                  <td className="py-1 pr-2 text-slate-300" title={r.reopening ? `Reopening — published term ${r.securityTerm}` : r.securityTerm}>
                    {r.tenorLabel}{r.reopening && <span className="text-slate-600">ʀ</span>}
                  </td>
                  <td className="py-1 pr-2 text-slate-400 text-right">{fmtAmt(r.offeringAmt)}</td>
                  <td className="py-1 pr-2 text-slate-200 text-right">{r.highYield != null ? `${r.highYield.toFixed(3)}%` : '—'}</td>
                  <td className="py-1 pr-2 text-right"><MetricCell row={r} mkey="dispersionBp" /></td>
                  <td className="py-1 pr-2 text-right">
                    <TailCell
                      row={r} editable={data.wiEditable && r.highYield != null} editing={editingKey === k}
                      onEdit={() => startEdit(r)} onSave={() => save(r)} onCancel={() => setEditingKey(null)}
                      draft={draft} setDraft={setDraft} saving={saving} error={editError}
                    />
                  </td>
                  <td className="py-1 pr-2 text-right"><MetricCell row={r} mkey="bidToCover" /></td>
                  <td className="py-1 pr-2 text-right"><MetricCell row={r} mkey="directPct" /></td>
                  <td className="py-1 pr-2 text-right"><MetricCell row={r} mkey="indirectPct" /></td>
                  <td className="py-1 pr-2 text-right"><MetricCell row={r} mkey="dealerPct" /></td>
                  <td className="py-1 pr-2 text-right"><MetricCell row={r} mkey="endUserPct" /></td>
                  <td className="py-1 text-right">
                    {flagged
                      ? <span title={r.flags.map(f => f.message).join('\n')} className="px-1.5 py-0.5 rounded text-[9px] font-semibold border text-amber-300 bg-amber-950/30 border-amber-900/50 cursor-help">check</span>
                      : <span className="text-slate-700">ok</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ExcludedTable rows={data.excluded} />
      <p className="text-[9px] text-slate-600 mt-3 leading-relaxed">
        Second line in each cell = Δ vs the trailing average of up to {BASELINE_N} prior clean auctions of the same tenor (new issues and reopenings pooled) · n = auctions in that average ·
        <span className="text-emerald-500"> green</span> better / <span className="text-amber-500">amber</span> worse than baseline; direct and indirect alone are not graded because a shift between them isn’t lost demand.
        Bidder shares are of competitive accepted. Indirect ≠ foreign. ʀ = reopening. Rows failing data checks (yield jump &gt; 75bp vs prior same tenor, bidder buckets not summing to competitive accepted, missing fields) are badged and left out of baselines.
      </p>
    </div>
  )
}
