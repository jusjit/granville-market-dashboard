// Persistent cache in Supabase (synthesis_cache, single row id=1) — survives
// serverless cold starts. Regenerate only when older than TTL or when the
// signal states change.
const CACHE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

async function cacheRead(id = 1) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const r = await fetch(`${url}/rest/v1/synthesis_cache?id=eq.${id}&select=paragraph,input_hash,created_at`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return null
    const rows = await r.json()
    return rows[0] ?? null
  } catch { return null }
}

async function cacheWrite(paragraph, inputHash, id = 1) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/rest/v1/synthesis_cache?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([{ id, paragraph, input_hash: inputHash, created_at: new Date().toISOString() }]),
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

Rules: 2 to 3 "Why" bullets, each a single line, each grounded in a specific number from the data. Group related signals rather than listing every one. If the divergence warning is active, it must appear as one of the reasons. Do not restate the label inside its own sentence (write "Session lean: Cautiously bearish — ..." NOT "Session lean: The session lean is cautiously bearish"). Be concise — a trader scans this in five seconds.

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

// Model swap 2026-07-17: matched the aggregator's swap (see
// api/aggregate-geo-regime.js for the full comparison writeup). claude-sonnet-4-6
// cost ~180-250K 1min.ai credit per call; gemini-2.5-flash measured ~18.5K on the
// real aggregator prompt (~10-13x cheaper) with comparable analytical depth —
// unlike gpt-4o-mini, which was rejected there for shallow output. This prompt is
// far smaller than the aggregator's, so quality risk is lower still, but the
// Minto structure is load-bearing for SynthesisPanel's parser — verified after
// the swap that gemini still emits Bottom line: / Why: / - / Session lean:.
const MODEL = 'gemini-2.5-flash'

function sleep(ms) { return new Promise(res => setTimeout(res, ms)) }

// Single attempt, capped so a hang can't eat the retry budget. Throws on any
// failure so the caller decides whether to retry.
async function callOneMinOnce(prompt, key) {
  const r = await fetch('https://api.1min.ai/api/chat-with-ai', {
    method: 'POST',
    signal: AbortSignal.timeout(30000), // ~3x headroom over the 11s observed for this prompt
    headers: { 'Content-Type': 'application/json', 'API-KEY': key },
    body: JSON.stringify({ type: 'CHAT', model: MODEL, promptObject: { prompt, isMixed: false } }),
  })
  if (!r.ok) throw new Error(`1min.ai ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const data = await r.json()
  const text = data?.aiRecord?.aiRecordDetail?.resultObject?.[0]
  if (!text) throw new Error(`Unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`)
  return { text: String(text).trim(), credit: data?.aiRecord?.metadata?.credit ?? null }
}

// One retry after a short backoff — same rationale as the aggregator: gemini's
// longer call duration widens the window for a transient 1min.ai gateway 500,
// and here a failure means the panel shows "Synthesis unavailable" until the
// next refresh, so absorbing it in-invocation is worth ~3s.
async function callOneMin(prompt, key) {
  try {
    return await callOneMinOnce(prompt, key)
  } catch (firstErr) {
    await sleep(3000)
    try {
      return await callOneMinOnce(prompt, key)
    } catch (secondErr) {
      throw new Error(`1min.ai failed twice — first: ${firstErr.message} | retry: ${secondErr.message}`)
    }
  }
}

// ── Treasury auction synthesis (id=2 in synthesis_cache) ──

function hashTreasuryInputs(auctions) {
  return JSON.stringify(auctions.map(a => `${a.auctionDate}:${a.cusip}`).sort())
}

function buildTreasuryPrompt(auctions) {
  const lines = auctions.map(a => {
    const tail = a.tail != null ? `${a.tail > 0 ? '+' : ''}${(a.tail * 100).toFixed(1)}bp tail` : 'no tail data'
    const btc = a.bidToCover != null ? `${a.bidToCover.toFixed(2)}x bid/cover` : 'no bid/cover'
    const indirect = a.indirectPct != null ? `${a.indirectPct}% indirect` : ''
    const direct = a.directPct != null ? `${a.directPct}% direct` : ''
    const size = a.offeringAmt != null ? `$${(a.offeringAmt / 1e9).toFixed(0)}B` : ''
    const yld = a.highYield != null ? `${a.highYield.toFixed(3)}%` : 'pending'
    return `  ${a.auctionDate} ${a.securityTerm}: ${yld}, ${tail}, ${btc}, ${indirect}, ${direct} ${size}`
  }).join('\n')

  return `You are a fixed-income analyst writing a brief for a macro trader. Summarize these recent US Treasury auction results in 2-3 sentences. Focus on:
1. Demand quality (bid-to-cover ratios, tails — positive tail = weak, negative = strong)
2. Foreign demand trends (indirect bidders = foreign central banks + institutions)
3. Any notable shifts vs prior auctions of the same tenor

Be specific with numbers. If a very recent auction has no results yet (pending), note it's upcoming. Write in plain prose, no bullets, no headers. Be concise — a trader reads this in 5 seconds.

RECENT MARKET-MOVING TREASURY AUCTIONS (newest first):
${lines}

Write the summary now:`
}

async function handleTreasury(req, res) {
  const key = process.env.ONEMIN_KEY
  if (!key) return res.status(500).json({ error: 'ONEMIN_KEY not configured' })
  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }) }
  const { auctions } = body
  if (!auctions?.length) return res.status(400).json({ error: 'auctions array required' })

  const currentHash = hashTreasuryInputs(auctions)
  const cached = await cacheRead(2)
  if (cached?.paragraph && cached.input_hash === currentHash) {
    return res.status(200).json({ paragraph: cached.paragraph, cached: true })
  }
  const prompt = buildTreasuryPrompt(auctions)
  try {
    const { text: trimmed } = await callOneMin(prompt, key)
    await cacheWrite(trimmed, currentHash, 2)
    return res.status(200).json({ paragraph: trimmed, cached: false })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Route: POST /api/synthesis?type=treasury
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.searchParams.get('type') === 'treasury') return handleTreasury(req, res)

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
    const { text: trimmed } = await callOneMin(prompt, key)
    await cacheWrite(trimmed, currentHash)
    return res.status(200).json({ paragraph: trimmed, cached: false })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
