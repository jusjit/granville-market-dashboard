import { useState, useEffect } from 'react'
import { fetchTreasurySynthesis } from '../lib/synthesis'

function tailColor(tail) {
  if (tail == null) return 'text-slate-500'
  const bp = tail * 100
  if (bp > 2) return 'text-red-400'
  if (bp > 0) return 'text-amber-400'
  if (bp < -1) return 'text-emerald-400'
  return 'text-slate-400'
}

function btcColor(btc) {
  if (btc == null) return 'text-slate-500'
  if (btc >= 2.8) return 'text-emerald-400'
  if (btc >= 2.3) return 'text-slate-300'
  return 'text-amber-400'
}

function fmtDate(iso) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${m}/${d}`
}

function fmtAmt(amt) {
  if (amt == null) return '—'
  if (amt >= 1e9) return `$${(amt / 1e9).toFixed(0)}B`
  if (amt >= 1e6) return `$${(amt / 1e6).toFixed(0)}M`
  return `$${amt}`
}

function termAbbr(term) {
  if (!term) return ''
  return term.replace('-Year', 'Y').replace('-Month', 'M')
}

export default function TreasuryAuctionPanel({ data, loading, error }) {
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  useEffect(() => {
    if (!data?.length) return
    setSummaryLoading(true)
    fetchTreasurySynthesis(data)
      .then(text => { setSummary(text); setSummaryLoading(false) })
      .catch(() => setSummaryLoading(false))
  }, [data])

  if (loading) {
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
  if (!data?.length) return null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      {summaryLoading && (
        <p className="text-[11px] text-slate-600 italic mb-3 animate-pulse">Generating AI summary…</p>
      )}
      {summary && (
        <p className="text-[11px] text-slate-300 leading-relaxed mb-3 border-l-2 border-slate-700 pl-3">
          {summary}
        </p>
      )}
      <p className="text-xs text-slate-500 mb-3">
        Market-moving coupon auctions · 2Y 3Y 5Y 7Y 10Y 20Y 30Y · TreasuryDirect
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-slate-600 text-left">
              <th className="pb-1 pr-2 font-medium">Date</th>
              <th className="pb-1 pr-2 font-medium">Term</th>
              <th className="pb-1 pr-2 font-medium text-right">Size</th>
              <th className="pb-1 pr-2 font-medium text-right">High Yield</th>
              <th className="pb-1 pr-2 font-medium text-right">Tail</th>
              <th className="pb-1 pr-2 font-medium text-right">Bid/Cover</th>
              <th className="pb-1 pr-2 font-medium text-right">Direct</th>
              <th className="pb-1 pr-2 font-medium text-right">Indirect</th>
              <th className="pb-1 font-medium text-right">Dealer</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a, i) => (
              <tr key={`${a.cusip}-${i}`} className="border-t border-slate-800/40 hover:bg-slate-800/20">
                <td className="py-1 pr-2 text-slate-400 font-mono">{fmtDate(a.auctionDate)}</td>
                <td className="py-1 pr-2 text-slate-300 font-mono">{termAbbr(a.securityTerm)}</td>
                <td className="py-1 pr-2 text-slate-400 text-right font-mono">{fmtAmt(a.offeringAmt)}</td>
                <td className="py-1 pr-2 text-slate-200 text-right font-mono">
                  {a.highYield != null ? `${a.highYield.toFixed(3)}%` : '—'}
                </td>
                <td className={`py-1 pr-2 text-right font-mono ${tailColor(a.tail)}`}>
                  {a.tail != null ? `${a.tail > 0 ? '+' : ''}${(a.tail * 100).toFixed(1)}bp` : '—'}
                </td>
                <td className={`py-1 pr-2 text-right font-mono ${btcColor(a.bidToCover)}`}>
                  {a.bidToCover != null ? `${a.bidToCover.toFixed(2)}x` : '—'}
                </td>
                <td className="py-1 pr-2 text-slate-400 text-right font-mono">
                  {a.directPct != null ? `${a.directPct}%` : '—'}
                </td>
                <td className="py-1 pr-2 text-slate-400 text-right font-mono">
                  {a.indirectPct != null ? `${a.indirectPct}%` : '—'}
                </td>
                <td className="py-1 text-slate-400 text-right font-mono">
                  {a.dealerPct != null ? `${a.dealerPct}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[9px] text-slate-600 mt-2">
        Tail = high yield − median yield (positive = weak). Bid/Cover ≥ 2.8 = strong. Updates automatically with each monthly auction.
      </p>
    </div>
  )
}
