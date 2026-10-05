// Pure computations for the Treasury auction panel (no I/O — unit-tested in
// treasuryMetrics.test.js). Input rows are raw Fiscal Data `auctions_query` records.
//
// Interpretation rules (mirrored in UI tooltips and the LLM prompt):
// - Dispersion = high yield − median yield. High yield is the stop-out (worst
//   accepted bid), so this is ≥ 0 by construction: it measures bid spread, NOT weakness.
//   It is not the auction "tail" (high − when-issued yield at 1pm). WI yields aren't
//   published and aren't available to this dashboard, so the tail is deliberately omitted.
// - Indirect bidders are NOT "foreign buyers": they include asset managers, funds and
//   anyone bidding through a dealer, as well as foreign official accounts.
// - Dealer share is the residual primary dealers had to take; it only means something
//   relative to the same tenor's own baseline.
// - Bucket shares use competitive accepted as the denominator (direct + indirect +
//   dealer sum to it). Total accepted also includes SOMA add-ons and non-competitive
//   awards, which would understate every bucket.
// - One auction is noisy: every baseline carries its observation count.

export const COUPON_TERMS = ['2-Year', '3-Year', '5-Year', '7-Year', '10-Year', '20-Year', '30-Year']
export const BASELINE_N = 6
export const YIELD_JUMP_BP = 75
const BUCKET_TOLERANCE = 0.005

// Deltas smaller than these are shown as "in line" rather than better/worse.
// better: null = shown with its delta but never graded (dispersion is bid spread, not
// weakness; direct vs indirect alone is a bucket shift, not lost demand).
export const METRICS = [
  { key: 'bidToCover', label: 'Bid/Cover', better: 'higher', tol: 0.05, digits: 2 },
  { key: 'dispersionBp', label: 'Dispersion', better: null, tol: 0.5, digits: 1 },
  { key: 'directPct', label: 'Direct', better: null, tol: 1.5, digits: 1 },
  { key: 'indirectPct', label: 'Indirect', better: null, tol: 1.5, digits: 1 },
  { key: 'dealerPct', label: 'Dealer', better: 'lower', tol: 1.5, digits: 1 },
  { key: 'endUserPct', label: 'Direct + Indirect', better: 'higher', tol: 1.5, digits: 1 },
]

