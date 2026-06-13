import { useState } from 'react'

export default function ApiKeyPrompt({ onSubmit }) {
  const [key, setKey] = useState('')

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-white mb-2">Granville Market Dashboard</h1>
        <p className="text-slate-400 text-sm mb-6">
          Enter your Finnhub API key to load live ETF data. Your key is stored in browser
          sessionStorage and never sent anywhere except Finnhub.
        </p>
        <input
          type="password"
          placeholder="Finnhub API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && onSubmit(key.trim())}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 mb-4"
        />
        <button
          onClick={() => key.trim() && onSubmit(key.trim())}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
        >
          Load Dashboard
        </button>
        <p className="text-xs text-slate-600 mt-4 text-center">
          Free keys available at finnhub.io
        </p>
      </div>
    </div>
  )
}
