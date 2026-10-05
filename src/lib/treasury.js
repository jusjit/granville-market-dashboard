import { buildAuctionTable } from './treasuryMetrics'

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query'
const FIELDS = [
  'cusip', 'auction_date', 'issue_date', 'security_type', 'security_term', 'original_security_term', 'reopening',
  'floating_rate', 'inflation_index_security', 'offering_amt', 'high_yield', 'avg_med_yield', 'high_discnt_margin',
  'bid_to_cover_ratio', 'comp_accepted', 'total_accepted', 'direct_bidder_accepted', 'indirect_bidder_accepted',
  'primary_dealer_accepted',
].join(',')

// 330 days back so every tenor shown in the 90-day window has up to 6 prior same-tenor auctions.
const LOOKBACK_DAYS = 330
export const DISPLAY_DAYS = 90
const CACHE_KEY = 'treasury_auctions_v2'
const CACHE_TTL_MS = 30 * 60 * 1000

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
    return c && Date.now() - c.fetchedAt < CACHE_TTL_MS ? c : null
  } catch { return null }
}

function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)) } catch { /* storage unavailable */ }
}

// Raw Fiscal Data rows. Note/Bond includes TIPS and FRNs (flagged by
// inflation_index_security / floating_rate); classification happens in treasuryMetrics.
async function fetchRawAuctions() {
  const cached = readCache()
  if (cached) return cached
  const url = `${BASE}?fields=${FIELDS}&sort=-auction_date&page[size]=400&filter=security_type:in:(Note,Bond),auction_date:gte:${daysAgo(LOOKBACK_DAYS)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Treasury: HTTP ${res.status}`)
  const json = await res.json()
  const entry = { rows: json.data ?? [], fetchedAt: Date.now() }
  writeCache(entry)
  return entry
}

export async function fetchTreasuryAuctions() {
  const { rows, fetchedAt } = await fetchRawAuctions()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const table = buildAuctionTable(rows, { today })
  const cutoff = daysAgo(DISPLAY_DAYS)
  return {
    ...table,
    coupons: table.coupons.filter(r => r.auctionDate >= cutoff),
    excluded: table.excluded.filter(r => r.auctionDate >= cutoff),
    allCoupons: table.coupons,
    fetchedAt,
  }
}
