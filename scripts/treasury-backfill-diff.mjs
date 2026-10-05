// Diff report: old Treasury panel pipeline vs the corrected one, same 90-day window.
// Usage: node scripts/treasury-backfill-diff.mjs [--today YYYY-MM-DD]
import { buildAuctionTable, normalizeAuction } from '../src/lib/treasuryMetrics.js'

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query'
const argToday = process.argv.indexOf('--today')
const today = argToday > 0 ? process.argv[argToday + 1] : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const shift = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const cutoff = shift(90)

const res = await fetch(`${BASE}?sort=-auction_date&page[size]=400&filter=security_type:in:(Note,Bond),auction_date:gte:${shift(330)}`)
if (!res.ok) throw new Error(`Fiscal Data HTTP ${res.status}`)
const raw = (await res.json()).data

// ── old pipeline (verbatim logic from the previous src/lib/treasury.js) ──
const OLD_TERMS = new Set(['2-Year', '3-Year', '5-Year', '7-Year', '10-Year', '20-Year', '30-Year'])
const n = v => (v == null || v === '' || v === 'null') ? null : Number(v)
const oldPct = (p, t) => p == null || !t ? null : +((p / t) * 100).toFixed(1)
const oldRows = raw
  .filter(r => r.auction_date >= cutoff && OLD_TERMS.has(r.security_term))
  .map(r => ({
    cusip: r.cusip, auctionDate: r.auction_date, term: r.security_term,
    highYield: n(r.high_yield), btc: n(r.bid_to_cover_ratio),
    directPct: oldPct(n(r.direct_bidder_accepted), n(r.total_accepted)),
    indirectPct: oldPct(n(r.indirect_bidder_accepted), n(r.total_accepted)),
    dealerPct: oldPct(n(r.primary_dealer_accepted), n(r.total_accepted)),
    raw: r,
  }))

// ── new pipeline ──
const table = buildAuctionTable(raw, { today })
const newRows = table.coupons.filter(r => r.auctionDate >= cutoff)
const key = r => `${r.cusip}|${r.auctionDate}`
const oldByKey = new Map(oldRows.map(r => [key(r), r]))
const newByKey = new Map(newRows.map(r => [key(r), r]))
const f1 = v => v == null ? '—' : v.toFixed(1)
const f3 = v => v == null ? '—' : v.toFixed(3)

const lines = []
const out = s => lines.push(s)
out(`# Treasury auction backfill diff — window ${cutoff} → ${today}`)
out(`Old pipeline rows: ${oldRows.length} (incl. upcoming with no results) · New coupon rows: ${newRows.length} completed + ${table.upcoming.length} upcoming\n`)

out('## Rows that were wrong (in old table, not nominal coupons)')
const wrong = oldRows.filter(r => !newByKey.has(key(r)) && normalizeAuction(r.raw).kind !== 'coupon')
if (!wrong.length) out('none')
for (const r of wrong) {
  const kind = normalizeAuction(r.raw).kind
  out(`- ${r.auctionDate} shown as "${r.term.replace('-Year', 'Y')}": actually ${kind.toUpperCase()} (high yield ${f3(r.highYield)}${kind === 'frn' ? `, discount margin ${r.raw.high_discnt_margin}` : ' = real yield'}), bid/cover ${r.btc}x, direct ${r.directPct}% → moved to the separate TIPS/FRN table`)
}

out('\n## Rows missing from the old table')
const missing = newRows.filter(r => !oldByKey.has(key(r)))
if (!missing.length) out('none')
for (const r of missing) {
  out(`- ${r.auctionDate} ${r.tenorLabel} ${r.reopening ? `reopening (published term "${r.securityTerm}")` : ''}: high ${f3(r.highYield)}%, bid/cover ${r.bidToCover}x, direct ${f1(r.directPct)}% / indirect ${f1(r.indirectPct)}% / dealer ${f1(r.dealerPct)}%`)
}

out('\n## Rows with mismatched values (bucket % denominator: total accepted → competitive accepted)')
let mismatches = 0
for (const r of newRows) {
  const o = oldByKey.get(key(r))
  if (!o) continue
  const diffs = []
  for (const [k, label] of [['directPct', 'direct'], ['indirectPct', 'indirect'], ['dealerPct', 'dealer']]) {
    const nv = +r[k].toFixed(1)
    if (o[k] != null && Math.abs(o[k] - nv) >= 0.1) diffs.push(`${label} ${o[k]}→${nv}`)
  }
  if (o.highYield !== r.highYield) diffs.push(`high yield ${o.highYield}→${r.highYield}`)
  if (diffs.length) { mismatches++; out(`- ${r.auctionDate} ${r.tenorLabel}: ${diffs.join(', ')}`) }
}
if (!mismatches) out('none')

out('\n## Validation flags in the corrected table (full lookback)')
const flagged = table.coupons.filter(r => r.flags.length)
if (!flagged.length) out('none — no coupon row tripped the yield-jump, bucket-sum, or completeness checks')
for (const r of flagged) out(`- ${r.auctionDate} ${r.tenorLabel}: ${r.flags.map(f => f.message).join('; ')}`)

out('\n## Upcoming (announced, from Fiscal Data)')
for (const r of table.upcoming) out(`- ${r.auctionDate} ${r.tenorLabel}${r.reopening ? ' (reopening)' : ''} $${(r.offeringAmt / 1e9).toFixed(0)}B`)

console.log(lines.join('\n'))