export function num(v) {
  if (v == null || v === '' || v === 'null') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function rowKey(cusip, auctionDate) {
  return `${cusip}|${auctionDate}`
}

export function classify(raw) {
  if (raw.inflation_index_security === 'Yes') return 'tips'
  if (raw.floating_rate === 'Yes') return 'frn'
  const term = raw.original_security_term || raw.security_term
  return COUPON_TERMS.includes(term) ? 'coupon' : 'other'
}

export function tenorLabel(term) {
  return term ? term.replace('-Year', 'Y').replace(/ (\d+)-Month/, ' $1M') : ''
}

export function normalizeAuction(raw) {
  const tenor = raw.original_security_term || raw.security_term
  const highYield = num(raw.high_yield)
  const highDiscountMargin = num(raw.high_discnt_margin)
  const bidToCover = num(raw.bid_to_cover_ratio)
  return {
    cusip: raw.cusip,
    auctionDate: raw.auction_date,
    issueDate: raw.issue_date,
    securityType: raw.security_type,
    securityTerm: raw.security_term,
    tenor,
    tenorLabel: tenorLabel(tenor),
    reopening: raw.reopening === 'Yes',
    kind: classify(raw),
    offeringAmt: num(raw.offering_amt),
    highYield,
    medianYield: num(raw.avg_med_yield),
    highDiscountMargin,
    bidToCover,
    compAccepted: num(raw.comp_accepted),
    totalAccepted: num(raw.total_accepted),
    directAccepted: num(raw.direct_bidder_accepted),
    indirectAccepted: num(raw.indirect_bidder_accepted),
    dealerAccepted: num(raw.primary_dealer_accepted),
    completed: highYield != null || highDiscountMargin != null || bidToCover != null,
  }
}

export function dispersionBp(a) {
  if (a.highYield == null || a.medianYield == null) return null
  return (a.highYield - a.medianYield) * 100
}

export function bucketShares(a) {
  const d = a.compAccepted
  const empty = { denominator: 'comp_accepted', directPct: null, indirectPct: null, dealerPct: null, endUserPct: null, bucketSumRatio: null }
  if (!d || a.directAccepted == null || a.indirectAccepted == null || a.dealerAccepted == null) return empty
  const pct = x => (x / d) * 100
  return {
    denominator: 'comp_accepted',
    directPct: pct(a.directAccepted),
    indirectPct: pct(a.indirectAccepted),
    dealerPct: pct(a.dealerAccepted),
    endUserPct: pct(a.directAccepted + a.indirectAccepted),
    bucketSumRatio: (a.directAccepted + a.indirectAccepted + a.dealerAccepted) / d,
  }
}

// prev = the previous clean same-tenor auction (or null).
export function validateRow(row, prev) {
  const flags = []
  if (row.highYield == null) flags.push({ code: 'missing_yield', message: 'No high yield in results' })
  if (row.bidToCover == null || row.directPct == null) {
    flags.push({ code: 'missing_fields', message: 'Bid/cover or bidder breakdown missing' })
  }
  if (row.highYield != null && row.medianYield != null && row.highYield < row.medianYield) {
    flags.push({ code: 'high_below_median', message: 'High yield below median (impossible for a stop-out)' })
  }
  if (row.bucketSumRatio != null && Math.abs(row.bucketSumRatio - 1) > BUCKET_TOLERANCE) {
    flags.push({ code: 'bucket_mismatch', message: `Direct + indirect + dealer = ${(row.bucketSumRatio * 100).toFixed(1)}% of competitive accepted` })
  }
  if (prev?.highYield != null && row.highYield != null) {
    const jump = Math.abs(row.highYield - prev.highYield) * 100
    if (jump > YIELD_JUMP_BP) {
      flags.push({ code: 'yield_jump', message: `High yield moved ${jump.toFixed(0)}bp vs prior ${row.tenorLabel} (${prev.auctionDate})` })
    }
  }
  return flags
}

function avg(values) {
  const v = values.filter(x => x != null)
  return v.length ? { avg: v.reduce((s, x) => s + x, 0) / v.length, n: v.length } : { avg: null, n: 0 }
}

// Trailing same-tenor baseline from up to BASELINE_N prior clean auctions.
// Each metric carries its own n (auctions missing that field don't count).
export function computeBaseline(priorClean) {
  const window = priorClean.slice(-BASELINE_N)
  const baseline = {}
  for (const m of METRICS) baseline[m.key] = avg(window.map(r => r[m.key]))
  return baseline
}

export function assess(metric, delta) {
  if (delta == null) return null
  if (Math.abs(delta) < metric.tol) return 'inline'
  if (!metric.better) return 'neutral'
  const higher = delta > 0
  return (metric.better === 'higher') === higher ? 'better' : 'worse'
}

// rawRows: Fiscal Data records (any order, any security type).
export function buildAuctionTable(rawRows, { today }) {
  const all = rawRows.map(normalizeAuction)
  const done = all.filter(a => a.completed || a.auctionDate < today)
  const upcoming = all
    .filter(a => a.kind === 'coupon' && !a.completed && a.auctionDate >= today)
    .sort((a, b) => a.auctionDate.localeCompare(b.auctionDate))

  const excluded = done
    .filter(a => a.kind === 'tips' || a.kind === 'frn')
    .sort((a, b) => b.auctionDate.localeCompare(a.auctionDate))
    .map(a => ({ ...a, ...bucketShares(a) }))

  const byTenor = new Map()
  for (const a of done.filter(x => x.kind === 'coupon')) {
    if (!byTenor.has(a.tenor)) byTenor.set(a.tenor, [])
    byTenor.get(a.tenor).push(a)
  }

  const coupons = []
  for (const rows of byTenor.values()) {
    rows.sort((a, b) => a.auctionDate.localeCompare(b.auctionDate))
    const clean = []
    for (const a of rows) {
      const row = { ...a, ...bucketShares(a), dispersionBp: dispersionBp(a) }
      row.flags = validateRow(row, clean.at(-1) ?? null)
      row.baseline = computeBaseline(clean)
      row.deltas = {}
      for (const m of METRICS) {
        const b = row.baseline[m.key]
        row.deltas[m.key] = row[m.key] != null && b.avg != null ? row[m.key] - b.avg : null
      }
      coupons.push(row)
      if (!row.flags.length) clean.push(row)
    }
  }
  coupons.sort((a, b) => b.auctionDate.localeCompare(a.auctionDate) || COUPON_TERMS.indexOf(a.tenor) - COUPON_TERMS.indexOf(b.tenor))
  return { coupons, excluded, upcoming, next: upcoming[0] ?? null }
}

// Most recent clean auction per tenor — the evidence handed to the LLM.
export function latestByTenor(coupons) {
  const seen = new Map()
  for (const r of coupons) if (!r.flags.length && !seen.has(r.tenor)) seen.set(r.tenor, r)
  return COUPON_TERMS.filter(t => seen.has(t)).map(t => seen.get(t))
}

const round = (v, digits) => v == null ? null : Number(v.toFixed(digits))

// Computed fields only — the summary prompt may cite nothing else.
export function summaryPayload({ allCoupons, coupons, next }) {
  const evidence = latestByTenor(allCoupons).map(r => ({
    date: r.auctionDate,
    tenor: r.tenorLabel,
    reopening: r.reopening,
    highYield: r.highYield,
    metrics: Object.fromEntries(METRICS.map(m => [m.key, {
      value: round(r[m.key], m.digits),
      baselineAvg: round(r.baseline[m.key].avg, m.digits),
      n: r.baseline[m.key].n,
      delta: round(r.deltas[m.key], m.digits),
      read: assess(m, r.deltas[m.key]),
    }])),
  }))
  return {
    evidence,
    flagged: coupons.filter(r => r.flags.length).map(r => ({ date: r.auctionDate, tenor: r.tenorLabel, issues: r.flags.map(f => f.message) })),
    next: next ? { date: next.auctionDate, tenor: next.tenorLabel, reopening: next.reopening, sizeBn: next.offeringAmt != null ? next.offeringAmt / 1e9 : null } : null,
  }
}
