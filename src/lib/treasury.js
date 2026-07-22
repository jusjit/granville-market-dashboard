const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query'

const MARKET_MOVING_TERMS = new Set([
  '2-Year', '3-Year', '5-Year', '7-Year', '10-Year', '20-Year', '30-Year',
])

export async function fetchTreasuryAuctions() {
  const url = `${BASE}?sort=-auction_date&page[size]=80&filter=security_type:in:(Note,Bond),auction_date:gte:${ninetyDaysAgo()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Treasury: HTTP ${res.status}`)
  const json = await res.json()
  return (json.data ?? [])
    .filter(r => MARKET_MOVING_TERMS.has(r.security_term))
    .map(normalize)
}

function ninetyDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

function normalize(row) {
  const highYield = num(row.high_yield)
  const medianYield = num(row.avg_med_yield)
  const totalAccepted = num(row.total_accepted)

  return {
    auctionDate: row.auction_date,
    securityType: row.security_type,
    securityTerm: row.security_term,
    highYield,
    medianYield,
    tail: highYield != null && medianYield != null ? +(highYield - medianYield).toFixed(3) : null,
    bidToCover: num(row.bid_to_cover_ratio),
    offeringAmt: num(row.offering_amt),
    totalAccepted,
    totalTendered: num(row.total_tendered),
    directPct: pct(num(row.direct_bidder_accepted), totalAccepted),
    indirectPct: pct(num(row.indirect_bidder_accepted), totalAccepted),
    dealerPct: pct(num(row.primary_dealer_accepted), totalAccepted),
    cusip: row.cusip,
  }
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function pct(part, total) {
  if (part == null || total == null || total === 0) return null
  return +((part / total) * 100).toFixed(1)
}
