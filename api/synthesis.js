// Persistent cache in Supabase (synthesis_cache, single row id=1) — survives
// serverless cold starts. Regenerate only when older than TTL or when the
// signal states change.
const CACHE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

async function cacheRead() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const r = await fetch(`${url}/rest/v1/synthesis_cache?id=eq.1&select=paragraph,input_hash,created_at`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return null
    const rows = await r.json()
    return rows[0] ?? null
  } catch { return null }
}

async function cacheWrite(paragraph, inputHash) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/rest/v1/synthesis_cache?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([{ id: 1, paragraph, input_hash: inputHash, created_at: new Date().toISOString() }]),
    })
  } catch { /* cache write failure is non-fatal */ }
}

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
  return `You are a pre-market market intelligence assistant for a sophisticated trader using Granville's 1960 timing system. Synthesize these signals into a morning read written in the MINTO PYRAMID style: lead with the single governing conclusion, then the grouped supporting reasons, then the action.

Output EXACTLY this structure and nothing else — no preamble, no markdown headers, no asterisks:

Bottom line: <one crisp sentence giving the verdict — lead with the Granville composite reading as the primary answer>
Why:
- <supporting reason 1, specific with numbers>
- <supporting reason 2, specific with numbers>
- <supporting reason 3, specific with numbers — optional>
Session lean: <one sentence with the directional lean for the session>

Rules: 2 to 3 "Why" bullets, each a single line, each grounded in a specific number from the data. Group related signals rather than listing every one. If the divergence warning is active, it must appear as one of the reasons. Be concise — a trader scans this in five seconds.

GRANVILLE COMPOSITE: ${compositeScore}/100
${divergenceNote}

GRANVILLE SIGNALS:
${signalLines}

MACRO CONDITIONS:
Vol & Risk:
${volLines || '  (unavailable)'}

Rates & Credit:
${ratesLines || '  (unavailable)'}

Write the synthesis now:`
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
  const cached = await cacheRead()
  if (cached?.paragraph &&
      now - new Date(cached.created_at).getTime() < CACHE_TTL_MS &&
      cached.input_hash === currentHash) {
    return res.status(200).json({ paragraph: cached.paragraph, cached: true })
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
    const trimmed = paragraph.trim()
    await cacheWrite(trimmed, currentHash)
    return res.status(200).json({ paragraph: trimmed, cached: false })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
