const ENDPOINT = 'https://api.1min.ai/api/chat-with-ai'
const API_KEY = import.meta.env.VITE_1MIN_KEY

function buildPrompt(granvilleData, macroData) {
  const { signals, compositeScore, divergenceWarning } = granvilleData
  const { volAndRisk, ratesAndCredit } = macroData

  const signalLines = signals
    .map(s => `  - ${s.label} (${s.numerator}${s.denominator ? '/' + s.denominator : ''}): ${s.reading}, ${s.pctChange != null ? (s.pctChange >= 0 ? '+' : '') + s.pctChange.toFixed(2) + '%' : 'unavailable'}`)
    .join('\n')

  const volLines = volAndRisk
    .filter(s => !s.error)
    .map(s => `  - ${s.label}: ${s.state} (${s.formatted})`)
    .join('\n')

  const ratesLines = ratesAndCredit
    .filter(s => !s.error)
    .map(s => `  - ${s.label}: ${s.state} at ${s.formatted}`)
    .join('\n')

  const divergenceNote = divergenceWarning
    ? 'ACTIVE DIVERGENCE WARNING: SPY is rising but RSP/SPY breadth ratio is falling — composite capped at 60.'
    : 'No breadth divergence warning active.'

  return `You are a pre-market market intelligence assistant for a sophisticated trader using Granville's 1960 timing system. Write ONE paragraph (4-6 sentences) synthesizing these signals into a plain-English morning read. Be specific about numbers. Do not use bullet points. Lead with the Granville composite reading and treat it as the primary verdict. Then contextualize with macro. End with a one-sentence directional lean for the session.

GRANVILLE COMPOSITE: ${compositeScore}/100
${divergenceNote}

GRANVILLE SIGNALS:
${signalLines}

MACRO CONDITIONS:
Vol & Risk:
${volLines || '  (unavailable)'}

Rates & Credit:
${ratesLines || '  (unavailable)'}

Write the synthesis paragraph now:`
}

export async function fetchSynthesis(granvilleData, macroData) {
  const prompt = buildPrompt(granvilleData, macroData)

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'API-KEY': API_KEY,
    },
    body: JSON.stringify({
      type: 'CHAT',
      model: 'claude-sonnet-4-6',
      promptObject: { prompt, isMixed: false },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`1min.ai ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()

  const text = data?.aiRecord?.aiRecordDetail?.resultObject?.[0]
  if (!text) throw new Error(`Unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`)
  return text.trim()
}
