export async function fetchSynthesis(granvilleData, macroData) {
  const res = await fetch('/api/synthesis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ granvilleData, macroData }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `synthesis API ${res.status}`)
  }
  const data = await res.json()
  return data.paragraph
}

// payload = summaryPayload() from treasuryMetrics (computed fields + baselines only)
export async function fetchTreasurySynthesis(payload) {
  const res = await fetch('/api/synthesis?type=treasury', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `treasury synthesis API ${res.status}`)
  }
  const data = await res.json()
  return data.paragraph
}
