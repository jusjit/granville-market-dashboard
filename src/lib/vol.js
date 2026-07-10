// Shared vol-complex fetch: one /api/vol call per refresh cycle,
// shared between the Granville volatility signal and the macro panel.
let inflight = null

export function fetchVolComplex() {
  if (!inflight) {
    inflight = fetch('/api/vol')
      .then(res => {
        if (!res.ok) return res.json().catch(() => ({})).then(d => {
          throw new Error(d.error ?? `vol API ${res.status}`)
        })
        return res.json()
      })
      .finally(() => { setTimeout(() => { inflight = null }, 5000) })
  }
  return inflight
}
