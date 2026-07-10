import { useState } from 'react'

export default function LoginGate() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        window.location.href = '/'
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Login failed')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-slate-100">Granville Market Dashboard</h1>
          <p className="text-xs text-slate-500 mt-1">Private access</p>
        </div>
        <form onSubmit={submit} className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-600"
            />
          </label>
          {error && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors"
          >
            {loading ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}
