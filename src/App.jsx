import { useState, useEffect, useCallback } from 'react'
import { fetchAllSignals, getMarketPhase } from './lib/signals'
import { fetchAllMacroSignals } from './lib/macro'
import { fetchSynthesis } from './lib/synthesis'
import { fetchAlmaData } from './lib/alma'
import AlmaPanel from './components/AlmaPanel'
import AlmaLog from './components/AlmaLog'
import VolSurfacePanel from './components/VolSurfacePanel'
import { fetchVolSurface } from './lib/volsurface'
import ReferenceDataPanel from './components/ReferenceDataPanel'
import { fetchReferenceLatest } from './lib/referencedata'
import GeoRegimePanel from './components/GeoRegimePanel'
import { fetchGeoRegime } from './lib/georegime'

import LoginGate from './components/LoginGate'

const SHOW_ALMA = import.meta.env.VITE_SHOW_ALMA === 'true'
const SHOW_GEO = import.meta.env.VITE_SHOW_GEO_REGIME === 'true'
import Header from './components/Header'
import ScoreGauge from './components/ScoreGauge'
import SignalCard from './components/SignalCard'
import SignalLog from './components/SignalLog'
import MacroCard from './components/MacroCard'
import SynthesisPanel from './components/SynthesisPanel'

export default function App() {
  // /login is served by the same SPA bundle; the edge middleware allows it
  // through and redirects unauthenticated visitors here (private project only).
  if (window.location.pathname === '/login') return <LoginGate />

  const [signals, setSignals] = useState([])
  const [compositeScore, setCompositeScore] = useState(null)
  const [prevScore, setPrevScore] = useState(null)
  const [divergenceWarning, setDivergenceWarning] = useState(false)

  const [macroVol, setMacroVol] = useState([])
  const [macroRates, setMacroRates] = useState([])

  const [synthesis, setSynthesis] = useState(null)
  const [synthesisLoading, setSynthesisLoading] = useState(false)
  const [synthesisError, setSynthesisError] = useState(null)

  const [volData, setVolData] = useState(null)
  const [volLoading, setVolLoading] = useState(false)
  const [volError, setVolError] = useState(null)

  const [almaData, setAlmaData] = useState(null)
  const [almaLoading, setAlmaLoading] = useState(false)
  const [almaError, setAlmaError] = useState(null)

  const [referenceData, setReferenceData] = useState(null)
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceError, setReferenceError] = useState(null)

  const [geoData, setGeoData] = useState(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState(null)

  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setSynthesisLoading(true)
    setSynthesisError(null)
    setError(null)

    // Vol surface fetch runs in parallel, independent of the main flow
    setVolLoading(true)
    setVolError(null)
    fetchVolSurface()
      .then(data => { setVolData(data); setVolLoading(false) })
      .catch(err => { setVolError(err.message); setVolLoading(false) })

    // Alma fetch runs in parallel, independent of the main flow
    if (SHOW_ALMA) {
      setAlmaLoading(true)
      setAlmaError(null)
      fetchAlmaData()
        .then(data => { setAlmaData(data); setAlmaLoading(false) })
        .catch(err => { setAlmaError(err.message); setAlmaLoading(false) })
    }

    // Reference data — latest snapshot (VX futures + CME FedWatch), non-blocking
    setReferenceLoading(true)
    setReferenceError(null)
    fetchReferenceLatest()
      .then(data => { setReferenceData(data); setReferenceLoading(false) })
      .catch(err => { setReferenceError(err.message); setReferenceLoading(false) })

    // Geo regime — recent runs + active signals, non-blocking
    if (SHOW_GEO) {
      setGeoLoading(true)
      setGeoError(null)
      fetchGeoRegime()
        .then(data => { setGeoData(data); setGeoLoading(false) })
        .catch(err => { setGeoError(err.message); setGeoLoading(false) })
    }

    try {
      // Fetch Granville and Macro in parallel
      const [granvilleResult, macroResult] = await Promise.all([
        fetchAllSignals(),
        fetchAllMacroSignals(),
      ])

      let currentScore
      setCompositeScore((prev) => {
        setPrevScore(prev)
        currentScore = granvilleResult.compositeScore
        return granvilleResult.compositeScore
      })
      setSignals(granvilleResult.signals)
      setDivergenceWarning(granvilleResult.divergenceWarning)
      setMacroVol(macroResult.volAndRisk)
      setMacroRates(macroResult.ratesAndCredit)
      setLastUpdated(new Date())

      // Fire AI synthesis after data is loaded (non-blocking for the main UI)
      fetchSynthesis(
        { signals: granvilleResult.signals, compositeScore: granvilleResult.compositeScore, divergenceWarning: granvilleResult.divergenceWarning },
        macroResult
      )
        .then(text => {
          setSynthesis(text)
          setSynthesisLoading(false)
        })
        .catch(err => {
          setSynthesisError(err.message)
          setSynthesisLoading(false)
        })
    } catch (err) {
      setError(err.message)
      setLoading(false)
      setSynthesisLoading(false)
      return
    }

    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Alma data (live SPX reference + active rules + touch log) refreshes on its
  // own 15-min timer, independent of the manual Refresh button. It's cheap
  // (Supabase reads + a couple of Tradier calls, no LLM), unlike the rest of
  // the dashboard which stays manual-refresh-only to control 1min.ai/Finnhub cost.
  useEffect(() => {
    if (!SHOW_ALMA) return
    const id = setInterval(() => {
      fetchAlmaData()
        .then(data => { setAlmaData(data); setAlmaError(null) })
        .catch(err => setAlmaError(err.message))
    }, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const phase = compositeScore != null ? getMarketPhase(compositeScore, prevScore) : null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastUpdated={lastUpdated} onRefresh={refresh} loading={loading} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {error && (
          <div className="rounded-lg bg-red-950 border border-red-800 text-red-300 px-4 py-3 text-sm">
            Error loading data: {error}
          </div>
        )}

        {/* Section 1 — AI Synthesis */}
        <SynthesisPanel
          text={synthesis}
          loading={synthesisLoading}
          error={synthesisError}
        />

        {/* Section 2 — Granville Composite */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Granville Composite
          </h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900">
            {loading && compositeScore == null ? (
              <div className="flex items-center justify-center py-16 text-slate-500 text-sm animate-pulse">
                Loading market data…
              </div>
            ) : (
              <ScoreGauge
                score={compositeScore ?? 50}
                phase={phase}
                divergenceWarning={divergenceWarning}
              />
            )}
          </div>
        </section>

        {/* Section 3 — Granville Signal Cards */}
        {signals.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
              Granville Signal Cards
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-2">
              {signals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          </section>
        )}

        {/* Granville Signal Log — directly below the signal cards */}
        {signals.length > 0 && <SignalLog signals={signals} />}

        {/* Section 4 — Macro Conditions */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Macro Conditions
            </h2>
            <span className="text-[10px] text-slate-700 border border-slate-800 rounded px-1.5 py-0.5">
              Descriptive only — not scored
            </span>
          </div>

          {macroVol.length > 0 || macroRates.length > 0 ? (
            <div className="space-y-4">
              {macroVol.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-2">Vol, Dollar & Risk</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {macroVol.map(sig => <MacroCard key={sig.id} signal={sig} />)}
                  </div>
                </div>
              )}
              {macroRates.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-2">Rates & Credit · FRED</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {macroRates.map(sig => <MacroCard key={sig.id} signal={sig} />)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-8 text-center text-sm text-slate-600 animate-pulse">
              Loading macro conditions…
            </div>
          )}
        </section>

        {/* Vol Surface — Tradier/ORATS SPX term structure */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Vol Surface
          </h2>
          <VolSurfacePanel data={volData} loading={volLoading} error={volError} />
        </section>

        {/* Reference Data — VIX Futures + CME FedWatch (collapsible) */}
        <ReferenceDataPanel data={referenceData} loading={referenceLoading} error={referenceError} />

        {/* Geo Regime — LLM geopolitical signal aggregator (private dashboard only) */}
        {SHOW_GEO && (
          <GeoRegimePanel data={geoData} loading={geoLoading} error={geoError} />
        )}

        {/* Section 5 — Alma Centroid (private dashboard only) */}
        {SHOW_ALMA && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
              Alma Centroid
            </h2>
            <AlmaPanel data={almaData} loading={almaLoading} error={almaError} />
          </section>
        )}

        {/* Alma Signal Log — level touches, end-of-day */}
        {SHOW_ALMA && almaData && <AlmaLog data={almaData} />}

        <p className="text-xs text-slate-600 text-center pb-4">
          Cross-validate at stockcharts.com · finviz.com · Data: Finnhub + FRED · Based on Granville's 1960 timing system
        </p>
      </main>
    </div>
  )
}
