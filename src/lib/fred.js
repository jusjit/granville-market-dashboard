const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const API_KEY = import.meta.env.VITE_FRED_KEY

function buildFredUrl(seriesId, limit) {
  const params = `series_id=${seriesId}&api_key=${API_KEY}&sort_order=desc&limit=${limit}&file_type=json`
  if (import.meta.env.DEV) {
    // Vite dev proxy strips /fred-api prefix and forwards to api.stlouisfed.org
    return `/fred-api/fred/series/observations?${params}`
  }
  // Production: wrap direct URL through corsproxy.io
  return `https://corsproxy.io/?url=${encodeURIComponent(`${FRED_BASE}?${params}`)}`
}

async function fetchSeries(seriesId, limit = 2) {
  const url = buildFredUrl(seriesId, limit)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FRED ${res.status} for ${seriesId}`)
  const data = await res.json()
  const obs = data.observations?.filter(o => o.value !== '.')
  if (!obs?.length) throw new Error(`No data for ${seriesId}`)
  return obs.map(o => ({ date: o.date, value: parseFloat(o.value) }))
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

  await Promise.all([
    // HY Credit Spread
    fetchSeries('BAMLH0A0HYM2').then(obs => {
      const [cur, prev] = obs
      results.hySpread = {
        id: 'hySpread',
        label: 'HY Credit Spread',
        ticker: 'BAMLH0A0HYM2',
        value: cur.value,
        formatted: `${cur.value.toFixed(2)}%`,
        state: directionState(cur.value, prev?.value, 'Widening', 'Stable', 'Tightening', 0.05),
        stateColors: { Widening: 'red', Stable: 'yellow', Tightening: 'green' },
        meaning: `High-yield OAS at ${cur.value.toFixed(2)}%. ${cur.value > prev?.value ? 'Spread widening signals rising credit stress.' : 'Spread tightening signals improving credit confidence.'}`,
        source: 'FRED',
      }
    }).catch(e => { results.hySpread = { id: 'hySpread', label: 'HY Credit Spread', error: e.message } }),

    // 10Y Real Yield
    fetchSeries('DFII10').then(obs => {
      const [cur, prev] = obs
      results.realYield = {
        id: 'realYield',
        label: '10Y Real Yield',
        ticker: 'DFII10',
        value: cur.value,
        formatted: `${cur.value.toFixed(2)}%`,
        state: directionState(cur.value, prev?.value, 'Rising', 'Stable', 'Falling', 0.03),
        stateColors: { Rising: 'red', Stable: 'yellow', Falling: 'green' },
        meaning: `Real yields at ${cur.value.toFixed(2)}%. ${cur.value > 2 ? 'Elevated real rates compress equity valuations.' : cur.value < 0 ? 'Negative real rates historically supportive for risk assets.' : 'Real rates in neutral territory.'}`,
        source: 'FRED',
      }
    }).catch(e => { results.realYield = { id: 'realYield', label: '10Y Real Yield', error: e.message } }),

    // 5Y5Y Inflation Forward
    fetchSeries('T5YIFR').then(obs => {
      const [cur, prev] = obs
      results.inflationFwd = {
        id: 'inflationFwd',
        label: '5Y5Y Inflation Fwd',
        ticker: 'T5YIFR',
        value: cur.value,
        formatted: `${cur.value.toFixed(2)}%`,
        state: directionState(cur.value, prev?.value, 'Rising', 'Stable', 'Falling', 0.03),
        stateColors: { Rising: 'red', Stable: 'yellow', Falling: 'green' },
        meaning: `Long-run inflation expectations at ${cur.value.toFixed(2)}%. ${cur.value > 2.5 ? 'Above 2.5% suggests markets expect persistent inflation — Fed pressure.' : 'Anchored near Fed target.'}`,
        source: 'FRED',
      }
    }).catch(e => { results.inflationFwd = { id: 'inflationFwd', label: '5Y5Y Inflation Fwd', error: e.message } }),

    // Breakeven = US10Y nominal - DFII10 real; fetch both
    Promise.all([
      fetchSeries('DGS10'),
      fetchSeries('DFII10'),
    ]).then(([nomObs, realObs]) => {
      const nomCur = nomObs[0].value
      const nomPrev = nomObs[1]?.value
      const realCur = realObs[0].value
      const realPrev = realObs[1]?.value
      const breakeven = nomCur - realCur
      const breakevenPrev = nomPrev != null && realPrev != null ? nomPrev - realPrev : null
      results.breakeven = {
        id: 'breakeven',
        label: '10Y Breakeven Inflation',
        ticker: 'DGS10 − DFII10',
        value: breakeven,
        formatted: `${breakeven.toFixed(2)}%`,
        state: directionState(breakeven, breakevenPrev, 'Rising', 'Stable', 'Falling', 0.03),
        stateColors: { Rising: 'red', Stable: 'yellow', Falling: 'green' },
        meaning: `Market-implied 10Y inflation at ${breakeven.toFixed(2)}%. ${breakeven > 2.5 ? 'Above 2.5% — markets pricing durable inflation.' : 'Near or below 2.5% — inflation expectations contained.'}`,
        source: 'FRED',
      }
    }).catch(e => { results.breakeven = { id: 'breakeven', label: '10Y Breakeven', error: e.message } }),
  ])

  return results
}
