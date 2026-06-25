async function fetchSeriesMulti(seriesIds) {
  const res = await fetch(`/api/fred?series=${seriesIds.map(encodeURIComponent).join(',')}`)
  if (!res.ok) throw new Error(`/api/fred ${res.status}`)
  const data = await res.json()
  const map = {}
  for (const item of data) {
    map[item.id] = item.error ? null : item.observations
  }
  return map
}

function directionState(current, prev, upLabel, stableLabel, downLabel, threshold = 0.05) {
  if (prev == null) return stableLabel
  const delta = current - prev
  if (delta > threshold) return upLabel
  if (delta < -threshold) return downLabel
  return stableLabel
}

export async function fetchMacroSignals() {
  const results = {}
  let obsMap = {}
  try {
    obsMap = await fetchSeriesMulti(['BAMLH0A0HYM2', 'DFII10', 'T5YIFR', 'DGS10'])
  } catch (e) {
    console.error('FRED batch fetch failed:', e.message)
  }
  try {
    const obs = obsMap['BAMLH0A0HYM2']
    if (!obs) throw new Error('missing')
    const [cur, prev] = obs
    results.hySpread = { id: 'hySpread', label: 'HY Credit Spread', ticker: 'BAMLH0A0HYM2', value: cur.value, formatted: `${cur.value.toFixed(2)}%`, state: directionState(cur.value, prev?.value, 'Widening', 'Stable', 'Tightening', 0.05), meaning: `High-yield OAS at ${cur.value.toFixed(2)}%. ${cur.value > (prev?.value ?? cur.value) ? 'Spread widening signals rising credit stress.' : 'Spread tightening signals improving credit confidence.'}`, source: 'FRED' }
  } catch (e) { results.hySpread = { id: 'hySpread', label: 'HY Credit Spread', error: e.message } }
  try {
    const obs = obsMap['DFII10']
    if (!obs) throw new Error('missing')
    const [cur, prev] = obs
    results.realYield = { id: 'realYield', label: '10Y Real Yield', ticker: 'DFII10', value: cur.value, formatted: `${cur.value.toFixed(2)}%`, state: directionState(cur.value, prev?.value, 'Rising', 'Stable', 'Falling', 0.03), meaning: `Real yields at ${cur.value.toFixed(2)}%. ${cur.value > 2 ? 'Elevated real rates compress equity valuations.' : cur.value < 0 ? 'Negative real rates historically supportive for risk assets.' : 'Real rates in neutral territory.'}`, source: 'FRED' }
  } catch (e) { results.realYield = { id: 'realYield', label: '10Y Real Yield', error: e.message } }
  try {
    const obs = obsMap['T5YIFR']
    if (!obs) throw new Error('missing')
    const [cur, prev] = obs
    results.inflationFwd = { id: 'inflationFwd', label: '5Y5Y Inflation Fwd', ticker: 'T5YIFR', value: cur.value, formatted: `${cur.value.toFixed(2)}%`, state: directionState(cur.value, prev?.value, 'Rising', 'Stable', 'Falling', 0.03), meaning: `Long-run inflation expectations at ${cur.value.toFixed(2)}%. ${cur.value > 2.5 ? 'Above 2.5% — markets expect persistent inflation.' : 'Anchored near Fed target.'}`, source: 'FRED' }
  } catch (e) { results.inflationFwd = { id: 'inflationFwd', label: '5Y5Y Inflation Fwd', error: e.message } }
  try {
    const nomObs = obsMap['DGS10']
    const realObs = obsMap['DFII10']
    if (!nomObs || !realObs) throw new Error('missing')
    const breakeven = nomObs[0].value - realObs[0].value
    const breakevenPrev = nomObs[1] && realObs[1] ? nomObs[1].value - realObs[1].value : null
    results.breakeven = { id: 'breakeven', label: '10Y Breakeven Inflation', ticker: 'DGS10 − DFII10', value: breakeven, formatted: `${breakeven.toFixed(2)}%`, state: directionState(breakeven, breakevenPrev, 'Rising', 'Stable', 'Falling', 0.03), meaning: `Market-implied 10Y inflation at ${breakeven.toFixed(2)}%. ${breakeven > 2.5 ? 'Above 2.5% — markets pricing durable inflation.' : 'Near or below 2.5% — inflation expectations contained.'}`, source: 'FRED' }
  } catch (e) { results.breakeven = { id: 'breakeven', label: '10Y Breakeven', error: e.message } }
  return results
}
