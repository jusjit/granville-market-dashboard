import { getQuote } from './finnhub'
import { fetchMacroSignals as fetchFredSignals } from './fred'

// Note: CBOE indices (VIX, VIX3M, VVIX, VIX9D, MOVE) require Finnhub paid tier.
// We use ETF proxies: VIXY = short-term VIX futures (~VIX9D), VIXM = mid-term (~VIX3M).
// VIXY/VIXM ratio proxies VIX term structure (VIX/VIX3M).

function vixLevelState(price) {
  if (price < 15) return 'Complacent'
  if (price < 20) return 'Calm'
  if (price < 28) return 'Elevated'
  return 'Fear'
}

export async function fetchAllMacroSignals() {
  const symbols = ['VIXY', 'VIXM', 'UUP', 'IWM', 'SPY']
  const quoteMap = {}

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        quoteMap[sym] = await getQuote(sym)
      } catch (e) {
        quoteMap[sym] = { error: e.message }
      }
    })
  )

  const fredResults = await fetchFredSignals()

  const volAndRisk = []

  const vixy = quoteMap['VIXY']
  const vixm = quoteMap['VIXM']

  // 1. VIX level proxy (VIXY price)
  if (vixy && !vixy.error) {
    const state = vixLevelState(vixy.price)
    volAndRisk.push({
      id: 'vixLevel',
      label: 'Vol Level',
      ticker: 'VIXY (VIX proxy)',
      value: vixy.price,
      formatted: `$${vixy.price.toFixed(2)}`,
      pctChange: vixy.pctChange,
      state,
      stateColor: { Complacent: 'green', Calm: 'green', Elevated: 'yellow', Fear: 'red' }[state],
      meaning: `VIXY at $${vixy.price.toFixed(2)} (${vixy.pctChange >= 0 ? '+' : ''}${vixy.pctChange?.toFixed(2)}% today). ${state === 'Fear' ? 'Fear regime — elevated hedging demand, defensive posture warranted.' : state === 'Elevated' ? 'Vol elevated — market pricing near-term uncertainty.' : 'Vol contained — calm market backdrop.'}`,
      source: 'Finnhub',
    })
  } else {
    volAndRisk.push({ id: 'vixLevel', label: 'Vol Level', ticker: 'VIXY', error: vixy?.error ?? 'unavailable', source: 'Finnhub' })
  }

  // 2. Vol term structure — VIXY/VIXM ratio (proxies VIX/VIX3M)
  if (vixy && vixm && !vixy.error && !vixm.error) {
    const ratioNow = vixy.price / vixm.price
    const ratioPrev = vixy.prevClose / vixm.prevClose
    const pct = ratioPrev !== 0 ? ((ratioNow - ratioPrev) / ratioPrev) * 100 : 0
    // ratio > 1 means short-term vol > mid-term = backwardation (stress)
    const state = ratioNow > 1.02 ? 'Backwardation' : ratioNow < 0.98 ? 'Contango' : 'Neutral'
    volAndRisk.push({
      id: 'volTermStructure',
      label: 'Vol Term Structure',
      ticker: 'VIXY / VIXM',
      value: ratioNow,
      formatted: ratioNow.toFixed(3),
      pctChange: pct,
      state,
      stateColor: { Backwardation: 'red', Contango: 'green', Neutral: 'yellow' }[state],
      meaning: `VIXY/VIXM ratio at ${ratioNow.toFixed(3)} (short-term vs mid-term VIX futures). ${state === 'Backwardation' ? 'Ratio >1 — near-term fear exceeds longer-dated vol, classic stress signal.' : state === 'Contango' ? 'Ratio <1 — vol curve in contango, market calm and orderly.' : 'Term structure near flat — vol expectations balanced.'}`,
      source: 'Finnhub',
    })
  } else {
    volAndRisk.push({ id: 'volTermStructure', label: 'Vol Term Structure', ticker: 'VIXY / VIXM', error: 'unavailable', source: 'Finnhub' })
  }

  // 3. Front-loaded vs back-loaded fear — VIXY daily change vs VIXM daily change
  if (vixy && vixm && !vixy.error && !vixm.error) {
    const vixyPct = vixy.pctChange ?? 0
    const vixmPct = vixm.pctChange ?? 0
    // If VIXY rising faster than VIXM = front-loaded fear
    const diff = vixyPct - vixmPct
    const state = diff > 1 ? 'Front-loaded Fear' : diff < -1 ? 'Back-loaded' : 'Balanced'
    volAndRisk.push({
      id: 'volSkew',
      label: 'Vol Skew (near vs far)',
      ticker: 'VIXY Δ vs VIXM Δ',
      value: diff,
      formatted: `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`,
      pctChange: null,
      state,
      stateColor: { 'Front-loaded Fear': 'red', 'Back-loaded': 'yellow', 'Balanced': 'green' }[state],
      meaning: `VIXY ${vixyPct >= 0 ? '+' : ''}${vixyPct.toFixed(2)}% vs VIXM ${vixmPct >= 0 ? '+' : ''}${vixmPct.toFixed(2)}% today. ${state === 'Front-loaded Fear' ? 'Near-term vol rising faster — immediate event risk, hedging front-month.' : state === 'Back-loaded' ? 'Longer-dated vol rising more — structural uncertainty building.' : 'Near and far vol moving in sync — no term structure skew.'}`,
      source: 'Finnhub',
    })
  } else {
    volAndRisk.push({ id: 'volSkew', label: 'Vol Skew', ticker: 'VIXY Δ vs VIXM Δ', error: 'unavailable', source: 'Finnhub' })
  }

  // 4. MOVE index — static tile (requires paid data)
  volAndRisk.push({
    id: 'move',
    label: 'MOVE Index',
    ticker: 'TVC:MOVE',
    value: null,
    formatted: 'See ICE',
    pctChange: null,
    state: 'Manual Check',
    stateColor: 'yellow',
    meaning: 'Bond market implied vol index. Check ice.com or bondcliq.com for current reading. >100 = elevated bond vol, typically risk-off for equities.',
    source: 'Manual',
    staticTile: true,
  })

  // 5. Dollar (UUP as DXY proxy)
  const uup = quoteMap['UUP']
  if (uup && !uup.error) {
    const pct = uup.pctChange ?? 0
    const state = pct > 0.3 ? 'Strengthening' : pct < -0.3 ? 'Weakening' : 'Stable'
    volAndRisk.push({
      id: 'dollar',
      label: 'Dollar Strength',
      ticker: 'UUP (DXY proxy)',
      value: uup.price,
      formatted: `$${uup.price.toFixed(2)}`,
      pctChange: pct,
      state,
      stateColor: { Strengthening: 'red', Stable: 'yellow', Weakening: 'green' }[state],
      meaning: `UUP at $${uup.price.toFixed(2)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% today. ${state === 'Strengthening' ? 'Dollar strength headwind for risk assets and emerging markets.' : state === 'Weakening' ? 'Dollar weakness historically supportive for equities and commodities.' : 'Dollar stable — neutral macro backdrop for risk.'}`,
      source: 'Finnhub',
    })
  } else {
    volAndRisk.push({ id: 'dollar', label: 'Dollar Strength', ticker: 'UUP', error: uup?.error ?? 'unavailable', source: 'Finnhub' })
  }

  // 6. Small vs large cap (IWM/SPY)
  const iwm = quoteMap['IWM']
  const spy = quoteMap['SPY']
  if (iwm && spy && !iwm.error && !spy.error) {
    const ratioNow = iwm.price / spy.price
    const ratioPrev = iwm.prevClose / spy.prevClose
    const pct = ratioPrev !== 0 ? ((ratioNow - ratioPrev) / ratioPrev) * 100 : 0
    const state = pct > 0.3 ? 'Outperforming' : pct < -0.3 ? 'Underperforming' : 'Inline'
    volAndRisk.push({
      id: 'smallLargeCap',
      label: 'Small vs Large Cap',
      ticker: 'IWM / SPY',
      value: ratioNow,
      formatted: ratioNow.toFixed(4),
      pctChange: pct,
      state,
      stateColor: { Outperforming: 'green', Inline: 'yellow', Underperforming: 'red' }[state],
      meaning: `IWM/SPY ratio ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% today. ${state === 'Outperforming' ? 'Small caps leading — broad risk-on breadth, cyclical strength.' : state === 'Underperforming' ? 'Small caps lagging — large-cap defensiveness or mega-cap concentration.' : 'Small and large cap moving in lockstep.'}`,
      source: 'Finnhub',
    })
  } else {
    volAndRisk.push({ id: 'smallLargeCap', label: 'Small vs Large Cap', ticker: 'IWM / SPY', error: 'unavailable', source: 'Finnhub' })
  }

  const ratesAndCredit = Object.values(fredResults)

  return { volAndRisk, ratesAndCredit }
}
