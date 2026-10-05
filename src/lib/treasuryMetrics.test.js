import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classify, normalizeAuction, dispersionBp, tailBp, bucketShares, validateRow,
  computeBaseline, buildAuctionTable, latestByTenor, assess, METRICS, wiKey,
} from './treasuryMetrics.js'

// Real Fiscal Data rows (fields trimmed to what the module reads).
const base = { security_type: 'Note', reopening: 'No', floating_rate: 'No', inflation_index_security: 'No' }
const row = o => ({ ...base, ...o })

// 07/23/2026 — shown as a "10Y at 2.438%"; it is the 10-year TIPS (real yield).
const TIPS_10Y_0723 = row({
  cusip: '91282CTIPS', auction_date: '2026-07-23', security_term: '10-Year', original_security_term: '10-Year',
  inflation_index_security: 'Yes', high_yield: '2.4380', avg_med_yield: '2.370000', bid_to_cover_ratio: '2.300000',
  offering_amt: '21000000000', comp_accepted: '20863290000', total_accepted: '23321784700',
  direct_bidder_accepted: '5212500000', indirect_bidder_accepted: '13593850000', primary_dealer_accepted: '2056940000',
})
// 07/29/2026 — shown as a "2Y, $30B, 3.37x, 0% direct"; it is a new 2-year FRN.
const FRN_2Y_0729 = row({
  cusip: '91282CFRN0', auction_date: '2026-07-29', security_term: '2-Year', original_security_term: '2-Year',
  floating_rate: 'Yes', high_yield: null, avg_med_yield: null, high_discnt_margin: '0.050000', bid_to_cover_ratio: '3.370000',
  offering_amt: '30000000000', comp_accepted: '29962331400', total_accepted: '33317226800',
  direct_bidder_accepted: '818200', indirect_bidder_accepted: '18943313200', primary_dealer_accepted: '11018200000',
})
// 09/24/2026 7Y.
const NOTE_7Y_0924 = row({
  cusip: '91282C7Y24', auction_date: '2026-09-24', security_term: '7-Year', original_security_term: '7-Year',
  high_yield: '5.0850', avg_med_yield: '5.019000', bid_to_cover_ratio: '2.420000',
  offering_amt: '44000000000', comp_accepted: '43480804500', total_accepted: '50624250500',
  direct_bidder_accepted: '13163710000', indirect_bidder_accepted: '24869544500', primary_dealer_accepted: '5447550000',
})
// 09/09/2026 10Y reopening — dropped by the old security_term filter ("9-Year 11-Month").
const REOPEN_10Y_0909 = row({
  cusip: '91282C10Y8', auction_date: '2026-09-09', security_term: '9-Year 11-Month', original_security_term: '10-Year',
  reopening: 'Yes', high_yield: '4.8340', avg_med_yield: '4.769000', bid_to_cover_ratio: '2.710000',
  offering_amt: '39000000000', comp_accepted: '38901890000', total_accepted: '39000040000',
  direct_bidder_accepted: '6420800000', indirect_bidder_accepted: '30804090000', primary_dealer_accepted: '1677000000',
})

test('classify separates TIPS and FRN from nominal coupons', () => {
  assert.equal(classify(TIPS_10Y_0723), 'tips')
  assert.equal(classify(FRN_2Y_0729), 'frn')
  assert.equal(classify(NOTE_7Y_0924), 'coupon')
  assert.equal(classify(REOPEN_10Y_0909), 'coupon')
})

test('reopenings map to their original tenor', () => {
  const a = normalizeAuction(REOPEN_10Y_0909)
  assert.equal(a.tenor, '10-Year')
  assert.equal(a.securityTerm, '9-Year 11-Month')
  assert.equal(a.reopening, true)
})

test('dispersion is high − median in bp and never uses WI', () => {
  const a = normalizeAuction(NOTE_7Y_0924)
  assert.ok(Math.abs(dispersionBp(a) - 6.6) < 1e-9)
  assert.equal(dispersionBp({ highYield: 4.5, medianYield: null }), null)
})

test('tail is high − WI in bp; null without a WI value', () => {
  assert.ok(Math.abs(tailBp(5.085, 5.07) - 1.5) < 1e-9)
  assert.ok(Math.abs(tailBp(5.085, 5.095) - (-1.0)) < 1e-9)
  assert.equal(tailBp(5.085, null), null)
  assert.equal(tailBp(null, 5.0), null)
})

test('bucket shares use competitive accepted and sum to 100%', () => {
  const s = bucketShares(normalizeAuction(NOTE_7Y_0924))
  assert.equal(s.denominator, 'comp_accepted')
  assert.ok(Math.abs(s.directPct - 30.275) < 0.01)
  assert.ok(Math.abs(s.indirectPct - 57.197) < 0.01)
  assert.ok(Math.abs(s.dealerPct - 12.529) < 0.01)
  assert.ok(Math.abs(s.directPct + s.indirectPct + s.dealerPct - 100) < 1e-6)
  assert.ok(Math.abs(s.endUserPct - (s.directPct + s.indirectPct)) < 1e-9)
  // Old (wrong) denominator would have understated direct at 26.0%.
  assert.ok(Math.abs(13163710000 / 50624250500 * 100 - 26.0) < 0.05)
})

test('bucket shares are null when the breakdown is missing', () => {
  assert.equal(bucketShares({ compAccepted: 0, directAccepted: 1, indirectAccepted: 1, dealerAccepted: 1 }).directPct, null)
  assert.equal(bucketShares({ compAccepted: 10, directAccepted: null, indirectAccepted: 1, dealerAccepted: 1 }).dealerPct, null)
})

