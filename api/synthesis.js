const cache = { paragraph: null, timestamp: 0, inputHash: null }
const CACHE_TTL_MS = 20 * 60 * 1000

function hashInputs(granvilleData, macroData) {
  return JSON.stringify({
    composite: Math.round((granvilleData.compositeScore ?? 0) / 5) * 5,
    divergence: granvilleData.divergenceWarning,
    signals: (granvilleData.signals ?? []).map(s => s.reading),
    volStates: (macroData.volAndRisk ?? []).map(s => s.state),
    ratesStates: (macroData.ratesAndCredit ?? []).map(s => s.state),
  })
}

function buildPrompt(granvilleData, macroData) {
  const { signals, compositeScore, divergenceWarning } = granvilleData
  const { volAndRisk, ratesAndCredit } = macroData
  const signalLines = (signals ?? []).map(s => `  - ${s.label} (${s.numerator}${s.denominator ? '/' + s.denominator : ''}): ${s.reading}, ${s.pctChange != null ? (s.pctChange >= 0 ? '+' : '') + s.pctChange.toFixed(2) + '%' : 'unavailable'}`).join('\n')
  const volLines = (volAndRisk ?? []).filter(s => !s.error).map(s => `  - ${s.label}: ${s.state} (${s.formatted})`).join('\n')
  const ratesLines = (ratesAndCredit ?? []).filter(s => !s.error).map(s => `  - ${s.label}: ${s.state} at ${s.formatted}`).join('\n')
  const divergenceNote = divergenceWarning ? 'ACTIVE DIVERGENCE WARNING: SPY is rising but RSP/SPY breadth ratio is falling — composite capped at 60.' : 'No breadth divergence warning active.'
  return `You are a pre-market market intelligence assistant for a sophisticated trader using Granville's 1960 timing system. Write ONE paragraph (4-6 sentences) synthesizing these signals into a plain-English morning read. Be specific about numbers. Do not use bullet points. Lead with the Granville composite reading and treat it as the primary verdict. Then contextualize with macro. End with a one-sentence directional lean for the session.\n\nGRANVILLE COMPOSITE: ${compositeScore}/100\n${divergenceNote}\n\nGRANVILLE SIGNALS:\n${signalLines}\n\nMACRO CONDITIONS:\nVol & Risk:\n${volLines || '  (unavailable)'}\n\nRates & Credit:\n${ratesLines || '  (unavailable)'}\n\nWrite the synthesis paragraph now:`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const key = process.env.ONEMIN_KEY
  if (!key) return res.status(500).json({ error: 'ONEMIN_KEY not configured' })
  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }) }
  const { granvilleData, macroData } = body
  if (!granvilleData || !macroData) return res.status(400).json({ error: 'granvilleData and macroData required' })
  const now = Date.now()
  const currentHash = hashInputs(granvilleData, macroData)
  if (cache.paragraph && now - cache.timestamp < CACHE_TTL_MS && cache.inputHash === currentHash) {
    return res.status(200).json({ paragraph: cache.paragraph, cached: true })
  }
  const prompt = buildPrompt(granvilleData, macroData)
  try {
    const r = await fetch('https://api.1min.ai/api/chat-with-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'API-KEY': key },
      body: JSON.stringify({ type: 'CHAT', model: 'claude-sonnet-4-6', promptObject: { prompt, isMixed: false } }),
    })
    if (!r.ok) { const text = await r.text(); return res.status(502).json({ error: `1min.ai ${r.status}: ${text.slice(0, 200)}` }) }
    const data = await r.json()
    const paragraph = data?.aiRecord?.aiRecordDetail?.resultObject?.[0]
    if (!paragraph) return res.status(502).json({ error: `Unexpected response shape: ${JSON.stringify(data).slice(0, 200)}` })
    cache.paragraph = paragraph.trim()
    cache.timestamp = now
    cache.inputHash = currentHash
    return res.status(200).json({ paragraph: cache.paragraph, cached: false })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
