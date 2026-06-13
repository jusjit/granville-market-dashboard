import { useState, useEffect, useCallback } from 'react'
import { fetchAllSignals, getMarketPhase } from './lib/signals'
import Header from './components/Header'
import ScoreGauge from './components/ScoreGauge'
import SignalCard from './components/SignalCard'
import SignalLog from './components/SignalLog'

export default function App() {
  const [signals, setSignals] = useState([])
  const [compositeScore, setCompositeScore] = useState(null)
  const [prevScore, setPrevScore] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAllSignals()
      setCompositeScore((prev) => {
        setPrevScore(prev)
        return result.compositeScore
      })
      setSignals(result.signals)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const phase = compositeScore != null ? getMarketPhase(compositeScore, prevScore) : null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastUpdated={lastUpdated} onRefresh={refresh} loading={loading} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="rounded-lg bg-red-950 border border-red-800 text-red-300 px-4 py-3 text-sm">
            Error loading data: {error}
          </div>
        )}

        <div className="rounded-xl border border-slate-800 bg-slate-900">
          {loading && compositeScore == null ? (
            <div className="flex items-center justify-center py-16 text-slate-500 text-sm animate-pulse">
              Loading market data…
            </div>
          ) : (
            <ScoreGauge score={compositeScore ?? 50} phase={phase} />
          )}
        </div>

        {signals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {signals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}

        {signals.length > 0 && <SignalLog signals={signals} />}

        <p className="text-xs text-slate-600 text-center pb-4">
          Cross-validate at stockcharts.com · finviz.com · Data: Finnhub · Based on Granville's 1960 timing system
        </p>
      </main>
    </div>
  )
}
