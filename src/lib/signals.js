import { getQuote } from './finnhub'

// Signal definitions — all scored from day-over-day ratio change (free Finnhub plan)
export const SIGNAL_DEFS = [
  {
    id: 'breadth',
    label: 'Breadth / Leadership',
    numerator: 'RSP',
    denominator: 'SPY',
    description: 'Equal-weight vs cap-weight S&P 500. Rising ratio means broad participation — bullish.',
    bullThreshold: 0.0003,
    bearThreshold: -0.0003,
  },
  {
    id: 'defensive',
    label: 'Defensive Rotation',
    numerator: 'XLP',
    denominator: 'XLY',
    description: 'Staples vs discretionary. Falling ratio means investors prefer risk — bullish.',
    bullThreshold: -0.0003,
    bearThreshold: 0.0003,
    inverted: true,
  },
  {
    id: 'credit',
    label: 'Credit Confidence',
    numerator: 'HYG',
    denominator: 'LQD',
    description: 'High-yield vs investment-grade bonds. Rising ratio signals credit risk appetite — bullish.',
    bullThreshold: 0.0002,
    bearThreshold: -0.0002,
  },
  {
    id: 'bellwether',
    label: 'Bellwether Semis',
    numerator: 'SOXX',
    denominator: 'SPY',
    description: 'Semiconductors vs broad market. Semis lead economic cycles — outperformance is bullish.',
    bullThreshold: 0.0005,
    bearThreshold: -0.0005,
  },
  {
    id: 'volatility',
    label: 'Volatility (VIX Proxy)',
    numerator: 'VIXY',
    denominator: null,
    description: 'VIX futures ETF. Low price (<15) is complacent/bullish. High (>25) signals fear/bearish.',
    isAbsolute: true,
    absoluteBull: 17,
    absoluteBear: 25,
    bullThreshold: -0.005, // falling price = bullish
    bearThreshold: 0.005,
    inverted: true,
  },
  {
    id: 'riskAppetite',
    label: 'Risk Appetite',
    numerator: 'SPHB',
    denominator: 'SPLV',
    description: 'High-beta vs low-volatility stocks. Rising ratio means investors are chasing risk — bullish.',
    bullThreshold: 0.0005,
    bearThreshold: -0.0005,
  },
  {
    id: 'transport',
    label: 'Transport / Economy',
    numerator: 'IYT',
    denominator: 'SPY',
    description: 'Transports vs broad market. Dow Theory: transport outperformance confirms economic health.',
    bullThreshold: 0.0003,
    bearThreshold: -0.0003,
  },
]

function scoreSignal(def, ratioNow, ratioPrev) {
  if (def.isAbsolute) {
    const price = ratioNow
    const change = ratioPrev !== 0 ? (ratioNow - ratioPrev) / ratioPrev : 0
    if (price <= def.absoluteBull && change <= def.bullThreshold) return 20
    if (price >= def.absoluteBear || change >= def.bearThreshold) return 0
    return 10
  }

  const pctChange = ratioPrev !== 0 ? (ratioNow - ratioPrev) / ratioPrev : 0

  if (!def.inverted) {
    if (pctChange >= def.bullThreshold) return 20
    if (pctChange <= def.bearThreshold) return 0
    return 10
  } else {
    if (pctChange <= def.bullThreshold) return 20
    if (pctChange >= def.bearThreshold) return 0
    return 10
  }
}

function scoreLabel(score) {
  if (score === 20) return 'Bullish'
  if (score === 0) return 'Bearish'
  return 'Neutral'
}

function trendArrow(pctChange, inverted) {
  if (Math.abs(pctChange) < 0.00005) return 'flat'
  const up = pctChange > 0
  return inverted ? (up ? 'down' : 'up') : (up ? 'up' : 'down')
}

export async function fetchAllSignals() {
  const results = await Promise.all(
    SIGNAL_DEFS.map(async (def) => {
      try {
        if (def.denominator) {
          const [num, den] = await Promise.all([
            getQuote(def.numerator),
            getQuote(def.denominator),
          ])

          const ratioNow = num.price / den.price
          const ratioPrev = num.prevClose / den.prevClose
          const pctChange = ratioPrev !== 0 ? ((ratioNow - ratioPrev) / ratioPrev) * 100 : 0
          const score = scoreSignal(def, ratioNow, ratioPrev)

          return {
            ...def,
            ratioNow,
            ratioPrev,
            pctChange,
            score,
            reading: scoreLabel(score),
            trend: trendArrow(ratioNow - ratioPrev, def.inverted),
            numPrice: num.price,
            denPrice: den.price,
            error: null,
          }
        } else {
          // Absolute (VIXY)
          const q = await getQuote(def.numerator)
          const pctChange = q.pctChange ?? 0
          const score = scoreSignal(def, q.price, q.prevClose)

          return {
            ...def,
            ratioNow: q.price,
            ratioPrev: q.prevClose,
            pctChange,
            score,
            reading: scoreLabel(score),
            trend: trendArrow(q.price - q.prevClose, true),
            error: null,
          }
        }
      } catch (err) {
        return {
          ...def,
          ratioNow: null,
          ratioPrev: null,
          pctChange: null,
          score: 10,
          reading: 'Neutral',
          trend: 'flat',
          error: err.message,
        }
      }
    })
  )

  const total = results.reduce((sum, s) => sum + s.score, 0)
  return { signals: results, compositeScore: total }
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
