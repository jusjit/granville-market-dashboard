import { getQuote } from './finnhub'

// Neutral band: ±0.5% change vs prior close (±0.3% for IYT/SPY)
// Breadth (RSP/SPY) scores double: 40/20/0. Max raw = 6×20 + 40 = 160.
// Composite is normalized to 0–100 for display.
// Divergence penalty: if SPY rising but RSP/SPY falling → cap display at 60.

export const SIGNAL_DEFS = [
  {
    id: 'breadth',
    label: 'Breadth / Leadership',
    numerator: 'RSP',
    denominator: 'SPY',
    description: 'Equal-weight vs cap-weight S&P 500. Rising ratio means broad participation — bullish.',
    neutralBand: 0.005, // ±0.5%
    doubleWeight: true,
  },
  {
    id: 'defensive',
    label: 'Defensive Rotation',
    numerator: 'XLP',
    denominator: 'XLY',
    description: 'Staples vs discretionary. Falling ratio means investors prefer risk — bullish.',
    neutralBand: 0.005,
    inverted: true,
  },
  {
    id: 'credit',
    label: 'Credit Confidence',
    numerator: 'HYG',
    denominator: 'LQD',
    description: 'High-yield vs investment-grade bonds. Rising ratio signals credit risk appetite — bullish.',
    neutralBand: 0.005,
  },
  {
    id: 'bellwether',
    label: 'Bellwether Semis',
    numerator: 'SOXX',
    denominator: 'SPY',
    description: 'Semiconductors vs broad market. Semis lead economic cycles — outperformance is bullish.',
    neutralBand: 0.005,
  },
  {
    id: 'volatility',
    label: 'Volatility Proxy',
    numerator: 'VIXY',
    denominator: null,
    description: 'VIX futures ETF. Price below $17 is calm/bullish. Above $25 signals fear — bearish.',
    isAbsolute: true,
    absoluteBull: 17,
    absoluteBear: 25,
    neutralBand: 0.005,
    inverted: true,
  },
  {
    id: 'riskAppetite',
    label: 'Risk Appetite',
    numerator: 'SPHB',
    denominator: 'SPLV',
    description: 'High-beta vs low-volatility stocks. Rising ratio means investors are chasing risk — bullish.',
    neutralBand: 0.005,
  },
  {
    id: 'transport',
    label: 'Transport / Economy',
    numerator: 'IYT',
    denominator: 'SPY',
    description: 'Transports vs broad market. Dow Theory: transport outperformance confirms economic health.',
    neutralBand: 0.003, // ±0.3% — moves in smaller increments
  },
]

const MAX_RAW = 160 // 6×20 + 40 (breadth double weight)

function scoreSignal(def, pctChange) {
  const band = def.neutralBand
  const effectivePct = def.inverted ? -pctChange : pctChange

  if (effectivePct > band) return def.doubleWeight ? 40 : 20
  if (effectivePct < -band) return 0
  return def.doubleWeight ? 20 : 10
}

function scoreLabel(score, doubleWeight) {
  if (doubleWeight) {
    if (score === 40) return 'Bullish'
    if (score === 0) return 'Bearish'
    return 'Neutral'
  }
  if (score === 20) return 'Bullish'
  if (score === 0) return 'Bearish'
  return 'Neutral'
}

// For display purposes, normalize double-weight score back to /20
function displayScore(score, doubleWeight) {
  return doubleWeight ? score / 2 : score
}

export async function fetchAllSignals() {
  // Fetch SPY separately for divergence check (already fetched in breadth, but grab it cleanly)
  const fetchesNeeded = new Set(['SPY'])
  SIGNAL_DEFS.forEach(d => {
    fetchesNeeded.add(d.numerator)
    if (d.denominator) fetchesNeeded.add(d.denominator)
  })

  // Single fetch per unique symbol
  const quoteMap = {}
  await Promise.all(
    [...fetchesNeeded].map(async (symbol) => {
      try {
        quoteMap[symbol] = await getQuote(symbol)
      } catch (err) {
        quoteMap[symbol] = { error: err.message }
      }
    })
  )

  const results = SIGNAL_DEFS.map((def) => {
    try {
      let pctChange, ratioNow, ratioPrev, numPrice, denPrice

      if (def.isAbsolute) {
        const q = quoteMap[def.numerator]
        if (q.error) throw new Error(q.error)
        ratioNow = q.price
        ratioPrev = q.prevClose
        pctChange = ratioPrev !== 0 ? (ratioNow - ratioPrev) / ratioPrev : 0
        numPrice = q.price

        // For absolute (VIXY), score on price level primarily
        const band = def.neutralBand
        let score
        if (ratioNow <= def.absoluteBull) score = 20
        else if (ratioNow >= def.absoluteBear) score = 0
        else score = 10

        return {
          ...def,
          ratioNow, ratioPrev, pctChange: pctChange * 100,
          score, displayScore: score,
          reading: scoreLabel(score, false),
          numPrice, denPrice: null,
          error: null,
        }
      }

      const num = quoteMap[def.numerator]
      const den = quoteMap[def.denominator]
      if (num.error) throw new Error(num.error)
      if (den.error) throw new Error(den.error)

      ratioNow = num.price / den.price
      ratioPrev = num.prevClose / den.prevClose
      pctChange = ratioPrev !== 0 ? (ratioNow - ratioPrev) / ratioPrev : 0
      numPrice = num.price
      denPrice = den.price

      const score = scoreSignal(def, pctChange)

      return {
        ...def,
        ratioNow, ratioPrev, pctChange: pctChange * 100,
        score, displayScore: displayScore(score, def.doubleWeight),
        reading: scoreLabel(score, def.doubleWeight),
        numPrice, denPrice,
        error: null,
      }
    } catch (err) {
      return {
        ...def,
        ratioNow: null, ratioPrev: null, pctChange: null,
        score: def.doubleWeight ? 20 : 10,
        displayScore: 10,
        reading: 'Neutral',
        error: err.message,
      }
    }
  })

  // Divergence check: SPY rising but RSP/SPY falling
  const spyData = quoteMap['SPY']
  const breadthSignal = results.find(s => s.id === 'breadth')
  const spyRising = spyData && !spyData.error
    ? spyData.price > spyData.prevClose
    : false
  const breadthFalling = breadthSignal?.pctChange != null && breadthSignal.pctChange < 0
  const divergenceWarning = spyRising && breadthFalling

  const rawTotal = results.reduce((sum, s) => sum + s.score, 0)
  // Normalize to 0–100
  let compositeScore = Math.round((rawTotal / MAX_RAW) * 100)
  if (divergenceWarning && compositeScore > 60) compositeScore = 60

  return { signals: results, compositeScore, divergenceWarning }
}

export function getMarketPhase(score, prevScore) {
  const delta = score - (prevScore ?? score)

  if (score >= 67) {
    if (delta > 5) return 'Bull Phase 1'
    if (delta >= 0) return 'Bull Phase 2'
    return 'Bull Phase 3'
  }
  if (score <= 33) {
    if (delta < -5) return 'Bear Phase 1'
    if (delta <= 0) return 'Bear Phase 2'
    return 'Bear Phase 3'
  }
  return 'Transitional'
}