test('validation flags a 2.438% "10Y" against the prior nominal 10Y', () => {
  // Simulate the TIPS row arriving mislabeled as a nominal coupon.
  const bad = { ...normalizeAuction({ ...TIPS_10Y_0723, inflation_index_security: 'No' }), tenorLabel: '10Y' }
  Object.assign(bad, bucketShares(bad))
  const prev = { highYield: 4.58, auctionDate: '2026-07-08' }
  const codes = validateRow(bad, prev).map(f => f.code)
  assert.deepEqual(codes, ['yield_jump'])
})

test('validation passes a normal auction and catches impossible / incomplete rows', () => {
  const ok = normalizeAuction(NOTE_7Y_0924)
  Object.assign(ok, bucketShares(ok))
  assert.deepEqual(validateRow(ok, { highYield: 4.512, auctionDate: '2026-08-27' }), [])

  const inverted = { ...ok, highYield: 4.9, medianYield: 5.0 }
  assert.ok(validateRow(inverted, null).some(f => f.code === 'high_below_median'))

  const mismatch = { ...ok, bucketSumRatio: 0.97 }
  assert.ok(validateRow(mismatch, null).some(f => f.code === 'bucket_mismatch'))

  const empty = { ...ok, highYield: null, bidToCover: null }
  const codes = validateRow(empty, null).map(f => f.code)
  assert.ok(codes.includes('missing_yield') && codes.includes('missing_fields'))
})

test('baseline averages up to 6 prior auctions and reports n', () => {
  const mk = btc => ({ bidToCover: btc, dispersionBp: 5, tailBp: null, directPct: 20, indirectPct: 65, dealerPct: 15, endUserPct: 85 })
  const eight = [2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8].map(mk)
  const b = computeBaseline(eight)
  assert.equal(b.bidToCover.n, 6)
  assert.ok(Math.abs(b.bidToCover.avg - 2.55) < 1e-9) // last six: 2.3…2.8
  assert.equal(b.tailBp.n, 0)
  assert.equal(b.tailBp.avg, null)
})

test('baseline with fewer than six priors uses what exists; none → null', () => {
  const two = computeBaseline([{ bidToCover: 2.4 }, { bidToCover: 2.6 }])
  assert.equal(two.bidToCover.n, 2)
  assert.ok(Math.abs(two.bidToCover.avg - 2.5) < 1e-9)
  const none = computeBaseline([])
  assert.equal(none.bidToCover.n, 0)
  assert.equal(none.bidToCover.avg, null)
})

test('assess respects metric direction and tolerance', () => {
  const btc = METRICS.find(m => m.key === 'bidToCover')
  const dealer = METRICS.find(m => m.key === 'dealerPct')
  const indirect = METRICS.find(m => m.key === 'indirectPct')
  assert.equal(assess(btc, 0.2), 'better')
  assert.equal(assess(btc, -0.2), 'worse')
  assert.equal(assess(btc, 0.01), 'inline')
  assert.equal(assess(dealer, 3), 'worse')
  assert.equal(assess(indirect, -5), 'neutral') // bucket shifts aren't better/worse on their own
  assert.equal(assess(btc, null), null)
})

test('buildAuctionTable excludes TIPS/FRN, keeps reopenings, and finds the next auction', () => {
  const upcoming = row({
    cusip: '91282C3Y00', auction_date: '2026-10-06', security_term: '3-Year', original_security_term: '3-Year',
    high_yield: null, bid_to_cover_ratio: null, offering_amt: '58000000000',
  })
  const t = buildAuctionTable([TIPS_10Y_0723, FRN_2Y_0729, NOTE_7Y_0924, REOPEN_10Y_0909, upcoming], { today: '2026-10-04' })
  assert.deepEqual(t.coupons.map(r => r.auctionDate), ['2026-09-24', '2026-09-09'])
  assert.deepEqual(t.excluded.map(r => r.kind).sort(), ['frn', 'tips'])
  assert.equal(t.next.auctionDate, '2026-10-06')
  assert.equal(t.next.tenor, '3-Year')
})

test('buildAuctionTable merges WI yields into tail and keeps flagged rows out of baselines', () => {
  const prior10 = { ...REOPEN_10Y_0909, cusip: 'P1', auction_date: '2026-08-12', security_term: '10-Year', reopening: 'No', bid_to_cover_ratio: '2.53' }
  const badMid = { ...REOPEN_10Y_0909, cusip: 'P2', auction_date: '2026-08-20', high_yield: '2.40', avg_med_yield: '2.30' }
  const wiByKey = { [wiKey('91282C10Y8', '2026-09-09')]: { yield: 4.82, source: 'manual' } }
  const t = buildAuctionTable([prior10, badMid, REOPEN_10Y_0909], { today: '2026-10-04', wiByKey })
  const [latest, flagged, first] = t.coupons
  assert.ok(flagged.flags.some(f => f.code === 'yield_jump'))
  assert.ok(Math.abs(latest.tailBp - 1.4) < 1e-9)
  assert.equal(latest.baseline.bidToCover.n, 1) // flagged 08/20 row excluded
  assert.ok(Math.abs(latest.deltas.bidToCover - (2.71 - 2.53)) < 1e-9)
  assert.equal(first.baseline.bidToCover.n, 0)
  assert.equal(latestByTenor(t.coupons)[0].auctionDate, '2026-09-09')
})
