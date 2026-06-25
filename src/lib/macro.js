import { prefetchQuotes, getQuote } from './finnhub'
import { fetchMacroSignals as fetchFredSignals } from './fred'

function vixLevelState(price) {
  if (price < 15) return 'Complacent'
  if (price < 20) return 'Calm'
  if (price < 28) return 'Elevated'
  return 'Fear'
}

export async function fetchAllMacroSignals() {
  await prefetchQuotes(['VIXY', 'VIXM', 'UUP', 'IWM', 'SPY'])
  const fredResults = await fetchFredSignals()
  const volAndRisk = []
  const vixy = getQuote('VIXY')
  const vixm = getQuote('VIXM')
  if (vixy && !vixy.error) {
    const state = vixLevelState(vixy.price)
    volAndRisk.push({ id: 'vixLevel', label: 'Vol Level', ticker: 'VIXY (VIX proxy)', value: vixy.price, formatted: `$${vixy.price.toFixed(2)}`, pctChange: vixy.pctChange, state, meaning: `VIXY at $${vixy.price.toFixed(2)} (${vixy.pctChange >= 0 ? '+' : ''}${vixy.pctChange?.toFixed(2)}% today). ${state === 'Fear' ? 'Fear regime — elevated hedging demand.' : state === 'Elevated' ? 'Vol elevated — market pricing near-term uncertainty.' : 'Vol contained — calm market backdrop.'}`, source: 'Finnhub' })
  } else { volAndRisk.push({ id: 'vixLevel', label: 'Vol Level', ticker: 'VIXY', error: vixy?.error ?? 'unavailable', source: 'Finnhub' }) }
  if (vixy && vixm && !vixy.error && !vixm.error) {
    const ratioNow = vixy.price / vixm.price
    const ratioPrev = vixy.prevClose / vixm.prevClose
    const pct = ratioPrev !== 0 ? ((ratioNow - ratioPrev) / ratioPrev) * 100 : 0
    const state = ratioNow > 1.02 ? 'Backwardation' : ratioNow < 0.98 ? 'Contango' : 'Neutral'
    volAndRisk.push({ id: 'volTermStructure', label: 'Vol Term Structure', ticker: 'VIXY / VIXM', value: ratioNow, formatted: ratioNow.toFixed(3), pctChange: pct, state, meaning: `VIXY/VIXM ratio at ${ratioNow.toFixed(3)}. ${state === 'Backwardation' ? 'Near-term fear exceeds longer-dated vol — classic stress signal.' : state === 'Contango' ? 'Vol curve in contango — market calm and orderly.' : 'Term structure near flat.'}`, source: 'Finnhub' })
  } else { volAndRisk.push({ id: 'volTermStructure', label: 'Vol Term Structure', ticker: 'VIXY / VIXM', error: 'unavailable', source: 'Finnhub' }) }
  if (vixy && vixm && !vixy.error && !vixm.error) {
    const diff = (vixy.pctChange ?? 0) - (vixm.pctChange ?? 0)
    const state = diff > 1 ? 'Front-loaded Fear' : diff < -1 ? 'Back-loaded' : 'Balanced'
    volAndRisk.push({ id: 'volSkew', label: 'Vol Skew (near vs far)', ticker: 'VIXY Δ vs VIXM Δ', value: diff, formatted: `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`, pctChange: null, state, meaning: `VIXY ${(vixy.pctChange ?? 0) >= 0 ? '+' : ''}${(vixy.pctChange ?? 0).toFixed(2)}% vs VIXM ${(vixm.pctChange ?? 0) >= 0 ? '+' : ''}${(vixm.pctChange ?? 0).toFixed(2)}% today. ${state === 'Front-loaded Fear' ? 'Near-term vol rising faster — immediate event risk.' : state === 'Back-loaded' ? 'Longer-dated vol rising more — structural uncertainty building.' : 'Near and far vol moving in sync.'}`, source: 'Finnhub' })
  } else { volAndRisk.push({ id: 'volSkew', label: 'Vol Skew', ticker: 'VIXY Δ vs VIXM Δ', error: 'unavailable', source: 'Finnhub' }) }
  volAndRisk.push({ id: 'move', label: 'MOVE Index', ticker: 'TVC:MOVE', value: null, formatted: 'See ICE', pctChange: null, state: 'Manual Check', meaning: 'Bond market implied vol index. Check ice.com or bondcliq.com for current reading. >100 = elevated bond vol, typically risk-off for equities.', source: 'Manual', staticTile: true })
  const uup = getQuote('UUP')
  if (uup && !uup.error) {
    const pct = uup.pctChange ?? 0
    const state = pct > 0.3 ? 'Strengthening' : pct < -0.3 ? 'Weakening' : 'Stable'
    volAndRisk.push({ id: 'dollar', label: 'Dollar Strength', ticker: 'UUP (DXY proxy)', value: uup.price, formatted: `$${uup.price.toFixed(2)}`, pctChange: pct, state, meaning: `UUP at $${uup.price.toFixed(2)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% today. ${state === 'Strengthening' ? 'Dollar strength headwind for risk assets.' : state === 'Weakening' ? 'Dollar weakness supportive for equities and commodities.' : 'Dollar stable — neutral macro backdrop.'}`, source: 'Finnhub' })
  } else { volAndRisk.push({ id: 'dollar', label: 'Dollar Strength', ticker: 'UUP', error: uup?.error ?? 'unavailable', source: 'Finnhub' }) }
  const iwm = getQuote('IWM')
  const spy = getQuote('SPY')
  if (iwm && spy && !iwm.error && !spy.error) {
    const ratioNow = iwm.price / spy.price
    const ratioPrev = iwm.prevClose / spy.prevClose
    const pct = ratioPrev !== 0 ? ((ratioNow - ratioPrev) / ratioPrev) * 100 : 0
    const state = pct > 0.3 ? 'Outperforming' : pct < -0.3 ? 'Underperforming' : 'Inline'
    volAndRisk.push({ id: 'smallLargeCap', label: 'Small vs Large Cap', ticker: 'IWM / SPY', value: ratioNow, formatted: ratioNow.toFixed(4), pctChange: pct, state, meaning: `IWM/SPY ratio ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% today. ${state === 'Outperforming' ? 'Small caps leading — broad risk-on breadth.' : state === 'Underperforming' ? 'Small caps lagging — large-cap concentration.' : 'Small and large cap moving in lockstep.'}`, source: 'Finnhub' })
  } else { volAndRisk.push({ id: 'smallLargeCap', label: 'Small vs Large Cap', ticker: 'IWM / SPY', error: 'unavailable', source: 'Finnhub' }) }
  return { volAndRisk, ratesAndCredit: Object.values(fredResults) }
}
